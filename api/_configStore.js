// ============================================================
// Workspace4You — Shared site-config reader (Vercel Blob)
// Used by api/config.js (admin read/write) and api/razorpay.js
// (server-side price lookup for order creation).
// ============================================================

const { list } = require('@vercel/blob');

const CONFIG_PATHNAME = 'site-config.json';

const DEFAULT_CONFIG = {
  prices: {
    virtualAddressMonthly: 1799,
    virtualAddressAnnual: 1499,
    businessStarter: 4999,
    dayPass: 800,
    openDesk: 11999,
    powerSeat: 13499,
    semiEnclosed: 14999,
    glassCabin: 19999,
    meetingRoomHourly: 500
  },
  contact: {
    phone: '+91 77180 86678',
    whatsapp: '917718086678',
    email: 'workspace2you@gmail.com',
    address: '115, Udyog Mandir No.1, 1st Floor, B.K. Road, 7/C Pitamber Lane, Mahim West, Mumbai 400016'
  },
  hero: {
    line1: 'Work Smarter.',
    line2: 'Grow Faster.',
    line3: "Mumbai's Premium",
    line4: 'Workspace Hub',
    badge: 'Trusted by 500+ Businesses in Mumbai'
  },
  hours: {
    opening: '10 AM–7 PM',
    days: 'Mon–Sat',
    badge: 'Open Now · Mon–Sat, 10 AM–7 PM'
  }
};

async function readConfig() {
  try {
    const { blobs } = await list({ prefix: CONFIG_PATHNAME, limit: 1 });
    if (!blobs.length) return DEFAULT_CONFIG;
    const res = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_CONFIG;
    return await res.json();
  } catch (err) {
    return DEFAULT_CONFIG;
  }
}

module.exports = { DEFAULT_CONFIG, CONFIG_PATHNAME, readConfig };
