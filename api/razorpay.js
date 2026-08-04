// ============================================================
// Workspace4You — Razorpay Payment Backend
// File: api/razorpay.js
// ============================================================

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('Razorpay error: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env vars not set');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, email, phone, amount, productinfo } = body || {};

    if (!name || !phone || !amount || !productinfo) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Amount in paise (multiply by 100)
    const amountPaise = Math.round(parseFloat(amount) * 100);

    // Create Razorpay order via API
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const receipt = 'WS4Y' + Date.now();

    const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: receipt,
        notes: {
          customer_name: name,
          customer_email: email || '',
          customer_phone: phone,
          plan: productinfo
        }
      })
    });

    const order = await rzpResponse.json();

    if (!order.id) {
      throw new Error(order.error?.description || 'Failed to create Razorpay order');
    }

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amountPaise: amountPaise,
      currency: 'INR',
      keyId: RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error('Razorpay error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
