// ============================================================
// Workspace4You — Verify payment for an application (Steps 6-7)
// File: api/applications/verify-payment.js
// Confirms the Razorpay signature, then — and only then — marks
// payment_status = paid and moves the application to
// "verification_pending". This does NOT approve or activate
// anything (Rules 1-2). Idempotent: calling it again for an
// already-paid application just returns success without
// re-sending the receipt.
//
// The Razorpay webhook (api/razorpay-webhook.js) is the backstop
// for this same transition, in case the browser never calls back.
// ============================================================

const crypto = require('crypto');
const { sql, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { generateResumeToken } = require('../_appAuth');
const { sendApplicationReceiptEmail } = require('../_notify');
const { setCorsHeaders } = require('../_cors');

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const SITE_URL = process.env.SITE_URL || 'https://workspace4you.co';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE_DISPLAY || '+91 77180 86678';

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!RAZORPAY_KEY_SECRET) {
    console.error('applications/verify-payment error: RAZORPAY_KEY_SECRET env var not set');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};

    const app = await requireOwnedApplication(req, res, code);
    if (!app) return;

    if (app.payment_status === 'paid') {
      // Already processed (e.g. the webhook beat us to it, or the browser retried).
      return res.status(200).json({ success: true, applicationCode: app.application_code, paymentId: app.razorpay_payment_id, amount: app.payment_amount });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || razorpay_order_id !== app.razorpay_order_id) {
      return res.status(400).json({ error: 'Payment details do not match this application' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    const isValid = expectedSignature.length === razorpay_signature.length &&
      crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpay_signature));

    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }

    await sql`
      UPDATE applications SET
        razorpay_payment_id = ${razorpay_payment_id},
        payment_status = 'paid',
        payment_verified_at = now(),
        status = 'verification_pending',
        updated_at = now()
      WHERE id = ${app.id}
    `;
    await logEvent(app.id, 'system', 'Payment verified — ₹' + app.payment_amount + ' (Razorpay ' + razorpay_payment_id + ')');
    await logEvent(app.id, 'system', 'Status → Verification Pending');

    const resumeToken = generateResumeToken(app.application_code);
    const resumeUrl = resumeToken ? `${SITE_URL}/track.html?resume=${resumeToken}` : `${SITE_URL}/track.html`;

    if (app.email) {
      await sendApplicationReceiptEmail(
        { application_code: app.application_code, payment_amount: app.payment_amount, email: app.email },
        resumeUrl,
        SUPPORT_PHONE
      );
    }

    return res.status(200).json({ success: true, applicationCode: app.application_code, paymentId: razorpay_payment_id, amount: app.payment_amount });
  } catch (err) {
    console.error('applications/verify-payment error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
