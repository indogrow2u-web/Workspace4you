// ============================================================
// Workspace4You — Resume an application via its magic link
// File: api/applications/resume.js
// Consumes the signed, expiring token from the receipt email/SMS
// and mints a fresh access token for the browser — no OTP needed,
// since possession of the emailed/texted link is itself the proof.
// ============================================================

const { getApplicationByCode, logEvent } = require('../_db');
const { verifyResumeToken, generateAccessToken, createSession } = require('../_appAuth');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = req.query && req.query.token;
    const verified = verifyResumeToken(token);
    if (!verified) {
      return res.status(400).json({ error: 'This link has expired or is invalid. Use Track Application instead.' });
    }

    const app = await getApplicationByCode(verified.applicationCode);
    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Additive — mints a new session without invalidating any other
    // device that's already authenticated for this application.
    const accessToken = generateAccessToken();
    await createSession(app.id, accessToken);
    await logEvent(app.id, 'customer', 'Resumed application via emailed link');

    return res.status(200).json({ success: true, code: app.application_code, accessToken });
  } catch (err) {
    console.error('applications/resume error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
