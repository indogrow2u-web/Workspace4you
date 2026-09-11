// ============================================================
// Workspace4You — Create the Razorpay order for an application
// File: api/applications/pay.js
// Step 5. Amount is always computed server-side from the live
// price list for this application's stored duration — never from
// anything the browser sends (same rule as the main site's
// /api/razorpay). The order is tagged with the application code
// so the webhook can find its way back to this application.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { readConfig } = require('../_configStore');
const { computeTotal } = require('../_pricing');
const { setCorsHeaders } = require('../_cors');

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// Fast-fill discount: flat ₹250 off if payment is reached within 10
// minutes of the application being created. Eligibility is computed
// here from the application's own created_at, on the server, the same
// way the amount itself is — never trusted from the client, which only
// shows a matching countdown/preview for the customer's benefit.
const FAST_FILL_WINDOW_MS = 10 * 60 * 1000;
const FAST_FILL_DISCOUNT = 250;

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('applications/pay error: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env vars not set');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code } = body || {};

    const app = await requireOwnedApplication(req, res, code);
    if (!app) return;

    if (!app.full_name || !app.email_verified_at) {
      return res.status(400).json({ error: 'Please complete your personal details and verify your email address first' });
    }

    const config = await readConfig();
    const baseAmount = computeTotal('Virtual Address', { duration: app.duration }, config.prices);
    if (baseAmount === null) {
      return res.status(400).json({ error: 'Could not calculate the payable amount' });
    }

    const elapsedMs = Date.now() - new Date(app.created_at).getTime();
    const fastFillApplied = elapsedMs <= FAST_FILL_WINDOW_MS;
    const discount = fastFillApplied ? Math.min(FAST_FILL_DISCOUNT, baseAmount) : 0;
    const amount = baseAmount - discount;
    const amountPaise = Math.round(amount * 100);

    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const receipt = 'WA' + app.id + '-' + Date.now();

    const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: receipt,
        notes: {
          application_code: app.application_code,
          customer_name: app.full_name,
          customer_email: app.email || '',
          customer_phone: app.mobile,
          plan: 'Virtual Address (' + (app.duration === 'annual' ? 'Annual' : 'Month-to-month') + ')',
          fast_fill_discount: fastFillApplied ? discount : 0
        }
      })
    });

    const order = await rzpResponse.json();
    if (!order.id) {
      throw new Error(order.error?.description || 'Failed to create Razorpay order');
    }

    await sql`
      UPDATE applications SET
        razorpay_order_id = ${order.id},
        payment_amount = ${amount},
        status = CASE WHEN status = 'draft' THEN 'payment_pending' ELSE status END,
        updated_at = now()
      WHERE id = ${app.id}
    `;
    await logEvent(app.id, 'system', 'Razorpay order created for ₹' + amount + (fastFillApplied ? ' (₹' + discount + ' fast-fill discount applied)' : ''));

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: amount,
      amountPaise: amountPaise,
      currency: 'INR',
      keyId: RAZORPAY_KEY_ID,
      fastFillApplied: fastFillApplied,
      discount: discount
    });
  } catch (err) {
    console.error('applications/pay error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
