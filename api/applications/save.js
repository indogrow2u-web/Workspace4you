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

// Mirrors apply.html's BIZ_FIELD_MAP / which fields carry a "*" for each
// business type — enforced here too so a direct API call can't skip past
// the fields the client marks as required.
const REQUIRED_FIELDS_BY_TYPE = {
  'Proprietorship': { businessName: 'Business Name', businessActivity: 'Business Activity', pan: 'PAN' },
  'Private Limited Company': { businessName: 'Business Name', pan: 'PAN', cin: 'CIN' },
  'LLP': { businessName: 'Business Name', pan: 'PAN', llpin: 'LLPIN' },
  'Partnership': { businessName: 'Business Name', businessActivity: 'Business Activity', pan: 'PAN' },
  'Other': { businessName: 'Business Name', businessActivity: 'Business Activity', pan: 'PAN' }
};
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      const fullName = clip(d.fullName, 120);
      const mobile = clip(d.mobile, 20);
      const email = clip(d.email, 160).toLowerCase();

      if (!fullName) return res.status(400).json({ error: 'Please enter your full name' });
      if (mobile.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
      if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });

      // If the email changed from whatever was actually OTP-verified, the
      // verification no longer applies to it — don't let a stale
      // emailVerified flag on the client carry an unverified address
      // through as if it were confirmed.
      const emailChanged = (app.email || '').toLowerCase() !== email.toLowerCase();

      await sql`
        UPDATE applications SET
          full_name = ${fullName},
          mobile = ${mobile},
          email = ${email},
          email_verified_at = CASE WHEN ${emailChanged} THEN NULL ELSE email_verified_at END,
          updated_at = now()
        WHERE id = ${app.id}
      `;
      await logEvent(app.id, 'customer', 'Personal details saved' + (emailChanged ? ' (email changed — re-verification required)' : ''));

    } else if (step === 'business') {
      const businessType = BUSINESS_TYPES.indexOf(d.businessType) !== -1 ? d.businessType : null;
      if (!businessType) {
        return res.status(400).json({ error: 'Please select a business type' });
      }

      const required = REQUIRED_FIELDS_BY_TYPE[businessType];
      const missingLabels = Object.keys(required).filter(function (field) { return !clip(d[field], 200); }).map(function (field) { return required[field]; });
      if (missingLabels.length) {
        return res.status(400).json({ error: 'Please fill in: ' + missingLabels.join(', ') });
      }

      const pan = clip(d.pan, 20).toUpperCase();
      if (!PAN_REGEX.test(pan)) {
        return res.status(400).json({ error: "PAN doesn't look valid — it should be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)" });
      }

      await sql`
        UPDATE applications SET
          business_type = ${businessType},
          business_name = ${clip(d.businessName, 160)},
          business_activity = ${clip(d.businessActivity, 200)},
          pan = ${pan},
          gstin = ${clip(d.gstin, 20).toUpperCase()},
          udyam_number = ${clip(d.udyamNumber, 30).toUpperCase()},
          cin = ${clip(d.cin, 30).toUpperCase()},
          llpin = ${clip(d.llpin, 30).toUpperCase()},
          no_gst_udyam = ${!!d.noGstUdyam},
          updated_at = now()
        WHERE id = ${app.id}
      `;
      await logEvent(app.id, 'customer', 'Business details saved (' + businessType + ')');

    } else if (step === 'duration') {
      const dur = d.duration === 'annual' ? 'annual' : 'month';
      await sql`UPDATE applications SET duration = ${dur}, updated_at = now() WHERE id = ${app.id}`;
      await logEvent(app.id, 'customer', 'Plan term changed to ' + dur);

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
