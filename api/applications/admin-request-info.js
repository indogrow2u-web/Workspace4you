// ============================================================
// Workspace4You — Admin: request more information from the customer
// File: api/applications/admin-request-info.js
// Sends the application back to the customer without ever making
// them restart — it just flips to "action_required" with a message,
// same application, same Application ID.
// ============================================================

const { sql, logEvent } = require('../_db');
const { requireAdminApplication } = require('../_adminAppLoad');
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
    const message = String((body && body.message) || '').trim().slice(0, 2000);
    const app = await requireAdminApplication(req, res, body && body.code);
    if (!app) return;

    if (!message) {
      return res.status(400).json({ error: 'Please describe what you need from the customer' });
    }

    await sql`
      UPDATE applications SET
        status = 'action_required',
        info_requested = ${message},
        updated_at = now()
      WHERE id = ${app.id}
    `;
    await logEvent(app.id, 'admin', 'Requested more information: ' + message);

    if (app.email) {
      const resumeToken = generateResumeToken(app.application_code);
      const resumeUrl = resumeToken ? `${SITE_URL}/track.html?resume=${resumeToken}` : `${SITE_URL}/track.html`;
      await sendEmail(
        app.email,
        'Workspace4You — Action needed on application ' + app.application_code,
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">' +
        '<h2 style="color:#0B3A8D">Workspace4You</h2>' +
        '<p>We need a bit more information to continue reviewing your application <strong>' + app.application_code + '</strong>:</p>' +
        '<p style="background:#FFFBEB;border-left:3px solid #F4B400;padding:12px 16px;border-radius:8px">' + message + '</p>' +
        '<p><a href="' + resumeUrl + '" style="display:inline-block;background:#0B3A8D;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Continue Application</a></p>' +
        '</div>'
      );
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('applications/admin-request-info error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
