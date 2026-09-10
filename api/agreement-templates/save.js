// ============================================================
// Workspace4You — Admin: save an agreement template draft
// File: api/agreement-templates/save.js
// Creates a new draft, or updates an existing one — but only while
// it's still a draft. A published or archived version is frozen;
// editing it means creating a new draft instead (protects every
// application that already references that version's snapshot).
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
    const version = String((body && body.version) || '').trim().slice(0, 40);
    const content = String((body && body.content) || '');

    if (!version || !content.trim()) {
      return res.status(400).json({ error: 'Version and content are required' });
    }

    if (id) {
      const { rows: existingRows } = await sql`SELECT status FROM agreement_templates WHERE id = ${id} LIMIT 1`;
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      if (existing.status !== 'draft') {
        return res.status(400).json({ error: 'Only a draft can be edited — create a new draft instead' });
      }
      await sql`UPDATE agreement_templates SET version = ${version}, content = ${content} WHERE id = ${id}`;
      return res.status(200).json({ success: true, id: Number(id) });
    }

    const { rows } = await sql`
      INSERT INTO agreement_templates (version, content, status)
      VALUES (${version}, ${content}, 'draft')
      RETURNING id
    `;
    return res.status(200).json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('agreement-templates/save error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
