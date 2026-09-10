// ============================================================
// Workspace4You — Daily housekeeping check (Vercel Cron)
// File: api/cron/check-expirations.js
// Runs once a day (see vercel.json). Three jobs:
//  1. Applications expiring within 7 days get a one-time reminder
//     email (expiry_reminder_sent_at guards against re-sending it
//     every day until it actually expires).
//  2. Applications whose expiry_date has passed get flipped to
//     activation_status/status = 'expired' and a notice email.
//  3. Applications sitting in "awaiting_acceptance" for 3+ days with
//     no nudge yet get a one-time reminder to go accept their
//     agreement (agreement_reminder_sent_at guards against repeats;
//     admin-generate-agreement.js resets it if a new agreement is
//     ever generated for the same application).
//
// Vercel automatically sends "Authorization: Bearer <CRON_SECRET>"
// on cron-triggered requests once CRON_SECRET is set as an env var —
// this checks that so the endpoint can't be triggered by anyone who
// simply finds the URL.
// ============================================================

const { sql, logEvent } = require('../_db');
const { readConfig } = require('../_configStore');
const { sendExpiryReminderEmail, sendExpiredEmail, sendAgreementReminderEmail } = require('../_notify');
const { generateResumeToken } = require('../_appAuth');

const CRON_SECRET = process.env.CRON_SECRET;
const REMINDER_WINDOW_DAYS = 7;
const AGREEMENT_REMINDER_AFTER_DAYS = 3;
const SITE_URL = process.env.SITE_URL || 'https://workspace4you.co';

module.exports = async function handler(req, res) {
  if (CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const config = await readConfig();
    const contactPhone = (config.contact && config.contact.phone) || '+91 77180 86678';
    const contactEmail = (config.contact && config.contact.email) || 'workspace2you@gmail.com';

    // 1. Upcoming-expiry reminders
    const { rows: upcoming } = await sql`
      SELECT * FROM applications
      WHERE activation_status = 'active'
        AND expiry_date IS NOT NULL
        AND expiry_date <= (CURRENT_DATE + ${REMINDER_WINDOW_DAYS}::int)
        AND expiry_date >= CURRENT_DATE
        AND expiry_reminder_sent_at IS NULL
    `;
    let remindersSent = 0;
    for (const app of upcoming) {
      const daysLeft = Math.max(0, Math.ceil((new Date(app.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)));
      if (app.email) {
        await sendExpiryReminderEmail(app, daysLeft, contactPhone, contactEmail);
      }
      await sql`UPDATE applications SET expiry_reminder_sent_at = now() WHERE id = ${app.id}`;
      await logEvent(app.id, 'system', 'Expiry reminder sent (' + daysLeft + ' days left)');
      remindersSent++;
    }

    // 2. Already-expired
    const { rows: expired } = await sql`
      SELECT * FROM applications
      WHERE activation_status = 'active' AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
    `;
    let expiredCount = 0;
    for (const app of expired) {
      await sql`
        UPDATE applications SET activation_status = 'expired', status = 'expired', updated_at = now()
        WHERE id = ${app.id}
      `;
      if (app.email) {
        await sendExpiredEmail(app, contactPhone, contactEmail);
      }
      await logEvent(app.id, 'system', 'Virtual Address expired');
      expiredCount++;
    }

    // 3. Agreements still awaiting acceptance after AGREEMENT_REMINDER_AFTER_DAYS
    const { rows: awaitingAcceptance } = await sql`
      SELECT * FROM applications
      WHERE agreement_status = 'awaiting_acceptance'
        AND agreement_generated_at IS NOT NULL
        AND agreement_generated_at <= now() - interval '1 day' * ${AGREEMENT_REMINDER_AFTER_DAYS}
        AND agreement_reminder_sent_at IS NULL
    `;
    let agreementRemindersSent = 0;
    for (const app of awaitingAcceptance) {
      if (app.email) {
        const resumeToken = generateResumeToken(app.application_code);
        const resumeUrl = resumeToken ? `${SITE_URL}/agreement.html?resume=${resumeToken}` : `${SITE_URL}/agreement.html`;
        await sendAgreementReminderEmail(app, resumeUrl);
      }
      await sql`UPDATE applications SET agreement_reminder_sent_at = now() WHERE id = ${app.id}`;
      await logEvent(app.id, 'system', 'Agreement acceptance reminder sent');
      agreementRemindersSent++;
    }

    return res.status(200).json({ success: true, remindersSent, expiredCount, agreementRemindersSent });
  } catch (err) {
    console.error('cron/check-expirations error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
