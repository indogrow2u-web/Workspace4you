// ============================================================
// Workspace4You — Razorpay Webhook (server-to-server payment confirmation)
// File: api/razorpay-webhook.js
//
// Reliability backstop for /api/verify-payment: that endpoint only
// updates the sheet if the customer's browser stays alive long enough
// to report success. This endpoint is called directly by Razorpay's
// servers regardless of what happens client-side, so a payment that
// succeeds but never gets reported by the browser still gets logged.
//
// Setup (do this after deploying):
//   1. Razorpay Dashboard -> Settings -> Webhooks -> Add New Webhook
//        URL: https://www.workspace4you.co/api/razorpay-webhook
//        Active events: payment.captured, payment.failed
//        Generate a Secret (any strong random string)
//   2. Vercel -> Project Settings -> Environment Variables
//        Add RAZORPAY_WEBHOOK_SECRET with the exact same secret value
// ============================================================

const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || '';

function readRawBody(req){
  return new Promise(function(resolve, reject){
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      // bodyParser wasn't actually disabled by the platform; best-effort
      // reconstruction (Razorpay sends compact JSON, so this round-trips cleanly)
      return resolve(Buffer.from(JSON.stringify(req.body)));
    }
    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', function(){ resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function logPaymentEvent(payment, status){
  var notes = payment.notes || {};
  var row = {
    name: notes.customer_name || '',
    phone: notes.customer_phone || payment.contact || '',
    email: notes.customer_email || payment.email || '',
    plan: notes.plan || '',
    amount: String(Math.round((payment.amount || 0) / 100)),
    status: status,
    txnId: payment.id
  };
  if (!GOOGLE_SCRIPT_URL) return Promise.resolve();
  return fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row)
  }).catch(function(err){ console.error('Webhook sheet log failed:', err); });
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!WEBHOOK_SECRET) {
    console.error('Webhook error: RAZORPAY_WEBHOOK_SECRET env var not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  var raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'Could not read request body' });
  }

  var signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Missing signature' });
  }

  var expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  var isValid = expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  if (!isValid) {
    console.error('Webhook error: invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  var event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  var payment = event.payload && event.payload.payment && event.payload.payment.entity;

  if (event.event === 'payment.captured' && payment) {
    await logPaymentEvent(payment, 'Paid');
  } else if (event.event === 'payment.failed' && payment) {
    await logPaymentEvent(payment, 'Payment Failed (Webhook)');
  }

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };
