// ============================================================
// Workspace4You — Admin: initiate a refund
// File: api/applications/admin-refund.js
// Calls Razorpay's own refund API against the payment already on
// record for this application — full refund unless a smaller
// amount is explicitly given.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireAdminApplication } = require('../_adminAppLoad');
const { setCorsHeaders } = require('../_cors');

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('admin-refund error: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env vars not set');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const app = await requireAdminApplication(req, res, body && body.code);
    if (!app) return;

    if (app.payment_status !== 'paid' || !app.razorpay_payment_id) {
      return res.status(400).json({ error: 'This application has no completed payment to refund' });
    }
    if (app.refund_status === 'processed') {
      return res.status(400).json({ error: 'Already refunded' });
    }

    const partialAmount = body && body.amount ? Math.round(Number(body.amount) * 100) : null;
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

    const rzpRes = await fetch(`https://api.razorpay.com/v1/payments/${app.razorpay_payment_id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(partialAmount ? { amount: partialAmount } : {})
    });
    const refund = await rzpRes.json();

    if (!refund.id) {
      throw new Error(refund.error?.description || 'Refund request failed');
    }

    const refundStatus = refund.status === 'processed' ? 'processed' : 'pending';
    await sql`UPDATE applications SET refund_status = ${refundStatus}, updated_at = now() WHERE id = ${app.id}`;
    await logEvent(app.id, 'admin', 'Refund ' + refundStatus + ' — ₹' + Math.round((refund.amount || 0) / 100) + ' (Razorpay ' + refund.id + ')');

    return res.status(200).json({ success: true, refundId: refund.id, status: refundStatus });
  } catch (err) {
    console.error('applications/admin-refund error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
