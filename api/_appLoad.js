// ============================================================
// Workspace4You — Shared "load + authenticate this application" helper
// Used by every customer-facing applications/* endpoint that needs
// to act on a specific application as its owner.
// ============================================================

const { getApplicationByCode } = require('./_db');
const { verifyAccessToken, getBearerToken } = require('./_appAuth');

// Loads the application by code and checks the bearer token against its
// stored hash. Writes an error response and returns null if anything is
// wrong; otherwise returns the application row.
async function requireOwnedApplication(req, res, code) {
  if (!code) {
    res.status(400).json({ error: 'Missing application code' });
    return null;
  }
  const app = await getApplicationByCode(code);
  if (!app) {
    res.status(404).json({ error: 'Application not found' });
    return null;
  }
  const token = getBearerToken(req);
  if (!(await verifyAccessToken(app, token))) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return app;
}

module.exports = { requireOwnedApplication };
