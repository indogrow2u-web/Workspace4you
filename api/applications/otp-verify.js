// ============================================================
// Workspace4You — Verify a mobile OTP
// File: api/applications/otp-verify.js
// "signup": marks the application's mobile_verified_at.
// "track": on success, mints a brand-new access token for that
// application so the browser can load the Track Application
// dashboard — this is the only way in besides a resume link.
// ============================================================

const { sql, getApplicationByCode, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { normalizeMobile, verifyOtp } = require('../_otp');
const { generateAccessToken, hashToken } = require('../_appAuth');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, mobile, otp, purpose } = body || {};

    const normalized = normalizeMobile(mobile);
    if (!normalized || !otp) {
      return res.status(400).json({ error: 'Missing mobile or OTP' });
    }

    let app;
    if (purpose === 'signup') {
      app = await requireOwnedApplication(req, res, code);
      if (!app) return;
    } else if (purpose === 'track') {
      app = await getApplicationByCode(code);
      if (!app || app.mobile !== normalized) {
        return res.status(400).json({ error: 'Incorrect OTP' });
      }
    } else {
      return res.status(400).json({ error: 'Unknown purpose' });
    }

    const ok = await verifyOtp(normalized, otp);
    if (!ok) {
      return res.status(400).json({ error: 'Incorrect or expired OTP' });
    }

    await sql`
      UPDATE otp_challenges SET verified_at = now()
      WHERE application_id = ${app.id} AND purpose = ${purpose} AND verified_at IS NULL
    `;

    if (purpose === 'signup') {
      await sql`UPDATE applications SET mobile_verified_at = now(), updated_at = now() WHERE id = ${app.id}`;
      await logEvent(app.id, 'customer', 'Mobile number verified');
      return res.status(200).json({ success: true });
    }

    // purpose === 'track' — issue a fresh access token
    const accessToken = generateAccessToken();
    await sql`UPDATE applications SET access_token_hash = ${hashToken(accessToken)}, updated_at = now() WHERE id = ${app.id}`;
    await logEvent(app.id, 'customer', 'Accessed application via Track Application (OTP)');

    return res.status(200).json({ success: true, code: app.application_code, accessToken });
  } catch (err) {
    console.error('applications/otp-verify error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
