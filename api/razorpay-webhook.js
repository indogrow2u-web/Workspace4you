// ============================================================
// Workspace4You — Razorpay Webhook (server-to-server payment confirmation)
// File: api/razorpay-webhook.js
//
// Reliability backstop for two independent flows, both called
// directly by Razorpay's servers regardless of what happens
// client-side:
//  - The original booking flow (/api/verify-payment + /api/sheets):
//    logs "Paid" to the Google Sheet if the browser never reported
//    success.
//  - The Virtual Address application flow (/api/applications/*):
//    if the order's notes carry an application_code, marks that
//    application's payment as verified in Postgres, same as
//    /api/applications/verify-payment would have. Also the ONLY
//    place refund_status ever moves from "pending" to "processed"/
//    "failed" — api/applications/admin-refund.js only records
//    Razorpay's immediate response, which for many payment methods
//    is still "pending" until Razorpay finishes it asynchronously.
// A payment.captured event is routed to whichever flow created the
// order, by checking for notes.application_code. Refund events are
// always applications-flow (the old booking flow has no refund
// tracking) and are correlated by payment_id instead.
//
// Setup (do this after deploying):
//   1. Razorpay Dashboard -> Settings -> Webhooks -> Add New Webhook
//        (or edit the existing one for this URL)
//        URL: https://www.workspace4you.co/api/razorpay-webhook
//        Active events: payment.captured, payment.failed,
//                        refund.processed, refund.failed,
//                        subscription.authenticated, subscription.activated,
//                        subscription.charged, subscription.pending,
//                        subscription.halted, subscription.cancelled,
//                        subscription.completed
//        Generate a Secret (any strong random string)
//   2. Vercel -> Project Settings -> Environment Variables
//        Add RAZORPAY_WEBHOOK_SECRET with the exact same secret value
// ============================================================

const crypto = require('crypto');
const { logRow } = require('./_sheets');
const { sql, getApplicationByCode, getApplicationByPaymentId, logEvent } = require('./_db');
const { generateResumeToken } = require('./_appAuth');
const { sendApplicationReceiptEmail } = require('./_notify');

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const SITE_URL = process.env.SITE_URL || 'https://workspace4you.co';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE_DISPLAY || '+91 77180 86678';

