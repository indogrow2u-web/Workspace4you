// ============================================================
// Workspace4You — Verify an email verification code
// File: api/applications/otp-verify.js
// "signup": marks the application's email_verified_at.
// "track": on success, mints a brand-new access token for that
// application so the browser can load the Track Application
// dashboard — this is the only way in besides a resume link.
// ============================================================

const { sql, getApplicationByCode, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { normalizeEmail, verifyOtpHash } = require('../_otp');
const { generateAccessToken, hashToken } = require('../_appAuth');
const { setCorsHeaders } = require('../_cors');

const MAX_ATTEMPTS = 5;

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, email, otp, purpose } = body || {};

    const normalized = normalizeEmail(email);
    if (!normalized || !otp) {
      return res.status(400).json({ error: 'Missing email or code' });
    }

    let app;
    if (purpose === 'signup') {
      app = await requireOwnedApplication(req, res, code);
      if (!app) return;
    } else if (purpose === 'track') {
      app = await getApplicationByCode(code);
      if (!app || (app.email || '').toLowerCase() !== normalized) {
        return res.status(400).json({ error: 'Incorrect code' });
      }
    } else {
      return res.status(400).json({ error: 'Unknown purpose' });
    }

    const { rows: challenges } = await sql`
      SELECT * FROM otp_challenges
      WHERE application_id = ${app.id} AND purpose = ${purpose} AND channel = 'email'
        AND email = ${normalized} AND verified_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1
    `;
    const challenge = challenges[0];

    if (!challenge) {
      return res.status(400).json({ error: 'That code has expired. Please request a new one.' });
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }

    if (!verifyOtpHash(otp, challenge.otp_hash)) {
      await sql`UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ${challenge.id}`;
      return res.status(400).json({ error: 'Incorrect code' });
    }

    await sql`UPDATE otp_challenges SET verified_at = now() WHERE id = ${challenge.id}`;

    if (purpose === 'signup') {
      await sql`UPDATE applications SET email_verified_at = now(), updated_at = now() WHERE id = ${app.id}`;
      await logEvent(app.id, 'customer', 'Email address verified');
      return res.status(200).json({ success: true });
    }

    // purpose === 'track' — issue a fresh access token
    const accessToken = generateAccessToken();
    await sql`UPDATE applications SET access_token_hash = ${hashToken(accessToken)}, updated_at = now() WHERE id = ${app.id}`;
    await logEvent(app.id, 'customer', 'Accessed application via Track Application (email code)');

    return res.status(200).json({ success: true, code: app.application_code, accessToken });
  } catch (err) {
    console.error('applications/otp-verify error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
