// ============================================================
// Workspace4You — Customer: list my own uploaded documents
// File: api/applications/my-documents.js
// Metadata only, owner-authenticated. Lets the customer see what
// they've already submitted so a second "Request More Information"
// round doesn't feel like starting over.
// ============================================================

const { sql } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const app = await requireOwnedApplication(req, res, req.query && req.query.code);
  if (!app) return;

  try {
    const { rows } = await sql`
      SELECT id, doc_type, filename, mime_type, size_bytes, created_at
      FROM application_documents WHERE application_id = ${app.id}
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ success: true, documents: rows });
  } catch (err) {
    console.error('applications/my-documents error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
