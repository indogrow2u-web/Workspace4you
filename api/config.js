// ============================================================
// Workspace4You — Site Config Reader/Writer
// File: api/config.js
// Uses Vercel Blob to store prices & content. GET is public (the
// site loads it on every visit). POST requires a valid admin
// session token — see api/admin-login.js and api/_adminAuth.js.
// ============================================================

const { put } = require('@vercel/blob');
const { CONFIG_PATHNAME, readConfig } = require('./_configStore');
const { verifyAdminToken } = require('./_adminAuth');
const { setCorsHeaders } = require('./_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET — public, no auth needed (site loads this on every visit)
  if (req.method === 'GET') {
    const config = await readConfig();
    return res.status(200).json(config);
  }

  // POST — admin only
  if (req.method === 'POST') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
    if (!verifyAdminToken(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const existing = await readConfig();

      const merged = {
        prices: { ...existing.prices, ...(incoming.prices || {}) },
        contact: { ...existing.contact, ...(incoming.contact || {}) },
        hero: { ...existing.hero, ...(incoming.hero || {}) },
        hours: { ...existing.hours, ...(incoming.hours || {}) }
      };

      await put(CONFIG_PATHNAME, JSON.stringify(merged), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json'
      });

      return res.status(200).json({ success: true, config: merged });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
