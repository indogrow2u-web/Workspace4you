// ============================================================
// Workspace4You — Admin: create / cancel a Monthly AutoPay link
// File: api/applications/admin-autopay.js
//
// The admin types the monthly rate agreed with this customer
// (pre-GST). We create a Razorpay Plan for rate + 18% GST and a
// Subscription on it, with a one-time GST-free "refundable
// deposit" addon equal to one month's rate on the first charge:
//   first charge  = rate (deposit) + rate * 1.18
//   every month   = rate * 1.18, until cancelled
// Razorpay returns a short_url — that's the link the admin sends
// to the customer (as-is, or as a QR code). The customer approves
// the UPI AutoPay / card / eMandate there, and the webhook
// (api/razorpay-webhook.js, subscription.* events) marks the
// application paid.
//
// POST { code, action: 'create', monthlyRate }  -> { link, ... }
// POST { code, action: 'cancel' }
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireAdminApplication } = require('../_adminAppLoad');
const { setCorsHeaders } = require('../_cors');
const { rzpPost: rzp, cancelRazorpaySubscription: cancelSubscription, hasLiveAutopay } = require('../_autopay');

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

const GST_RATE = 0.18;
// "Until cancelled": Razorpay needs a finite count, so use 10 years of
// monthly charges. Cancelling from admin stops it at any time.
const TOTAL_MONTHS = 120;
const MIN_RATE = 100;
const MAX_RATE = 100000;

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('admin-autopay error: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env vars not set');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const app = await requireAdminApplication(req, res, body && body.code);
    if (!app) return;
    const action = (body && body.action) || 'create';

    if (action === 'cancel') {
      if (!hasLiveAutopay(app)) {
        return res.status(400).json({ error: 'No active AutoPay to cancel' });
      }
      await cancelSubscription(app.razorpay_subscription_id);
      await sql`UPDATE applications SET autopay_status = 'cancelled', updated_at = now() WHERE id = ${app.id}`;
      await logEvent(app.id, 'admin', 'Monthly AutoPay cancelled (Razorpay ' + app.razorpay_subscription_id + ')');
      return res.status(200).json({ success: true });
    }

    if (action !== 'create') return res.status(400).json({ error: 'Unknown action' });

    const rate = Math.round(Number(body.monthlyRate));
    if (!rate || rate < MIN_RATE || rate > MAX_RATE) {
      return res.status(400).json({ error: 'Enter a monthly rate between ₹' + MIN_RATE + ' and ₹' + MAX_RATE.toLocaleString('en-IN') });
    }
    if (!app.full_name || !app.mobile) {
      return res.status(400).json({ error: 'The application needs at least a name and mobile number first' });
    }
    if (app.payment_status === 'paid') {
      return res.status(400).json({ error: 'This application is already paid' });
    }
    if (['authenticated', 'active', 'pending', 'halted'].indexOf(app.autopay_status) !== -1) {
      return res.status(400).json({ error: 'The customer has already set up AutoPay on the existing link' });
    }

    if (app.razorpay_subscription_id && app.autopay_status === 'created') {
      await cancelSubscription(app.razorpay_subscription_id);
      await logEvent(app.id, 'admin', 'Previous unpaid AutoPay link cancelled (Razorpay ' + app.razorpay_subscription_id + ')');
    }

    const monthlyWithGst = rate + Math.round(rate * GST_RATE);
    const deposit = rate;
    const firstCharge = deposit + monthlyWithGst;

    const plan = await rzp('/plans', {
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Virtual Address — Monthly AutoPay',
        amount: monthlyWithGst * 100,
        currency: 'INR',
        description: '₹' + rate + ' + 18% GST per month'
      },
      notes: { application_code: app.application_code, monthly_rate: String(rate) }
    });
    if (!plan.id) throw new Error(plan.error?.description || 'Could not create Razorpay plan');

    const notes = {
      application_code: app.application_code,
      customer_name: app.full_name,
      customer_email: app.email || '',
      customer_phone: app.mobile,
      plan: 'Virtual Address (Monthly AutoPay ₹' + rate + ' + GST)',
      monthly_rate: String(rate),
      deposit: String(deposit)
    };
    const subscription = await rzp('/subscriptions', {
      plan_id: plan.id,
      total_count: TOTAL_MONTHS,
      quantity: 1,
      customer_notify: 0,
      addons: [{
        item: { name: 'Refundable Security Deposit (no GST)', amount: deposit * 100, currency: 'INR' }
      }],
      notes: notes,
      notify_info: app.email ? { notify_phone: app.mobile, notify_email: app.email } : { notify_phone: app.mobile }
    });
    if (!subscription.id || !subscription.short_url) {
      throw new Error(subscription.error?.description || 'Could not create Razorpay subscription');
    }

    await sql`
      UPDATE applications SET
        autopay_monthly_rate = ${rate},
        razorpay_plan_id = ${plan.id},
        razorpay_subscription_id = ${subscription.id},
        autopay_link = ${subscription.short_url},
        autopay_status = 'created',
        payment_amount = ${firstCharge},
        status = CASE WHEN status = 'draft' THEN 'payment_pending' ELSE status END,
        updated_at = now()
      WHERE id = ${app.id}
    `;
    await logEvent(app.id, 'admin', 'Monthly AutoPay link created — ₹' + rate + ' + GST/month (₹' + monthlyWithGst + '), first charge ₹' + firstCharge + ' incl. ₹' + deposit + ' refundable deposit (Razorpay ' + subscription.id + ')');

    return res.status(200).json({
      success: true,
      link: subscription.short_url,
      subscriptionId: subscription.id,
      monthlyRate: rate,
      monthlyWithGst: monthlyWithGst,
      deposit: deposit,
      firstCharge: firstCharge
    });
  } catch (err) {
    console.error('applications/admin-autopay error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
