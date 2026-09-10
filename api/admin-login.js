// ============================================================
// Workspace4You — Admin Login
// File: api/admin-login.js
// Verifies the admin password against ADMIN_PASSWORD (a server-only
// env var) and issues a signed, expiring session token. The real
// password no longer lives inside admin.html's source, so it can't
// be read by simply viewing the page.
// ============================================================

const crypto = require('crypto');
const { setCorsHeaders } = require('./_cors');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!ADMIN_PASSWORD || !SESSION_SECRET) {
    console.error('Admin login error: ADMIN_PASSWORD/ADMIN_SESSION_SECRET env vars not set');
    return res.status(500).json({ error: 'Admin login is not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const password = (body && body.password) || '';

    const given = Buffer.from(String(password));
    const expected = Buffer.from(ADMIN_PASSWORD);
    const valid = given.length === expected.length && crypto.timingSafeEqual(given, expected);

    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const exp = Date.now() + SESSION_TTL_MS;
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('hex');

    return res.status(200).json({ success: true, token: exp + '.' + sig, expiresAt: exp });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
