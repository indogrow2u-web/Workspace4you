// ============================================================
// Workspace4You — Site Config Reader/Writer
// File: api/config.js
// Uses Vercel Blob to store prices & content
// ============================================================

const { put, list } = require('@vercel/blob');

const ADMIN_KEY = 'workspace4you2024'; // must match admin.html
const CONFIG_PATHNAME = 'site-config.json';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

const DEFAULT_CONFIG = {
  prices: {
    virtualAddress: 597,
    businessStarter: 4999,
    dayPass: 699,
    dedicatedDesk: 11999
  },
  contact: {
    phone: '+91 77180 86678',
    whatsapp: '917718086678',
    email: 'workspace2you@gmail.com',
    address: '115, Udyog Mandir No.1, 1st Floor, Mahim West, Mumbai 400016'
  },
  hero: {
    line1: 'Work Smarter.',
    line2: 'Grow Faster.',
    line3: "Mumbai's Premium",
    line4: 'Workspace Hub',
    badge: 'Trusted by 500+ Businesses in Mumbai'
  },
  hours: {
    opening: '8 AM–10 PM',
    days: 'Mon–Sun (365 days)',
    badge: 'Now Open · 8 AM–10 PM'
  }
};

async function readConfig() {
  const { blobs } = await list({ prefix: CONFIG_PATHNAME, limit: 1 });
  if (!blobs.length) return DEFAULT_CONFIG;
  const res = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!res.ok) return DEFAULT_CONFIG;
  return res.json();
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET — public, no auth needed (site loads this on every visit)
  if (req.method === 'GET') {
    try {
      const config = await readConfig();
      return res.status(200).json(config);
    } catch (err) {
      // Return defaults if blob doesn't exist yet
      return res.status(200).json(DEFAULT_CONFIG);
    }
  }

  // POST — admin only
  if (req.method === 'POST') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      let existing = DEFAULT_CONFIG;
      try {
        existing = await readConfig();
      } catch (e) {}

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
