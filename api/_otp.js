// ============================================================
// Workspace4You — MSG91 OTP integration
// Requires an OTP template created in the MSG91 dashboard (DLT
// registration is mandatory for sending SMS to Indian numbers).
// Env vars: MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID
// ============================================================

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_OTP_TEMPLATE_ID = process.env.MSG91_OTP_TEMPLATE_ID;
const OTP_EXPIRY_MINUTES = 10;

function isConfigured() {
  return !!(MSG91_AUTH_KEY && MSG91_OTP_TEMPLATE_ID);
}

// Accepts any reasonable Indian mobile input and normalizes to "91XXXXXXXXXX".
// Returns null if it doesn't look like a valid 10-digit Indian mobile number.
function normalizeMobile(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10 || !/^[6-9]/.test(last10)) return null;
  return '91' + last10;
}

async function sendOtp(mobile) {
  if (!isConfigured()) throw new Error('OTP is not configured (MSG91_AUTH_KEY/MSG91_OTP_TEMPLATE_ID missing)');

  const res = await fetch('https://control.msg91.com/api/v5/otp', {
    method: 'POST',
    headers: { authkey: MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template_id: MSG91_OTP_TEMPLATE_ID,
      mobile: mobile,
      otp_expiry: OTP_EXPIRY_MINUTES
    })
  });
  const data = await res.json();
  if (data.type !== 'success') {
    throw new Error(data.message || 'Failed to send OTP');
  }
  return { requestId: data.message, expiryMinutes: OTP_EXPIRY_MINUTES };
}

async function verifyOtp(mobile, otp) {
  if (!isConfigured()) throw new Error('OTP is not configured (MSG91_AUTH_KEY/MSG91_OTP_TEMPLATE_ID missing)');

  const url = 'https://control.msg91.com/api/v5/otp/verify?otp=' + encodeURIComponent(otp) + '&mobile=' + encodeURIComponent(mobile);
  const res = await fetch(url, { headers: { authkey: MSG91_AUTH_KEY } });
  const data = await res.json();
  return data.type === 'success';
}

module.exports = { isConfigured, normalizeMobile, sendOtp, verifyOtp };
