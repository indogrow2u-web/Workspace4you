// ============================================================
// Workspace4You — Admin: publish an agreement template version
// File: api/agreement-templates/publish.js
// Only one template may be 'published' at a time — publishing a new
// one archives whichever was published before. This never touches
// any application's already-frozen agreement_snapshot.
// ============================================================

const { sql } = require('../_db');
const { verifyAdminToken } = require('../_adminAuth');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const id = body && body.id;
    if (!id) return res.status(400).json({ error: 'Missing template id' });

    const { rows } = await sql`SELECT status FROM agreement_templates WHERE id = ${id} LIMIT 1`;
    const template = rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (template.status !== 'draft') {
      return res.status(400).json({ error: 'Only a draft can be published' });
    }

    await sql`UPDATE agreement_templates SET status = 'archived' WHERE status = 'published'`;
    await sql`UPDATE agreement_templates SET status = 'published', published_at = now() WHERE id = ${id}`;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('agreement-templates/publish error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
