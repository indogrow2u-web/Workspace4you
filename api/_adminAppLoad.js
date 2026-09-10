// ============================================================
// Workspace4You — Shared "admin token + load application" helper
// Used by every admin-only applications/* action endpoint.
// ============================================================

const { getApplicationByCode } = require('./_db');
const { verifyAdminToken } = require('./_adminAuth');

function getBearerToken(req) {
  const header = req.headers['authorization'] || '';
  return header.indexOf('Bearer ') === 0 ? header.slice(7) : '';
}

// Verifies the admin session token and loads the application by code.
// Writes an error response and returns null if anything is wrong.
async function requireAdminApplication(req, res, code) {
  if (!verifyAdminToken(getBearerToken(req))) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (!code) {
    res.status(400).json({ error: 'Missing application code' });
    return null;
  }
  const app = await getApplicationByCode(code);
  if (!app) {
    res.status(404).json({ error: 'Application not found' });
    return null;
  }
  return app;
}

module.exports = { requireAdminApplication, getBearerToken };
