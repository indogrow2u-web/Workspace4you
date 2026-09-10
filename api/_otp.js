// ============================================================
// Workspace4You — OTP generation/hashing (email channel)
// SMS OTP is on hold pending MSG91's DLT template approval —
// verification currently runs over email via Resend instead. The
// otp_challenges table already has a "channel" column, so adding
// SMS back later is just a second code path, not a redesign.
// ============================================================

const crypto = require('crypto');

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)); // 6-digit, never leading-zero-only confusion
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function verifyOtpHash(otp, hash) {
  const given = Buffer.from(hashOtp(otp));
  const expected = Buffer.from(String(hash || ''));
  if (given.length !== expected.length || expected.length === 0) return false;
  return crypto.timingSafeEqual(given, expected);
}

function normalizeEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

module.exports = { generateOtp, hashOtp, verifyOtpHash, normalizeEmail };
