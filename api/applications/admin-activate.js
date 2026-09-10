// ============================================================
// Workspace4you — Admin: activate the Virtual Address (Step 14)
// File: api/applications/admin-activate.js
// Hard gate: only callable once the customer has actually accepted
// the agreement — payment or admin approval alone are not enough.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireAdminApplication } = require('../_adminAppLoad');
const { addMonths, formatDate, escapeHtml } = require('../_agreement');
const { sendEmail } = require('../_notify');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const app = await requireAdminApplication(req, res, body && body.code);
    if (!app) return;

    if (app.agreement_status !== 'accepted') {
      return res.status(400).json({ error: 'Customer must accept the agreement before activation' });
    }

    const start = new Date();
    const end = addMonths(start, app.duration === 'annual' ? 12 : 1);

    await sql`
      UPDATE applications SET
        activation_status = 'active',
        activation_date = ${start.toISOString().slice(0, 10)},
        expiry_date = ${end.toISOString().slice(0, 10)},
        status = 'active',
        updated_at = now()
      WHERE id = ${app.id}
    `;
    await logEvent(app.id, 'admin', 'Virtual Address activated (valid until ' + formatDate(end) + ')');

    if (app.email) {
      await sendEmail(
        app.email,
        'Workspace4you — Your Virtual Address is now active! (' + app.application_code + ')',
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">' +
        '<h2 style="color:#059669">Your Virtual Address is now active ✓</h2>' +
        '<p><strong>Business:</strong> ' + escapeHtml(app.business_name || '') + '<br>' +
        '<strong>Plan:</strong> ' + app.plan_name + ' (' + (app.duration === 'annual' ? '12 Months' : 'Monthly') + ')<br>' +
        '<strong>Valid until:</strong> ' + formatDate(end) + '</p>' +
        '<p>You can download your agreement anytime from Track Application.</p>' +
        '</div>'
      );
    }

    return res.status(200).json({ success: true, activationDate: start.toISOString().slice(0, 10), expiryDate: end.toISOString().slice(0, 10) });
  } catch (err) {
    console.error('applications/admin-activate error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
