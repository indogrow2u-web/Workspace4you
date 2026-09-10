// ============================================================
// Workspace4you — Notifications (email via Resend, SMS stub)
// Env vars: RESEND_API_KEY, RESEND_FROM_EMAIL (optional — the
// "from" address must be at a domain verified in Resend)
//
// OTP verification currently runs over email (sendOtpEmail below),
// not SMS — see api/_otp.js. SMS (both OTP and plain receipts) is
// on hold pending a DLT-registered MSG91 template; sendSms() is a
// safe no-op until MSG91_SMS_TEMPLATE_ID/MSG91_SMS_SENDER_ID are
// configured, so callers can invoke it unconditionally now and it
// will start working the moment that template exists.
// ============================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Workspace4you <applications@workspace4you.co>';

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_SMS_TEMPLATE_ID = process.env.MSG91_SMS_TEMPLATE_ID;
const MSG91_SMS_SENDER_ID = process.env.MSG91_SMS_SENDER_ID;

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || !to) return { sent: false };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, html })
    });
    if (!res.ok) {
      console.error('Resend error:', await res.text());
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error('Email send failed:', err);
    return { sent: false };
  }
}

// No-op until a DLT-approved transactional SMS template is configured.
async function sendSms(mobile, message) {
  if (!MSG91_AUTH_KEY || !MSG91_SMS_TEMPLATE_ID || !MSG91_SMS_SENDER_ID || !mobile) {
    return { sent: false, reason: 'sms_not_configured' };
  }
  try {
    await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: MSG91_SMS_TEMPLATE_ID,
        sender: MSG91_SMS_SENDER_ID,
        recipients: [{ mobiles: mobile, VAR1: message }]
      })
    });
    return { sent: true };
  } catch (err) {
    console.error('SMS send failed:', err);
    return { sent: false };
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendOtpEmail(email, otp) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#101828">
      <h2 style="color:#0B3A8D">Workspace4you</h2>
      <p>Your verification code is:</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:6px;color:#0B3A8D">${escapeHtml(otp)}</p>
      <p style="color:#6B7280;font-size:13px">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    </div>
  `;
  return sendEmail(email, `${otp} is your Workspace4you verification code`, html);
}

async function sendApplicationReceiptEmail(app, resumeUrl, phoneDisplay) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">
      <h2 style="color:#0B3A8D">Workspace4you</h2>
      <p>Your payment has been received successfully.</p>
      <p><strong>Application ID:</strong> ${escapeHtml(app.application_code)}<br>
      <strong>Amount Paid:</strong> ₹${Number(app.payment_amount || 0).toLocaleString('en-IN')}</p>
      <p>Your application is now pending verification.</p>
      <p><a href="${escapeHtml(resumeUrl)}" style="display:inline-block;background:#0B3A8D;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Continue Application</a></p>
      <p>Our team will review your application within 24 hours.</p>
      <p>Need faster processing? Call <a href="tel:${escapeHtml(phoneDisplay)}">${escapeHtml(phoneDisplay)}</a></p>
    </div>
  `;
  return sendEmail(app.email, `Workspace4you — Application ${app.application_code} received`, html);
}

async function sendExpiryReminderEmail(app, daysLeft, contactPhone, contactEmail) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">
      <h2 style="color:#0B3A8D">Workspace4you</h2>
      <p>Your Virtual Address is renewing soon.</p>
      <p><strong>Application ID:</strong> ${escapeHtml(app.application_code)}<br>
      <strong>Business:</strong> ${escapeHtml(app.business_name || '')}<br>
      <strong>Valid until:</strong> ${escapeHtml(app.expiry_date)} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)</p>
      <p>To renew, please contact us before the expiry date so your address stays active without interruption.</p>
      <p>Call <a href="tel:${escapeHtml(contactPhone)}">${escapeHtml(contactPhone)}</a> or email <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.</p>
    </div>
  `;
  return sendEmail(app.email, `Workspace4you — Your Virtual Address renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, html);
}

async function sendExpiredEmail(app, contactPhone, contactEmail) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">
      <h2 style="color:#0B3A8D">Workspace4you</h2>
      <p>Your Virtual Address has expired.</p>
      <p><strong>Application ID:</strong> ${escapeHtml(app.application_code)}<br>
      <strong>Business:</strong> ${escapeHtml(app.business_name || '')}<br>
      <strong>Expired on:</strong> ${escapeHtml(app.expiry_date)}</p>
      <p>To reactivate your Virtual Address, please contact us as soon as possible.</p>
      <p>Call <a href="tel:${escapeHtml(contactPhone)}">${escapeHtml(contactPhone)}</a> or email <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.</p>
    </div>
  `;
  return sendEmail(app.email, `Workspace4you — Your Virtual Address (${app.application_code}) has expired`, html);
}

module.exports = { sendEmail, sendSms, sendOtpEmail, sendApplicationReceiptEmail, sendExpiryReminderEmail, sendExpiredEmail };
