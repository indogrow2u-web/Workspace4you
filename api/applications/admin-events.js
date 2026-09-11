// ============================================================
// Workspace4You — Admin: all application events (for funnel/drop-off analysis)
// File: api/applications/admin-events.js
//
// Every step transition (application created, personal/business/address
// saved, email verified, payment order created, payment verified) is
// already logged with a real timestamp in application_events via
// logEvent() at each step's endpoint — this just exposes the raw table
// so the admin panel can compute time-per-step and where applications
// stop progressing, entirely from real server-side data (immune to
// ad-blockers/sampling, unlike client analytics).
// ============================================================

const { sql } = require('../_db');
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
    const { rows } = await sql`
      SELECT application_id, event, created_at FROM application_events
      ORDER BY application_id ASC, created_at ASC
      LIMIT 20000
    `;
    return res.status(200).json({ success: true, events: rows });
  } catch (err) {
    console.error('applications/admin-events error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
