// ============================================================
// Workspace4You — Application status snapshot (Track Application)
// File: api/applications/track.js
// Returns everything the customer's own status dashboard needs.
// Never returns access_token_hash or internal admin_notes.
// ============================================================

const { sql } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const code = req.query && req.query.code;
    const app = await requireOwnedApplication(req, res, code);
    if (!app) return;

    const { rows: events } = await sql`
      SELECT actor, event, created_at FROM application_events
      WHERE application_id = ${app.id} AND actor != 'admin_internal'
      ORDER BY created_at ASC
    `;

    return res.status(200).json({
      success: true,
      application: {
        code: app.application_code,
        status: app.status,
        planName: app.plan_name,
        duration: app.duration,
        fullName: app.full_name,
        mobile: app.mobile,
        mobileVerified: !!app.mobile_verified_at,
        email: app.email,
        businessType: app.business_type,
        businessName: app.business_name,
        addressUsage: app.address_usage,
        inventoryRequested: app.inventory_requested,
        paymentStatus: app.payment_status,
        paymentAmount: app.payment_amount,
        razorpayPaymentId: app.razorpay_payment_id,
        verificationStatus: app.verification_status,
        adminReviewStatus: app.admin_review_status,
        infoRequested: app.info_requested,
        agreementVersion: app.agreement_version,
        agreementStatus: app.agreement_status,
        agreementAcceptedAt: app.agreement_accepted_at,
        activationStatus: app.activation_status,
        activationDate: app.activation_date,
        expiryDate: app.expiry_date,
        createdAt: app.created_at
      },
      events: events
    });
  } catch (err) {
    console.error('applications/track error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
