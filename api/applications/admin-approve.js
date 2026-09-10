// ============================================================
// Workspace4You — Admin: approve an application
// File: api/applications/admin-approve.js
// Hard gate (Rule 5/15): this is the ONLY thing that unlocks
// "Generate Agreement" — nothing before this point can produce a
// customer-facing agreement, no matter how far payment/verification
// have gotten.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireAdminApplication } = require('../_adminAppLoad');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const app = await requireAdminApplication(req, res, body && body.code);
    if (!app) return;

    if (app.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Cannot approve an application that has not been paid for' });
    }

    await sql`
      UPDATE applications SET
        status = 'approved',
        admin_review_status = 'approved',
        verification_status = CASE WHEN verification_status = 'passed' THEN verification_status ELSE 'passed' END,
        info_requested = NULL,
        updated_at = now()
      WHERE id = ${app.id}
    `;
    await logEvent(app.id, 'admin', 'Application approved');

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('applications/admin-approve error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
