// ============================================================
// Workspace4You — Admin: single application detail + audit trail
// File: api/applications/admin-detail.js
// Read-only in Phase 1 — approve/reject/request-info/generate
// agreement/activate actions land in Phase 2.
// ============================================================

const { sql, getApplicationByCode } = require('../_db');
const { verifyAdminToken } = require('../_adminAuth');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const code = req.query && req.query.code;
    const app = await getApplicationByCode(code);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const { rows: events } = await sql`
      SELECT actor, event, created_at FROM application_events
      WHERE application_id = ${app.id}
      ORDER BY created_at ASC
    `;

    const { access_token_hash, ...safeApp } = app;
    return res.status(200).json({ success: true, application: safeApp, events: events });
  } catch (err) {
    console.error('applications/admin-detail error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
