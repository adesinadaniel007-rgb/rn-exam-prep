const crypto = require('crypto');
const admin = require('firebase-admin');

function initFirebase() {
  if (admin.apps.length) return admin.app();
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://rn-exam-prepi-id-default-rtdb.firebaseio.com',
  });
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(500).send('Misconfigured');

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    const signature = req.headers['x-paystack-signature'];

    if (!signature || hash !== signature) {
      console.warn('Invalid Paystack signature');
      return res.status(401).send('Invalid signature');
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (event.event === 'charge.success') {
      const data = event.data || {};
      const reference = data.reference;
      const amount = data.amount;
      const uid =
        (data.metadata && (data.metadata.uid || data.metadata.UID)) ||
        null;

      if (uid && reference && amount >= 200000) {
        initFirebase();
        const expiry = daysFromNow(30);
        await admin.database().ref('users/' + uid).update({
          subscriptionExpiry: expiry,
          lastPaymentRef: reference,
          lastPaymentAt: new Date().toISOString(),
          hasPaid: true,
          amountPaid: amount,
          source: 'webhook',
        });
        console.log('Granted access', uid, expiry);
      } else {
        console.warn('charge.success missing uid or low amount', { uid, reference, amount });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).json({ error: err.message });
  }
};