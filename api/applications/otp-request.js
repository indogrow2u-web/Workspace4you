// ============================================================
// Workspace4You — Request a mobile OTP
// File: api/applications/otp-request.js
// Two purposes:
//  - "signup": Step 2 mobile verification for the customer's own
//    draft application (requires the application's access token).
//  - "track": Track Application access from any device — requires
//    knowing the Application ID AND the mobile number already on
//    file for it (never just the code alone).
// ============================================================

const { sql, getApplicationByCode, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { normalizeMobile, sendOtp, isConfigured } = require('../_otp');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!isConfigured()) {
    console.error('OTP error: MSG91_AUTH_KEY/MSG91_OTP_TEMPLATE_ID env vars not set');
    return res.status(500).json({ error: 'OTP verification is not configured yet' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, mobile, purpose } = body || {};

    const normalized = normalizeMobile(mobile);
    if (!normalized) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    }

    let app;
    if (purpose === 'signup') {
      app = await requireOwnedApplication(req, res, code);
      if (!app) return; // response already sent
      // Store the candidate number now — it only becomes "verified" once
      // otp-verify succeeds.
      await sql`UPDATE applications SET mobile = ${normalized}, updated_at = now() WHERE id = ${app.id}`;

    } else if (purpose === 'track') {
      app = await getApplicationByCode(code);
      // Don't reveal whether the code exists or whether the mobile matched —
      // same generic response either way, so Track Application can't be used
      // to enumerate valid Application IDs or phone numbers.
      if (!app || app.mobile !== normalized) {
        return res.status(200).json({ success: true });
      }
    } else {
      return res.status(400).json({ error: 'Unknown purpose' });
    }

    const otpResult = await sendOtp(normalized);

    await sql`
      INSERT INTO otp_challenges (application_id, purpose, mobile, msg91_request_id, expires_at)
      VALUES (${app.id}, ${purpose}, ${normalized}, ${otpResult.requestId}, now() + interval '10 minutes')
    `;
    await logEvent(app.id, 'system', 'OTP sent for ' + purpose);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('applications/otp-request error:', err);
    return res.status(500).json({ error: 'Could not send OTP right now. Please try again.' });
  }
};
