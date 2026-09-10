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
//    /api/applications/verify-payment would have.
// A payment.captured event is routed to whichever flow created the
// order, by checking for notes.application_code.
//
// Setup (do this after deploying):
//   1. Razorpay Dashboard -> Settings -> Webhooks -> Add New Webhook
//        URL: https://www.workspace4you.co/api/razorpay-webhook
//        Active events: payment.captured, payment.failed
//        Generate a Secret (any strong random string)
//   2. Vercel -> Project Settings -> Environment Variables
//        Add RAZORPAY_WEBHOOK_SECRET with the exact same secret value
// ============================================================

const crypto = require('crypto');
const { logRow } = require('./_sheets');
const { sql, getApplicationByCode, logEvent } = require('./_db');
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

  var payment = event.payload && event.payload.payment && event.payload.payment.entity;
  var applicationCode = payment && payment.notes && payment.notes.application_code;

  if (applicationCode) {
    // Virtual Address application flow — Postgres, not the Sheet.
    try {
      var app = await getApplicationByCode(applicationCode);
      if (app && app.payment_status !== 'paid') {
        if (event.event === 'payment.captured') {
          await sql`
            UPDATE applications SET
              razorpay_payment_id = ${payment.id},
              payment_status = 'paid',
              payment_verified_at = now(),
              status = 'verification_pending',
              updated_at = now()
            WHERE id = ${app.id}
          `;
          await logEvent(app.id, 'system', 'Payment verified via webhook — ₹' + Math.round((payment.amount || 0) / 100) + ' (Razorpay ' + payment.id + ')');
          await logEvent(app.id, 'system', 'Status → Verification Pending');

          if (app.email) {
            var resumeToken = generateResumeToken(app.application_code);
            var resumeUrl = resumeToken ? (SITE_URL + '/track.html?resume=' + resumeToken) : (SITE_URL + '/track.html');
            await sendApplicationReceiptEmail(
              { application_code: app.application_code, payment_amount: Math.round((payment.amount || 0) / 100), email: app.email },
              resumeUrl,
              SUPPORT_PHONE
            );
          }
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
