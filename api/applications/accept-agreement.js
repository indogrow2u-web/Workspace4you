// ============================================================
// Workspace4You — Customer accepts the agreement (Step 14)
// File: api/applications/accept-agreement.js
// The customer can only ever accept — never edit — the frozen
// agreement_snapshot already on their application row.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const app = await requireOwnedApplication(req, res, body && body.code);
    if (!app) return;

    if (app.agreement_status !== 'awaiting_acceptance') {
      return res.status(400).json({ error: 'No agreement is currently awaiting your acceptance' });
    }

    await sql`
      UPDATE applications SET
        agreement_status = 'accepted',
        agreement_accepted_at = now(),
        status = 'ready_for_activation',
        updated_at = now()
      WHERE id = ${app.id}
    `;

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 200);
    await logEvent(app.id, 'customer', 'Accepted Agreement ' + app.agreement_version + ' (IP: ' + (ip || 'unknown') + ', UA: ' + (ua || 'unknown') + ')');

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('applications/accept-agreement error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
