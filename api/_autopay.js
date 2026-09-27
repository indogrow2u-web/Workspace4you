// ============================================================
// Workspace4You — Shared Monthly AutoPay (Razorpay Subscriptions) helpers
// Used by admin-autopay (create/cancel), admin-reject and the expiry
// cron, so every path that ends a customer's service also stops
// their monthly charges.
// ============================================================

const { sql, logEvent } = require('./_db');

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// A subscription in one of these states can still take money.
const LIVE_STATUSES = ['created', 'authenticated', 'active', 'pending', 'halted'];

function rzpPost(path, body) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  return fetch('https://api.razorpay.com/v1' + path, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }).then(function (r) { return r.json(); });
}

async function cancelRazorpaySubscription(subscriptionId) {
  const result = await rzpPost('/subscriptions/' + subscriptionId + '/cancel', { cancel_at_cycle_end: 0 });
  // Already cancelled/completed on Razorpay's side is fine — the goal is "no more charges".
  if (result.error && !/cancel|complete/i.test(result.error.description || '')) {
    throw new Error(result.error.description || 'Could not cancel the AutoPay');
  }
}

function hasLiveAutopay(app) {
  return !!app.razorpay_subscription_id && LIVE_STATUSES.indexOf(app.autopay_status) !== -1;
}

// Cancels this application's AutoPay if it could still charge. Never
// throws — callers are ending the service anyway, so a Razorpay hiccup
// is logged loudly in Activity History for the admin to finish by hand.
async function stopAutopayIfLive(app, actor, reason) {
  if (!hasLiveAutopay(app)) return;
  try {
    await cancelRazorpaySubscription(app.razorpay_subscription_id);
    await sql`UPDATE applications SET autopay_status = 'cancelled', updated_at = now() WHERE id = ${app.id}`;
    await logEvent(app.id, actor, 'Monthly AutoPay cancelled — ' + reason + ' (Razorpay ' + app.razorpay_subscription_id + ')');
  } catch (err) {
    console.error('stopAutopayIfLive failed:', err);
    await logEvent(app.id, 'system', '⚠ Could not auto-cancel AutoPay (' + err.message + ') — cancel ' + app.razorpay_subscription_id + ' manually in the Razorpay dashboard');
  }
}

module.exports = { rzpPost, cancelRazorpaySubscription, hasLiveAutopay, stopAutopayIfLive, LIVE_STATUSES };
