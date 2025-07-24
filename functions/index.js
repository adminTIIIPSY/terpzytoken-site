const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const fetch     = require('node-fetch');
const { Client, Webhook } = require('coinbase-commerce-node');

admin.initializeApp();
const db = admin.firestore();
const { Timestamp } = admin.firestore;

// Use sandbox endpoint during testing
const PAYPAL_API = 'https://api-m.sandbox.paypal.com/v2/checkout/orders';
const PAYPAL_ID     = ATPTbd9l2TI7yQwIgTbX7LiwfTLqaJn9iYzoXbYxdw884ktPx5Fw4TW3LPtXt9cuNI_HtAEIcvWz3raJ
const PAYPAL_SECRET = EM5cuAUTBRlkJTCiW0YY95up5kE4wFRzD9q82XJdSFS5sL6enQVT4aqJADRE6agkjmp17g4b_3Iq4579

const coinbase       = new Client({ apiKey: functions.config().coinbase.key });
const WEBHOOK_SECRET = functions.config().coinbase.webhook_secret;

// 1) Confirm PayPal purchase
exports.confirmPayPal = functions.https.onRequest(async (req, res) => {
  try {
    const { orderID, userId, packageId, tokens } = req.body;
    const authHeader = Buffer.from(`${PAYPAL_ID}:${PAYPAL_SECRET}`).toString('base64');
    const ppRes = await fetch(`${PAYPAL_API}/${orderID}`, {
      headers: { 'Authorization': `Basic ${authHeader}` }
    });
    const order = await ppRes.json();
    if (order.status === 'COMPLETED') {
      await db.collection('purchases').add({
        userId, packageId, tokens,
        currency: 'USD', method: 'paypal',
        status: 'completed',
        releaseDate: Timestamp.fromDate(new Date('2026-04-20T16:20:00-05:00')),
        released: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.json({ success: true });
    }
    throw new Error('PayPal payment not completed');
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// 2) Create Coinbase Commerce charge
exports.createCoinbaseCharge = functions.https.onRequest(async (req, res) => {
  try {
    const { userId, packageId, tokens, price } = req.body;
    const chargeData = {
      name: `${packageId} – ${tokens} TRPZ`,
      description: `Purchase of ${tokens} TRPZ`,
      local_price: { amount: price.toString(), currency: 'USD' },
      pricing_type: 'fixed_price',
      metadata: { userId, packageId, tokens }
    };
    const charge = await coinbase.charge.create(chargeData);
    await db.collection('purchases').add({
      userId, packageId, tokens,
      currency: 'USD', method: 'coinbase',
      status: 'pending', chargeId: charge.id,
      releaseDate: Timestamp.fromDate(new Date('2026-04-20T16:20:00-05:00')),
      released: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ hosted_url: charge.hosted_url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 3) Coinbase webhook
exports.coinbaseWebhook = functions.https.onRequest((req, res) => {
  const signature = req.headers['x-cc-webhook-signature'];
  let event;
  try {
    event = Webhook.verifySigHeader(JSON.stringify(req.body), signature, WEBHOOK_SECRET);
  } catch (e) {
    console.error('Invalid signature', e);
    return res.status(400).send('Invalid signature');
  }
  if (event.type === 'charge:confirmed') {
    const id = event.data.id;
    db.collection('purchases').where('chargeId', '==', id).get()
      .then(snap => {
        if (!snap.empty) {
          const doc = snap.docs[0];
          if (doc.data().status !== 'completed') {
            doc.ref.update({ status: 'completed' });
          }
        }
      })
      .catch(console.error);
  }
  res.json({ received: true });
});

// 4) Scheduled release job
exports.releaseTokens = functions.pubsub
  .schedule('20 16 20 4 *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const now = Timestamp.now();
    const snaps = await db.collection('purchases')
      .where('status', '==', 'completed')
      .where('released', '==', false)
      .where('releaseDate', '<=', now)
      .get();

    const batch = db.batch();
    snaps.forEach(doc => {
      const p = doc.data();
      batch.update(doc.ref, { released: true });
      batch.update(db.doc(`users/${p.userId}`), {
        balance: admin.firestore.FieldValue.increment(p.tokens)
      });
    });
    await batch.commit();
    console.log(`Released ${snaps.size} purchases`);
  });
