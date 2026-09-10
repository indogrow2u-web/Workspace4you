// ============================================================
// Workspace4You — Stream one verification document back
// File: api/applications/document.js
// Authenticated only — either the application's own access token,
// or a valid admin session token. Never a public URL.
// ============================================================

const { sql, getApplicationByCode } = require('../_db');
const { verifyAccessToken } = require('../_appAuth');
const { verifyAdminToken } = require('../_adminAuth');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const code = req.query && req.query.code;
    const docId = req.query && req.query.docId;
    if (!code || !docId) return res.status(400).json({ error: 'Missing code or docId' });

    const app = await getApplicationByCode(code);
    if (!app) return res.status(404).json({ error: 'Not found' });

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
    const isAdmin = verifyAdminToken(token);
    // verifyAccessToken is async (it's a DB lookup) — must be awaited, not
    // just referenced, or this would always be a truthy Promise regardless
    // of whether the token is actually valid.
    const isOwner = isAdmin ? false : await verifyAccessToken(app, token);
    if (!isAdmin && !isOwner) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { rows } = await sql`
      SELECT filename, mime_type, data FROM application_documents
      WHERE id = ${docId} AND application_id = ${app.id}
      LIMIT 1
    `;
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', 'inline; filename="' + doc.filename.replace(/"/g, '') + '"');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(doc.data);
  } catch (err) {
    console.error('applications/document error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
