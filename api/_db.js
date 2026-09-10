// ============================================================
// Workspace4You — Shared Postgres helpers (Vercel Postgres / Neon)
// Provision the database via Vercel → Storage → Create Database →
// Postgres, then run db/schema.sql against it once. Vercel injects
// the connection env vars (POSTGRES_URL etc.) automatically once
// the database is linked to this project.
// ============================================================

const { sql } = require('@vercel/postgres');

async function getApplicationByCode(code) {
  const { rows } = await sql`
    SELECT * FROM applications WHERE application_code = ${code} LIMIT 1
  `;
  return rows[0] || null;
}

async function getApplicationById(id) {
  const { rows } = await sql`
    SELECT * FROM applications WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

async function getApplicationByPaymentId(paymentId) {
  const { rows } = await sql`
    SELECT * FROM applications WHERE razorpay_payment_id = ${paymentId} LIMIT 1
  `;
  return rows[0] || null;
}

async function logEvent(applicationId, actor, event) {
  await sql`
    INSERT INTO application_events (application_id, actor, event)
    VALUES (${applicationId}, ${actor}, ${event})
  `;
}

async function touchApplication(id) {
  await sql`UPDATE applications SET updated_at = now() WHERE id = ${id}`;
}

module.exports = { sql, getApplicationByCode, getApplicationById, getApplicationByPaymentId, logEvent, touchApplication };