function readRawBody(req){
  return new Promise(function(resolve, reject){
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      // bodyParser wasn't actually disabled by the platform; best-effort
      // reconstruction (Razorpay sends compact JSON, so this round-trips cleanly)
      return resolve(Buffer.from(JSON.stringify(req.body)));
    }
    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', function(){ resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function paymentToRow(payment, status){
  var notes = payment.notes || {};
  return {
    name: notes.customer_name || '',
    phone: notes.customer_phone || payment.contact || '',
    email: notes.customer_email || payment.email || '',
    plan: notes.plan || '',
    amount: String(Math.round((payment.amount || 0) / 100)),
    status: status,
    txnId: payment.id
  };
}

// First successful payment on an application — one-time order (via
// payment.captured) or the first AutoPay charge (via subscription.charged).
async function markApplicationPaid(app, payment, via){
  var rupees = Math.round((payment.amount || 0) / 100);
  await sql`
    UPDATE applications SET
      razorpay_payment_id = ${payment.id},
      payment_status = 'paid',
      payment_amount = ${rupees},
      payment_verified_at = now(),
      status = 'verification_pending',
      updated_at = now()
    WHERE id = ${app.id}
  `;
  await logEvent(app.id, 'system', 'Payment verified via ' + via + ' — ₹' + rupees + ' (Razorpay ' + payment.id + ')');
  await logEvent(app.id, 'system', 'Status → Verification Pending');

  if (app.email) {
    var resumeToken = generateResumeToken(app.application_code);
    var resumeUrl = resumeToken ? (SITE_URL + '/track.html?resume=' + resumeToken) : (SITE_URL + '/track.html');
    await sendApplicationReceiptEmail(
      { application_code: app.application_code, payment_amount: rupees, email: app.email },
      resumeUrl,
      SUPPORT_PHONE
    );
  }
}

// Monthly AutoPay (api/applications/admin-autopay.js). Correlated by
// subscription id; the subscription's notes also carry application_code.
var SUBSCRIPTION_STATUS = {
  'subscription.authenticated': 'authenticated',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.pending': 'active',
  'subscription.halted': 'halted',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'completed'
};

async function handleSubscriptionEvent(event){
  var sub = event.payload && event.payload.subscription && event.payload.subscription.entity;
  if (!sub) return;
  var { rows } = await sql`SELECT * FROM applications WHERE razorpay_subscription_id = ${sub.id} LIMIT 1`;
  var app = rows[0];
  if (!app) return;

  // Razorpay doesn't guarantee delivery order — a late 'authenticated'
  // must never overwrite 'active', and nothing revives a cancelled one.
  var newStatus = SUBSCRIPTION_STATUS[event.event];
  var terminal = app.autopay_status === 'cancelled' || app.autopay_status === 'completed';
  var regress = newStatus === 'authenticated' && ['active', 'pending', 'halted'].indexOf(app.autopay_status) !== -1;
  if (newStatus && app.autopay_status !== newStatus && !terminal && !regress) {
    await sql`UPDATE applications SET autopay_status = ${newStatus}, updated_at = now() WHERE id = ${app.id}`;
    if (event.event !== 'subscription.charged') {
      await logEvent(app.id, 'system', 'AutoPay ' + newStatus + ' (webhook)');
    }
    // pending = a monthly charge failed and Razorpay is retrying;
    // halted = every retry failed, no more automatic charges.
    if (event.event === 'subscription.pending' || event.event === 'subscription.halted') {
      var halted = event.event === 'subscription.halted';
      await sql`
        INSERT INTO autopay_charges (application_id, amount, status, note)
        VALUES (${app.id}, ${app.autopay_monthly_rate ? app.autopay_monthly_rate + Math.round(app.autopay_monthly_rate * 0.18) : null},
                ${halted ? 'halted' : 'failed'},
                ${halted ? 'All retries failed — AutoPay stopped. Contact the customer.' : 'Monthly charge failed — Razorpay will retry automatically.'})
      `;
    }
  }

  if (event.event === 'subscription.charged') {
    var payment = event.payload.payment && event.payload.payment.entity;
    if (!payment) return;
    // ON CONFLICT keeps Razorpay's retried deliveries from double-logging.
    await sql`
      INSERT INTO autopay_charges (application_id, razorpay_payment_id, amount, status, note)
      VALUES (${app.id}, ${payment.id}, ${Math.round((payment.amount || 0) / 100)}, 'paid',
              ${sub.paid_count === 1 ? 'First charge (deposit + month 1)' : 'Month ' + sub.paid_count})
      ON CONFLICT (razorpay_payment_id) DO NOTHING
    `;
    if (app.payment_status !== 'paid') {
      await markApplicationPaid(app, payment, 'AutoPay first charge');
    } else if (app.razorpay_payment_id !== payment.id) {
      // Idempotency: a retried delivery of the first charge carries the
      // same payment id as the one already on record.
      var { rows: seen } = await sql`SELECT 1 FROM application_events WHERE application_id = ${app.id} AND event LIKE ${'%' + payment.id + '%'} LIMIT 1`;
      if (!seen.length) {
        var rupees = Math.round((payment.amount || 0) / 100);
        if (sub.paid_count === 1) {
          // First AutoPay charge on an application that was already paid
          // by a one-time order — the customer has been charged twice.
          await logEvent(app.id, 'system', '⚠ DOUBLE PAYMENT: AutoPay first charge ₹' + rupees + ' (Razorpay ' + payment.id + ') on an already-paid application — review and refund');
        } else {
          await logEvent(app.id, 'system', 'AutoPay monthly charge — ₹' + rupees + ' (Razorpay ' + payment.id + ')');
        }
        // Each successful charge pays for one more month of service, so the
        // expiry cron doesn't expire a customer who's still paying.
        if (app.expiry_date) {
          await sql`
            UPDATE applications SET
              expiry_date = (GREATEST(expiry_date, CURRENT_DATE) + interval '1 month')::date,
              expiry_reminder_sent_at = NULL,
              updated_at = now()
            WHERE id = ${app.id}
          `;
        }
      }
    }
  }
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!WEBHOOK_SECRET) {
    console.error('Webhook error: RAZORPAY_WEBHOOK_SECRET env var not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  var raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'Could not read request body' });
  }

  var signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Missing signature' });
  }

  var expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  var isValid = expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  if (!isValid) {
    console.error('Webhook error: invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  var event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Refunds (applications flow only — the old booking flow has no
  // refund_status concept to update). Correlated by payment_id since a
  // refund event doesn't reliably carry the original payment's notes.
  if (event.event === 'refund.processed' || event.event === 'refund.failed') {
    var refund = event.payload && event.payload.refund && event.payload.refund.entity;
    if (refund && refund.payment_id) {
      try {
        var refundApp = await getApplicationByPaymentId(refund.payment_id);
        var newRefundStatus = event.event === 'refund.processed' ? 'processed' : 'failed';
        // Idempotency guard: Razorpay commonly retries webhook delivery for
        // reliability. Without this, a retried delivery would re-log a
        // duplicate audit trail entry every time (harmless to the actual
        // status, but clutters Activity History).
        if (refundApp && refundApp.refund_status !== newRefundStatus) {
          await sql`UPDATE applications SET refund_status = ${newRefundStatus}, updated_at = now() WHERE id = ${refundApp.id}`;
          await logEvent(refundApp.id, 'system', 'Refund ' + newRefundStatus + ' (webhook) — ₹' + Math.round((refund.amount || 0) / 100) + ' (Razorpay ' + refund.id + ')');
        }
      } catch (err) {
        console.error('Webhook refund update failed:', err);
      }
    }
    return res.status(200).json({ received: true });
  }

  if (event.event && event.event.indexOf('subscription.') === 0) {
    try {
      await handleSubscriptionEvent(event);
    } catch (err) {
      console.error('Webhook subscription update failed:', err);
    }
    return res.status(200).json({ received: true });
  }

  var payment = event.payload && event.payload.payment && event.payload.payment.entity;
  // AutoPay charges also fire payment.captured, but carry an invoice_id and
  // no application notes — they're handled by subscription.charged above,
  // so don't let them fall through into the old booking-flow Sheet log.
  if (payment && payment.invoice_id) {
    return res.status(200).json({ received: true });
  }
  var applicationCode = payment && payment.notes && payment.notes.application_code;

  if (applicationCode) {
    // Virtual Address application flow — Postgres, not the Sheet.
    try {
      var app = await getApplicationByCode(applicationCode);
      if (app && app.payment_status !== 'paid') {
        if (event.event === 'payment.captured') {
          await markApplicationPaid(app, payment, 'webhook');
        } else if (event.event === 'payment.failed') {
          await sql`UPDATE applications SET payment_status = 'failed', updated_at = now() WHERE id = ${app.id}`;
          await logEvent(app.id, 'system', 'Payment failed (webhook)');
        }
      }
    } catch (err) {
      console.error('Webhook applications-flow update failed:', err);
    }
  } else if (event.event === 'payment.captured' && payment) {
    await logRow(paymentToRow(payment, 'Paid'));
  } else if (event.event === 'payment.failed' && payment) {
    await logRow(paymentToRow(payment, 'Payment Failed (Webhook)'));
  }

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };
