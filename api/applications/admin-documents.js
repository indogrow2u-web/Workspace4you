// ============================================================
// Workspace4You — Admin: list an application's uploaded documents
// File: api/applications/admin-documents.js
// Metadata only — the `data` column is never selected here, only
// fetched (and streamed) by document.js when a specific file is
// actually opened.
// ============================================================

const { sql } = require('../_db');
const { requireAdminApplication } = require('../_adminAppLoad');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const app = await requireAdminApplication(req, res, req.query && req.query.code);
  if (!app) return;

  try {
    const { rows } = await sql`
      SELECT id, doc_type, filename, mime_type, size_bytes, uploaded_by, created_at
      FROM application_documents WHERE application_id = ${app.id}
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ success: true, documents: rows });
  } catch (err) {
    console.error('applications/admin-documents error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
