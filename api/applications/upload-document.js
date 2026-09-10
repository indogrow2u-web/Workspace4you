// ============================================================
// Workspace4You — Upload a verification document (Step 9)
// File: api/applications/upload-document.js
// Kept to ONE document per submission by design — low friction,
// per the "don't ask for a huge list of documents upfront" rule.
// Stored as bytes in Postgres, never a public URL — every read is
// gated by api/applications/document.js's owner-or-admin check.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { setCorsHeaders } = require('../_cors');

const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_DOC_TYPES = ['identity', 'business_proof', 'other'];

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, docType, filename, mimeType, dataBase64 } = body || {};

    const app = await requireOwnedApplication(req, res, code);
    if (!app) return;

    if (ALLOWED_DOC_TYPES.indexOf(docType) === -1) {
      return res.status(400).json({ error: 'Unknown document type' });
    }
    if (ALLOWED_TYPES.indexOf(mimeType) === -1) {
      return res.status(400).json({ error: 'File must be a JPG, PNG, or PDF' });
    }
    if (!dataBase64) {
      return res.status(400).json({ error: 'No file data received' });
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'File appears to be empty' });
    }
    if (buffer.length > MAX_BYTES) {
      return res.status(400).json({ error: 'File is too large — please keep it under 3MB' });
    }

    await sql`
      INSERT INTO application_documents (application_id, doc_type, filename, mime_type, size_bytes, data, uploaded_by)
      VALUES (${app.id}, ${docType}, ${String(filename || 'document').slice(0, 200)}, ${mimeType}, ${buffer.length}, ${buffer}, 'customer')
    `;

    // Move the application into review — but never restart it, and never
    // clobber a status further along than this (e.g. if it's already
    // approved for some other reason, leave it alone).
    if (['verification_pending', 'action_required', 'draft', 'payment_pending'].indexOf(app.status) !== -1) {
      await sql`
        UPDATE applications SET
          status = 'under_review',
          verification_status = 'pending',
          info_requested = NULL,
          updated_at = now()
        WHERE id = ${app.id}
      `;
    }
    await logEvent(app.id, 'customer', 'Uploaded document: ' + docType + ' (' + (filename || 'document') + ')');

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('applications/upload-document error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
