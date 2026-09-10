// ============================================================
// Workspace4You — Public Lead Logger
// File: api/sheets.js
// Called directly from the browser (no login) whenever a visitor
// fills the booking form or opens/abandons checkout, so it has to
// stay anonymous — but it must NEVER be able to mark a lead
// "Paid". That status is only ever written by api/verify-payment.js
// (after checking Razorpay's signature) or the Razorpay webhook,
// both of which are server-verified against Razorpay itself.
// ============================================================

const { logRow } = require('./_sheets');
const { setCorsHeaders } = require('./_cors');

const ALLOWED_STATUSES = ['Form Filled', 'Dropped at Payment', 'Verification Failed', 'Payment Failed'];

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, phone, email, plan, amount, status, txnId } = body || {};

    // Never let a public, unauthenticated caller write an authoritative
    // "Paid" status — fall back to "Form Filled" for anything not on the
    // allowlist.
    const safeStatus = ALLOWED_STATUSES.indexOf(status) !== -1 ? status : 'Form Filled';

    const row = {
      timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      name: name || '',
      phone: phone || '',
      email: email || '',
      plan: plan || '',
      amount: amount || '',
      status: safeStatus,
      txnId: txnId || ''
    };

    await logRow(row);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Sheets error:', err);
    // Don't fail silently — but don't block payment flow either
    return res.status(200).json({ success: false, error: err.message });
  }
};
