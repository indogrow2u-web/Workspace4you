// ============================================================
// Workspace4You — Shared CORS helper
// Only the site's own origins may call these APIs from a browser.
// (Server-to-server calls, e.g. the Razorpay webhook, don't send
// an Origin header and are unaffected by this.)
// ============================================================

const ALLOWED_ORIGINS = [
  'https://workspace4you.co',
  'https://www.workspace4you.co'
];

function setCorsHeaders(req, res, opts) {
  opts = opts || {};
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Headers', opts.allowAuthHeader ? 'Content-Type, Authorization' : 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', opts.methods || 'GET, POST, OPTIONS');
}

module.exports = { ALLOWED_ORIGINS, setCorsHeaders };
