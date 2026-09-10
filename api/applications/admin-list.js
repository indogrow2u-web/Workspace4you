// ============================================================
// Workspace4You — Admin: list Virtual Address applications
// File: api/applications/admin-list.js
// Read-only in Phase 1 (review/approve/agreement/activation are
// Phase 2). Returns everything; the admin panel filters/searches
// client-side, same pattern as the existing Leads tab.
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
      SELECT application_code, status, plan_name, duration, full_name, mobile, email,
             business_type, business_name, gstin, cin, llpin, inventory_requested,
             payment_status, payment_amount, verification_status, admin_review_status,
             agreement_status, activation_status, created_at, updated_at
      FROM applications
      ORDER BY created_at DESC
      LIMIT 1000
    `;
    return res.status(200).json({ success: true, applications: rows });
  } catch (err) {
    console.error('applications/admin-list error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
