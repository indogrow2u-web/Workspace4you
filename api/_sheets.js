// ============================================================
// Workspace4You — Shared Google Sheets logger
// Used by api/sheets.js (public lead capture), api/verify-payment.js
// (authoritative "Paid" logging) and api/razorpay-webhook.js
// (reliability backstop). Every write carries SHEETS_SHARED_SECRET
// so Code.gs can reject writes that didn't come from us — see the
// "key" checks in google-apps-script.js.
// ============================================================

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || '';
const SHEETS_SHARED_SECRET = process.env.SHEETS_SHARED_SECRET || '';

async function logRow(row) {
  if (!GOOGLE_SCRIPT_URL) return;
  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, row, { key: SHEETS_SHARED_SECRET }))
    });
  } catch (err) {
    console.error('Sheet log failed:', err);
  }
}

module.exports = { logRow };
