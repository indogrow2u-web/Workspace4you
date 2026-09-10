// ============================================================
// Workspace4You — Request an email verification code
// File: api/applications/otp-request.js
// Two purposes:
//  - "signup": Step 2 email verification for the customer's own
//    draft application (requires the application's access token).
//  - "track": Track Application access from any device — requires
//    knowing the Application ID AND the email already on file for
//    it (never just the code alone).
// ============================================================

const { sql, getApplicationByCode, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { normalizeEmail, generateOtp, hashOtp } = require('../_otp');
const { sendOtpEmail } = require('../_notify');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, email, purpose } = body || {};

    const normalized = normalizeEmail(email);
    if (!normalized) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    let app;
    if (purpose === 'signup') {
      app = await requireOwnedApplication(req, res, code);
      if (!app) return; // response already sent
      // Store the candidate address now — it only becomes "verified" once
      // otp-verify succeeds.
      await sql`UPDATE applications SET email = ${normalized}, updated_at = now() WHERE id = ${app.id}`;

    } else if (purpose === 'track') {
      app = await getApplicationByCode(code);
      // Don't reveal whether the code exists or whether the email matched —
      // same generic response either way, so Track Application can't be used
      // to enumerate valid Application IDs or email addresses.
      if (!app || (app.email || '').toLowerCase() !== normalized) {
        return res.status(200).json({ success: true });
      }
    } else {
      return res.status(400).json({ error: 'Unknown purpose' });
    }

    const otp = generateOtp();
    await sql`
      INSERT INTO otp_challenges (application_id, purpose, channel, email, otp_hash, expires_at)
      VALUES (${app.id}, ${purpose}, 'email', ${normalized}, ${hashOtp(otp)}, now() + interval '10 minutes')
    `;
    await sendOtpEmail(normalized, otp);
    await logEvent(app.id, 'system', 'Verification code sent for ' + purpose);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('applications/otp-request error:', err);
    return res.status(500).json({ error: 'Could not send verification code right now. Please try again.' });
  }
};
