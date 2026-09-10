// ============================================================
// Workspace4You — Shared Postgres helpers
//
// Uses `pg` (node-postgres) directly, talking the standard Postgres
// wire protocol over TLS — NOT @vercel/postgres. That package's `sql`
// client only speaks Neon's proprietary HTTP-proxy protocol, so it
// cannot connect to a non-Neon Postgres server (Supabase included)
// no matter how correct the connection string is — every query fails
// with a generic "fetch failed". `pg` works against any standard
// Postgres provider.
//
// Reads the connection string from POSTGRES_URL, which Vercel sets
// automatically once a Postgres database (native or via the Supabase
// marketplace integration) is linked to this project under Storage —
// that's the pooled, serverless-safe connection string.
// ============================================================

const { Pool } = require('pg');

const rawConnectionString =
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL;

// Supabase's pooled connection string includes "sslmode=require" — recent
// pg versions treat that as an alias for "verify-full" and let it silently
// win over an explicit `ssl` option passed to the Pool, which is what was
// causing "self-signed certificate in certificate chain" even with
// rejectUnauthorized: false set below. Stripping sslmode/ssl query params
// here makes the explicit `ssl` option the only source of truth again.
function stripSslModeParam(str) {
  if (!str) return str;
  try {
    const url = new URL(str);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('ssl');
    return url.toString();
  } catch (err) {
    return str; // not a parseable URL — leave it alone
  }
}

const connectionString = stripSslModeParam(rawConnectionString);

let pool;
function getPool() {
  if (!pool) {
    if (!connectionString) {
      throw new Error('No database connection string found — set POSTGRES_URL (Vercel sets this automatically once a database is linked under Storage)');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // required by Supabase's managed Postgres — see stripSslModeParam above for why this needs the query param stripped first
      max: 3
    });
  }
  return pool;
}

// Mimics @vercel/postgres's `sql` tagged template — sql`SELECT ... WHERE id = ${id}`
// — so every existing call site across the codebase keeps working unchanged.
async function sql(strings, ...values) {
  let text = '';
  strings.forEach(function (chunk, i) {
    text += chunk;
    if (i < values.length) text += '$' + (i + 1);
  });
  const result = await getPool().query(text, values);
  return { rows: result.rows };
}

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
