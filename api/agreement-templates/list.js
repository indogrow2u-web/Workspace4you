// ============================================================
// Workspace4You — Admin: list agreement template versions
// File: api/agreement-templates/list.js
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
      SELECT id, version, content, status, created_at, published_at
      FROM agreement_templates ORDER BY created_at DESC
    `;
    return res.status(200).json({ success: true, templates: rows });
  } catch (err) {
    console.error('agreement-templates/list error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
