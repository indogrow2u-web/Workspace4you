// ============================================================
// Workspace4You — Admin session token verification
// Tokens are issued by api/admin-login.js after checking the
// admin password (ADMIN_PASSWORD) and are of the form
// "<expiryMs>.<hmac>", signed with ADMIN_SESSION_SECRET. The
// admin password itself is never embedded in admin.html anymore.
// ============================================================

const crypto = require('crypto');

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;

function verifyAdminToken(token) {
  if (!token || !SESSION_SECRET) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;

  const exp = parseInt(parts[0], 10);
  if (!exp || Date.now() > exp) return false;

  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(parts[1]);
  if (expectedBuf.length !== givenBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

module.exports = { verifyAdminToken };
