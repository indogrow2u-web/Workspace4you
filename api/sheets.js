// ============================================================
// Workspace4You — Google Sheets Lead Logger
// File: api/sheets.js
// ============================================================
// This function forwards lead data to a Google Apps Script
// Web App which writes to your Google Sheet.
// See setup instructions in SETUP_GUIDE.md
// ============================================================

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || '';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, phone, email, plan, amount, status, txnId } = body || {};

    const row = {
      timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      name: name || '',
      phone: phone || '',
      email: email || '',
      plan: plan || '',
      amount: amount || '',
      status: status || 'Form Filled',
      txnId: txnId || ''
    };

    // Forward to Google Apps Script
    if (GOOGLE_SCRIPT_URL) {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row)
      });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Sheets error:', err);
    // Don't fail silently — but don't block payment flow either
    return res.status(200).json({ success: false, error: err.message });
  }
};
