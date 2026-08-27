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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { reference, uid } = req.body || {};
    if (!reference) return res.status(400).json({ error: 'Missing reference' });

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: 'Server misconfigured: PAYSTACK_SECRET_KEY' });

    const payRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const payJson = await payRes.json();

    if (!payJson.status || !payJson.data || payJson.data.status !== 'success') {
      return res.status(400).json({ verified: false, error: 'Payment not successful', detail: payJson });
    }

    const amount = payJson.data.amount;
    if (amount < 200000) {
      return res.status(400).json({ verified: false, error: 'Amount mismatch' });
    }

    const metaUid =
      uid ||
      (payJson.data.metadata && (payJson.data.metadata.uid || payJson.data.metadata.UID)) ||
      null;

    if (!metaUid) {
      return res.status(200).json({
        verified: true,
        warning: 'No uid — payment OK but Firebase user not updated',
        reference,
      });
    }

    initFirebase();
    const expiry = daysFromNow(30);
    await admin.database().ref('users/' + metaUid).update({
      subscriptionExpiry: expiry,
      lastPaymentRef: reference,
      lastPaymentAt: new Date().toISOString(),
      hasPaid: true,
      amountPaid: amount,
    });

    return res.status(200).json({
      verified: true,
      subscription: { subscriptionExpiry: expiry },
      reference,
    });
  } catch (err) {
    console.error('verify error', err);
    return res.status(500).json({ error: 'Verify failed', message: err.message });
  }
};