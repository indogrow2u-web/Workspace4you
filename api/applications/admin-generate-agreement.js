// ============================================================
// Workspace4you — Admin: generate the agreement (Step 13)
// File: api/applications/admin-generate-agreement.js
//
// CRITICAL RULES enforced here:
//  - Only callable by an admin (requireAdminApplication).
//  - Only works if the application is already 'approved' — payment,
//    verification, or document upload alone are never enough.
//  - Always renders from whichever agreement_templates row currently
//    has status='published' — never a template chosen by the caller.
//  - The rendered result is frozen into agreement_snapshot on the
//    application row. Publishing a new template version later can
//    never change an agreement that's already been generated, because
//    nothing here ever re-reads the snapshot from the live template.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireAdminApplication } = require('../_adminAppLoad');
const { readConfig } = require('../_configStore');
const { renderTemplate, buildAgreementVars } = require('../_agreement');
const { generateResumeToken } = require('../_appAuth');
const { sendEmail } = require('../_notify');
const { setCorsHeaders } = require('../_cors');

const SITE_URL = process.env.SITE_URL || 'https://workspace4you.co';

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const app = await requireAdminApplication(req, res, body && body.code);
    if (!app) return;

    if (app.status !== 'approved') {
      return res.status(400).json({ error: 'Application must be approved before an agreement can be generated' });
    }

    const { rows: templates } = await sql`
      SELECT * FROM agreement_templates WHERE status = 'published' ORDER BY published_at DESC LIMIT 1
    `;
    const template = templates[0];
    if (!template) {
      return res.status(400).json({ error: 'No published agreement template. Publish one in the Agreement Templates tab first.' });
    }

    const config = await readConfig();
    const vars = buildAgreementVars(app, config.contact && config.contact.address);
    const snapshot = renderTemplate(template.content, vars);

    await sql`
      UPDATE applications SET
        agreement_version = ${template.version},
        agreement_snapshot = ${snapshot},
        agreement_status = 'awaiting_acceptance',
        status = 'agreement_sent',
        updated_at = now()
      WHERE id = ${app.id}
    `;
    await logEvent(app.id, 'admin', 'Agreement ' + template.version + ' generated');
    await logEvent(app.id, 'system', 'Agreement sent — awaiting customer acceptance');

    if (app.email) {
      const resumeToken = generateResumeToken(app.application_code);
      const resumeUrl = resumeToken ? `${SITE_URL}/agreement.html?resume=${resumeToken}` : `${SITE_URL}/track.html`;
      await sendEmail(
        app.email,
        'Workspace4you — Your agreement is ready (' + app.application_code + ')',
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">' +
        '<h2 style="color:#0B3A8D">Workspace4you</h2>' +
        '<p>Good news — your Virtual Office Agreement is ready to review.</p>' +
        '<p><strong>Application ID:</strong> ' + app.application_code + '<br><strong>Agreement Version:</strong> ' + template.version + '</p>' +
        '<p><a href="' + resumeUrl + '" style="display:inline-block;background:#0B3A8D;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">View Agreement</a></p>' +
        '</div>'
      );
    }

    return res.status(200).json({ success: true, version: template.version });
  } catch (err) {
    console.error('applications/admin-generate-agreement error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
