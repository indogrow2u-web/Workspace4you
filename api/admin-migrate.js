// ============================================================
// Workspace4You — Admin: run the database migration
// File: api/admin-migrate.js
//
// Applies db/schema.sql through the exact same connection every
// other endpoint already uses (api/_db.js) — removes any chance of
// running the schema against the wrong Supabase project by mistake
// in a browser-based SQL editor. Safe to run repeatedly: every
// statement in schema.sql is CREATE ... IF NOT EXISTS or
// ALTER ... ADD COLUMN IF NOT EXISTS.
//
// db/schema.sql is bundled into this function's deployment via
// vercel.json's "functions" -> includeFiles config (a plain
// fs.readFileSync path isn't picked up by Vercel's automatic file
// tracing the way a require()'d file is).
// ============================================================

const fs = require('fs');
const path = require('path');
const { rawQuery } = require('./_db');
const { verifyAdminToken } = require('./_adminAuth');
const { setCorsHeaders } = require('./_cors');

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
    const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await rawQuery(schemaSql);
    return res.status(200).json({ success: true, message: 'Schema applied successfully.' });
  } catch (err) {
    console.error('admin-migrate error:', err);
    return res.status(500).json({ error: err.message });
  }
};
