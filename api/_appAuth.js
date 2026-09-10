// ============================================================
// Workspace4You — Application access-token + resume-link auth
//
// Two distinct credentials:
//  - Access token: a random secret minted when an application is
//    created (or when a customer re-authenticates via OTP or a
//    resume link). Multiple can be valid at once, one per
//    device/browser that has authenticated — stored in
//    application_sessions (hashed), not compared against a single
//    column, so opening a resume link on a second device no longer
//    silently logs the first one out. The browser holds the raw
//    token (localStorage) and sends it as Authorization: Bearer
//    <token> on every write/read for that application.
//  - Resume link token: a signed, expiring "magic link" token
//    (HMAC'd with APP_SESSION_SECRET) embedded in the email sent
//    after payment/approval/etc, so a customer can come back on ANY
//    device without needing to remember an access token. Visiting it
//    mints a fresh access token (a new session) server-side.
//
// Neither credential is derivable from the Application ID alone —
// satisfies "Application ID alone must not expose customer info."
// ============================================================

const crypto = require('crypto');
const { sql } = require('./_db');

const SESSION_SECRET = process.env.APP_SESSION_SECRET;
const RESUME_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateAccessToken() {
  return crypto.randomBytes(24).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Records a new valid session for this application/token pair. Existing
// sessions (other devices) are left alone — this is additive, not a
// replace, which is the whole point of the fix.
async function createSession(applicationId, token) {
  await sql`
    INSERT INTO application_sessions (application_id, token_hash, expires_at)
    VALUES (${applicationId}, ${hashToken(token)}, now() + interval '90 days')
  `;
}

async function verifyAccessToken(applicationRow, providedToken) {
  if (!applicationRow || !providedToken) return false;
  const hash = hashToken(providedToken);
  const { rows } = await sql`
    SELECT id FROM application_sessions
    WHERE application_id = ${applicationRow.id} AND token_hash = ${hash} AND expires_at > now()
    LIMIT 1
  `;
  if (!rows[0]) return false;
  // Best-effort activity timestamp — never let this block a legitimate request.
  sql`UPDATE application_sessions SET last_used_at = now() WHERE id = ${rows[0].id}`.catch(function () {});
  return true;
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
  createSession,
  verifyAccessToken,
  getBearerToken,
  generateResumeToken,
  verifyResumeToken
};
