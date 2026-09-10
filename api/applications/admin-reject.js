// ============================================================
// Workspace4You — Admin: reject an application
// File: api/applications/admin-reject.js
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireAdminApplication } = require('../_adminAppLoad');
const { sendEmail } = require('../_notify');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const reason = String((body && body.reason) || '').trim().slice(0, 2000);
    const app = await requireAdminApplication(req, res, body && body.code);
    if (!app) return;

    await sql`
      UPDATE applications SET
        status = 'rejected',
        admin_review_status = 'rejected',
        admin_notes = ${reason || null},
        refund_status = CASE WHEN payment_status = 'paid' THEN 'pending' ELSE refund_status END,
        updated_at = now()
      WHERE id = ${app.id}
    `;
    await logEvent(app.id, 'admin', 'Application rejected' + (reason ? ': ' + reason : ''));

    if (app.email) {
      await sendEmail(
        app.email,
        'Workspace4You — Update on your application ' + app.application_code,
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">' +
        '<h2 style="color:#0B3A8D">Workspace4You</h2>' +
        '<p>We\'re sorry — we were unable to approve your Virtual Address application ' + app.application_code + '.</p>' +
        (reason ? '<p><strong>Reason:</strong> ' + reason + '</p>' : '') +
        (app.payment_status === 'paid' ? '<p>Your payment will be refunded to your original payment method.</p>' : '') +
        '<p>If you have questions, please reply to this email or contact us on WhatsApp.</p>' +
        '</div>'
      );
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('applications/admin-reject error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
