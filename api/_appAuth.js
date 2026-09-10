// ============================================================
// Workspace4You — Application access-token + resume-link auth
//
// Two distinct credentials:
//  - Access token: a random secret minted when an application is
//    created (or when a customer re-authenticates via OTP or a
//    resume link). Stored server-side only as a SHA-256 hash. The
//    browser holds the raw token (localStorage) and sends it as
//    Authorization: Bearer <token> on every write/read for that
//    application. This is what lets the SAME browser keep working
//    across reloads without re-verifying anything.
//  - Resume link token: a signed, expiring "magic link" token
//    (HMAC'd with APP_SESSION_SECRET) embedded in the email/SMS
//    sent after payment, so a customer can come back on ANY device
//    without needing to remember an access token. Visiting it mints
//    a fresh access token server-side.
//
// Neither credential is derivable from the Application ID alone —
// satisfies "Application ID alone must not expose customer info."
// ============================================================

const crypto = require('crypto');

const SESSION_SECRET = process.env.APP_SESSION_SECRET;
const RESUME_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateAccessToken() {
  return crypto.randomBytes(24).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function verifyAccessToken(applicationRow, providedToken) {
  if (!applicationRow || !providedToken) return false;
  const expected = Buffer.from(applicationRow.access_token_hash || '');
  const given = Buffer.from(hashToken(providedToken));
  if (expected.length !== given.length || expected.length === 0) return false;
  return crypto.timingSafeEqual(expected, given);
}

function getBearerToken(req) {
  const header = req.headers['authorization'] || '';
  return header.indexOf('Bearer ') === 0 ? header.slice(7) : '';
}

// ---- Resume link (magic link) ----

function generateResumeToken(applicationCode) {
  if (!SESSION_SECRET) return null;
  const exp = Date.now() + RESUME_LINK_TTL_MS;
  const payload = applicationCode + '.' + exp;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload + '.' + sig).toString('base64url');
}

function verifyResumeToken(token) {
  if (!token || !SESSION_SECRET) return null;
  let decoded;
  try {
    decoded = Buffer.from(String(token), 'base64url').toString('utf8');
  } catch (err) {
    return null;
  }
  const parts = decoded.split('.');
  if (parts.length !== 3) return null;
  const [code, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!exp || Date.now() > exp) return null;

  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(code + '.' + expStr).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(sig);
  if (expectedBuf.length !== givenBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, givenBuf)) return null;

  return { applicationCode: code };
}

module.exports = {
  generateAccessToken,
  hashToken,
  verifyAccessToken,
  getBearerToken,
  generateResumeToken,
  verifyResumeToken
};
