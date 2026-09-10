// ============================================================
// Workspace4You — Razorpay Payment Backend
// File: api/razorpay.js
// The order amount is always computed server-side from the live
// site config — the browser tells us WHICH plan/duration/seats
// were picked, never how much to charge. See api/_pricing.js.
// ============================================================

const { readConfig } = require('./_configStore');
const { computeTotal } = require('./_pricing');
const { setCorsHeaders } = require('./_cors');

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('Razorpay error: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env vars not set');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, email, phone, plan, duration, seats, productinfo } = body || {};

    if (!name || !phone || !plan || !productinfo) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const config = await readConfig();
    const amount = computeTotal(plan, { duration, seats }, config.prices);

    if (amount === null) {
      return res.status(400).json({ error: 'Unknown or currently unavailable plan' });
    }

    const amountPaise = Math.round(amount * 100);

    // Create Razorpay order via API
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const receipt = 'WS4Y' + Date.now();

    const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: receipt,
        notes: {
          customer_name: name,
          customer_email: email || '',
          customer_phone: phone,
          plan: productinfo
        }
      })
    });

    const order = await rzpResponse.json();

    if (!order.id) {
      throw new Error(order.error?.description || 'Failed to create Razorpay order');
    }

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: amount,
      amountPaise: amountPaise,
      currency: 'INR',
      keyId: RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error('Razorpay error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
