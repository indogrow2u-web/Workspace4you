// ============================================================
// Workspace4You — OTP send rate limiting
// Backed by otp_challenges' own created_at history — no separate
// store needed. Limits modeled on common OTP-provider defaults
// (Twilio Verify / Firebase Auth style): a short cooldown between
// sends, a per-identifier hourly cap, and a broader per-IP daily cap
// as defense against someone cycling through many different emails.
// ============================================================

const { sql } = require('./_db');

const COOLDOWN_SECONDS = 60;
const MAX_PER_EMAIL_PER_HOUR = 5;
const MAX_PER_IP_PER_DAY = 20;

async function checkOtpRateLimit(email, ip) {
  // COOLDOWN_SECONDS must stay OUTSIDE the quoted interval literal — a
  // value interpolated inside 'interval '${x} seconds'' becomes a bound
  // parameter placed inside a quoted string in the generated SQL text,
  // where Postgres won't substitute it, producing invalid interval syntax.
  // Multiplying a fixed interval unit by a bound number avoids that.
  const { rows: recent } = await sql`
    SELECT 1 FROM otp_challenges
    WHERE email = ${email} AND created_at > now() - interval '1 second' * ${COOLDOWN_SECONDS}
    LIMIT 1
  `;
  if (recent.length) {
    return { allowed: false, reason: 'Please wait a minute before requesting another code.' };
  }

  const { rows: hourly } = await sql`
    SELECT COUNT(*)::int AS count FROM otp_challenges
    WHERE email = ${email} AND created_at > now() - interval '1 hour'
  `;
  if (hourly[0] && hourly[0].count >= MAX_PER_EMAIL_PER_HOUR) {
    return { allowed: false, reason: 'Too many code requests for this email. Please try again in an hour.' };
  }

  if (ip) {
    const { rows: daily } = await sql`
      SELECT COUNT(*)::int AS count FROM otp_challenges
      WHERE ip = ${ip} AND created_at > now() - interval '1 day'
    `;
    if (daily[0] && daily[0].count >= MAX_PER_IP_PER_DAY) {
      return { allowed: false, reason: 'Too many verification requests from this connection. Please try again later.' };
    }
  }

  return { allowed: true };
}

function getClientIp(req) {
  const header = req.headers['x-forwarded-for'] || '';
  return String(header).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
}

module.exports = { checkOtpRateLimit, getClientIp };
