// ============================================================
// Workspace4You — Create a draft Virtual Address application
// File: api/applications/create.js
// Step 1 (Select Plan) hands off here. Creates a draft row
// immediately so nothing is lost if the customer leaves before
// finishing the form, and returns an access token the browser
// keeps in localStorage for the rest of this session.
// ============================================================

const { sql, logEvent } = require('../_db');
const { buildApplicationCode } = require('../_appId');
const { generateAccessToken, hashToken, createSession } = require('../_appAuth');
const { setCorsHeaders } = require('../_cors');

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, { allowAuthHeader: true });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const duration = body && body.duration === 'annual' ? 'annual' : 'month';

    const accessToken = generateAccessToken();
    const accessTokenHash = hashToken(accessToken);

    // application_code starts NULL and is assigned right after, once we
    // know the row's real id — avoids a placeholder-value race between
    // concurrent creates colliding on the UNIQUE constraint.
    const { rows } = await sql`
      INSERT INTO applications (access_token_hash, duration, status)
      VALUES (${accessTokenHash}, ${duration}, 'draft')
      RETURNING id, created_at
    `;
    const { id, created_at } = rows[0];
    const code = buildApplicationCode(id, created_at);

    await sql`UPDATE applications SET application_code = ${code} WHERE id = ${id}`;
    await createSession(id, accessToken);
    await logEvent(id, 'system', 'Application created (' + duration + ')');

    return res.status(200).json({ success: true, code, accessToken });
  } catch (err) {
    console.error('applications/create error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
