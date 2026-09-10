// ============================================================
// Workspace4You — Razorpay Payment Signature Verification
// File: api/verify-payment.js
// After confirming the signature is genuinely from Razorpay, this
// is also the (only) place the browser can cause a lead to be
// marked "Paid" — and even then, the name/phone/plan/amount that
// get logged are pulled from Razorpay's own order notes and
// captured payment record, never from anything the browser sends.
// ============================================================

const crypto = require('crypto');
const { logRow } = require('./_sheets');
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
  if (!RAZORPAY_KEY_SECRET) {
    console.error('Verify error: RAZORPAY_KEY_SECRET env var not set');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    const isValid = expectedSignature.length === razorpay_signature.length &&
      crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpay_signature));

    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }

    // Signature confirmed genuine — safe to log this lead as Paid. Pull the
    // customer/plan/amount from Razorpay's own records rather than trusting
    // anything the browser could send here.
    if (RAZORPAY_KEY_ID) {
      try {
        const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
        const payRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
          headers: { Authorization: `Basic ${auth}` }
        });
        const payment = await payRes.json();
        const notes = payment.notes || {};
        await logRow({
          timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          name: notes.customer_name || '',
          phone: notes.customer_phone || payment.contact || '',
          email: notes.customer_email || payment.email || '',
          plan: notes.plan || '',
          amount: String(Math.round((payment.amount || 0) / 100)),
          status: 'Paid',
          txnId: razorpay_payment_id
        });
      } catch (logErr) {
        // Don't fail verification just because the sheet log failed — the
        // webhook is still there as a backstop.
        console.error('Verify-payment sheet log failed:', logErr);
      }
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Verify-payment error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
