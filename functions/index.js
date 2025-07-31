const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const coinbase = require('coinbase-commerce-node');
const { resources, Webhook } = coinbase;
const { Charge } = resources;

admin.initializeApp();
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const PAYPAL_ID = functions.config().paypal.client_id;
const PAYPAL_SECRET = functions.config().paypal.secret;
coinbase.Client.init(functions.config().coinbase.api_key);
const WEBHOOK_SECRET = functions.config().coinbase.webhook_secret;

const PAYPAL_API = 'https://api-m.sandbox.paypal.com/v2/checkout/orders';

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

// 2) Create Coinbase charge
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
    const charge = await Charge.create(chargeData);
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


// 5) Daily spin wheel
const spinPrizes = [
  '50gc','0.05sc','0.05TRPZ','100gc','0.10sc','0.10TRPZ',
  '500gc','0.50sc','0.50TRPZ','1000gc','1.00sc','1.00TRPZ','5.00sc'
];

exports.spinWheel = functions.https.onCall(async (_, ctx) => {
  const uid = ctx.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated','Must be logged in');

  const userSpinRef = db.collection('spins').doc(uid);
  const rec = await userSpinRef.get();
  const now = Timestamp.now();

  if (rec.exists) {
    const last = rec.data().timestamp;
    if (now.toMillis() - last.toMillis() < 24*60*60*1000) {
      throw new functions.https.HttpsError('failed-precondition','Only one spin per 24h');
    }
  }

  // pick and record prize
  const prize = spinPrizes[Math.floor(Math.random()*spinPrizes.length)];
  await userSpinRef.set({ prize, timestamp: now });

  // credit wallet
  const walletRef = db.collection('wallets').doc(uid);
  await db.runTransaction(async tx => {
    const snap = await tx.get(walletRef);
    const bal = snap.exists ? snap.data().balance : { gc:0, sc:0, trpz:0 };
    const amount = parseFloat(prize);
    const type = prize.replace(/[^a-zA-Z]/g,'').toLowerCase();
    if (type === 'gc') bal.gc += amount;
    else if (type === 'sc') bal.sc += amount;
    else if (type === 'trpz') bal.trpz += amount;
    tx.set(walletRef, { balance: bal }, { merge: true });
  });

  return { prize };
});
