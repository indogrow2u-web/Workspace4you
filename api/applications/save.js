// ============================================================
// Workspace4You — Progressive save for Steps 2-4
// File: api/applications/save.js
// Personal info, business info, and address usage each save
// independently as the customer completes them, so nothing is
// lost if they close the browser mid-form.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireOwnedApplication } = require('../_appLoad');
const { setCorsHeaders } = require('../_cors');

const BUSINESS_TYPES = ['Proprietorship', 'Private Limited Company', 'LLP', 'Partnership', 'Other'];
const ADDRESS_USES = [
  'GST Registration',
  'Company / LLP Registration',
  'Business Correspondence',
  'Website & Invoices',
  'Receiving Letters & Documents'
];

function clip(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200);
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, step, data } = body || {};

    const app = await requireOwnedApplication(req, res, code);
    if (!app) return; // response already sent

    const d = data || {};

    if (step === 'personal') {
      await sql`
        UPDATE applications SET
          full_name = ${clip(d.fullName, 120)},
          email = ${clip(d.email, 160)},
          updated_at = now()
        WHERE id = ${app.id}
      `;
      await logEvent(app.id, 'customer', 'Personal details saved');

    } else if (step === 'business') {
      const businessType = BUSINESS_TYPES.indexOf(d.businessType) !== -1 ? d.businessType : null;
      await sql`
        UPDATE applications SET
          business_type = ${businessType},
          business_name = ${clip(d.businessName, 160)},
          business_activity = ${clip(d.businessActivity, 200)},
          pan = ${clip(d.pan, 20).toUpperCase()},
          gstin = ${clip(d.gstin, 20).toUpperCase()},
          udyam_number = ${clip(d.udyamNumber, 30).toUpperCase()},
          cin = ${clip(d.cin, 30).toUpperCase()},
          llpin = ${clip(d.llpin, 30).toUpperCase()},
          no_gst_udyam = ${!!d.noGstUdyam},
          updated_at = now()
        WHERE id = ${app.id}
      `;
      await logEvent(app.id, 'customer', 'Business details saved (' + (businessType || 'unspecified') + ')');

    } else if (step === 'address') {
      const uses = Array.isArray(d.addressUsage) ? d.addressUsage.filter(function (u) { return ADDRESS_USES.indexOf(u) !== -1; }) : [];
      const inventoryRequested = !!d.inventoryRequested;
      await sql`
        UPDATE applications SET
          address_usage = ${JSON.stringify(uses)}::jsonb,
          inventory_requested = ${inventoryRequested},
          updated_at = now()
        WHERE id = ${app.id}
      `;
      await logEvent(app.id, 'customer', 'Address usage saved' + (inventoryRequested ? ' — inventory receiving requested (flagged for admin review)' : ''));

    } else {
      return res.status(400).json({ error: 'Unknown step' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('applications/save error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
