// Firebase Functions for ClubSocial Poker
// Node 18+ / firebase-functions v4+
// Features: secure shuffle/deal, turn order, 20s auto-fold, blinds, pot logic, showdown,
// Texas Hold'em evaluator with tie-breaks. Omaha Hi/Lo stubs included for later.

// -----------------------------
// Imports & Init
// -----------------------------
const functions = require('firebase-functions');
const admin = require('firebase-admin');

try { admin.initializeApp(); } catch (e) {}
const db = admin.firestore();

// If you’re in a multi-region project, you can pin region here:
const REGION = 'us-central1';

// -----------------------------
// Helpers: Cards & Deck
// -----------------------------
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['c','d','h','s']; // clubs, diamonds, hearts, spades

function makeDeck() {
  const deck = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(r + s);
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  // Fisher–Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Hand ranking categories (higher is better)
const HAND_CATEGORY = {
  HIGH: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  TRIPS: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  QUADS: 8,
  STRAIGHT_FLUSH: 9
};

const RANK_VALUE = Object.fromEntries(RANKS.map((r,i)=>[r,i])); // 2..A => 0..12

function cardRank(card) { return card[0]; }
function cardSuit(card) { return card[1]; }
function rankValue(r) { return RANK_VALUE[r]; }

// -----------------------------
// Combinatorics (choose 5 from 7)
// -----------------------------
function combinations(array, k) {
  const results = [];
  function helper(start, combo) {
    if (combo.length === k) { results.push(combo.slice()); return; }
    for (let i = start; i < array.length; i++) {
      combo.push(array[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return results;
}

// -----------------------------
// Hand Evaluation (Texas Hold’em)
// Returns an object with {cat, tiebreak: number[], cards: string[]}
// where cat is from HAND_CATEGORY and tiebreak is a descending list of rank values for tie-breaking.
// -----------------------------
function evaluate5(cards5) {
  // cards5 = array of 5 like ['Ah','Kd','Qs','Jc','Th']
  const ranks = cards5.map(cardRank).map(rankValue).sort((a,b)=>b-a); // high -> low
  const suits = cards5.map(cardSuit);
  const counts = {}; // rank value -> count
  ranks.forEach(r=>counts[r]=(counts[r]||0)+1);

  const isFlush = suits.every(s => s === suits[0]);

  // Straight detection with A-5 wheel
  const uniqueRanksDesc = [...new Set(ranks)]; // high->low
  let isStraight = false;
  let topStraightRank = -1;
  if (uniqueRanksDesc.length >= 5) {
    // Check normal straight
    for (let i=0; i<=uniqueRanksDesc.length-5; i++) {
      const window = uniqueRanksDesc.slice(i, i+5);
      if (window[0] - window[4] === 4) {
        isStraight = true;
        topStraightRank = window[0];
        break;
      }
    }
    // Check wheel (A-5): ranks contain A(12), 4(2),3(1),2(0)
    if (!isStraight) {
      const hasA = uniqueRanksDesc.includes(12);
      const has2 = uniqueRanksDesc.includes(0);
      const has3 = uniqueRanksDesc.includes(1);
      const has4 = uniqueRanksDesc.includes(2);
      const has5 = uniqueRanksDesc.includes(3);
      if (hasA && has2 && has3 && has4 && has5) {
        isStraight = true;
        topStraightRank = 3; // five-high straight ranks to '5' (value 3)
      }
    }
  }

  // Straight flush?
  let isStraightFlush = false;
  let topSF = -1;
  if (isFlush && isStraight) {
    // To be precise, ensure the straight is all same suit.
    // Simpler approach: filter by suit and check straight among those cards.
    const suit = suits[0];
    const suitedCards = cards5.filter(c=>cardSuit(c)===suit);
    if (suitedCards.length === 5) {
      const suitedRanks = suitedCards.map(c=>rankValue(cardRank(c))).sort((a,b)=>b-a);
      const uniq = [...new Set(suitedRanks)];
      // normal
      for (let i=0; i<=uniq.length-5; i++) {
        const win = uniq.slice(i, i+5);
        if (win[0]-win[4]===4) { isStraightFlush = true; topSF = win[0]; break; }
      }
      if (!isStraightFlush) {
        const hasA = uniq.includes(12), has2 = uniq.includes(0), has3 = uniq.includes(1), has4 = uniq.includes(2), has5 = uniq.includes(3);
        if (hasA && has2 && has3 && has4 && has5) { isStraightFlush = true; topSF = 3; } // five-high
      }
    }
  }

  if (isStraightFlush) {
    return { cat: HAND_CATEGORY.STRAIGHT_FLUSH, tiebreak: [topSF], cards: cards5 };
  }

  // Count map -> classify (quads, full house, trips, two pair, pair)
  const groups = Object.entries(counts).map(([r,c])=>({r:parseInt(r,10), c})).sort((a,b)=>{
    if (b.c !== a.c) return b.c - a.c;
    return b.r - a.r;
  });

  if (groups[0].c === 4) {
    // Quads
    const quad = groups[0].r;
    const kicker = groups.find(g=>g.r!==quad).r;
    return { cat: HAND_CATEGORY.QUADS, tiebreak: [quad, kicker], cards: cards5 };
  }
  if (groups[0].c === 3 && groups[1].c === 2) {
    // Full house
    const trips = groups[0].r, pair = groups[1].r;
    return { cat: HAND_CATEGORY.FULL_HOUSE, tiebreak: [trips, pair], cards: cards5 };
  }
  if (isFlush) {
    return { cat: HAND_CATEGORY.FLUSH, tiebreak: ranks, cards: cards5 };
  }
  if (isStraight) {
    return { cat: HAND_CATEGORY.STRAIGHT, tiebreak: [topStraightRank], cards: cards5 };
  }
  if (groups[0].c === 3) {
    // Trips + two kickers
    const trips = groups[0].r;
    const kickers = groups.filter(g=>g.c===1).map(g=>g.r).sort((a,b)=>b-a).slice(0,2);
    return { cat: HAND_CATEGORY.TRIPS, tiebreak: [trips, ...kickers], cards: cards5 };
  }
  if (groups[0].c === 2 && groups[1].c === 2) {
    // Two pair + kicker
    const highPair = Math.max(groups[0].r, groups[1].r);
    const lowPair = Math.min(groups[0].r, groups[1].r);
    const kicker = groups.find(g=>g.c===1).r;
    return { cat: HAND_CATEGORY.TWO_PAIR, tiebreak: [highPair, lowPair, kicker], cards: cards5 };
  }
  if (groups[0].c === 2) {
    // One pair + 3 kickers
    const pair = groups[0].r;
    const kickers = groups.filter(g=>g.c===1).map(g=>g.r).sort((a,b)=>b-a).slice(0,3);
    return { cat: HAND_CATEGORY.PAIR, tiebreak: [pair, ...kickers], cards: cards5 };
  }
  // High card
  return { cat: HAND_CATEGORY.HIGH, tiebreak: ranks, cards: cards5 };
}

function compareEval(a, b) {
  if (a.cat !== b.cat) return b.cat - a.cat;
  // Compare tiebreak arrays lexicographically
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i=0;i<len;i++) {
    const av = a.tiebreak[i] ?? -1;
    const bv = b.tiebreak[i] ?? -1;
    if (av !== bv) return bv - av;
  }
  return 0; // tie
}

function bestHoldem7(cards7) {
  // pick best 5 out of 7
  const fives = combinations(cards7, 5);
  let best = null;
  for (const f of fives) {
    const ev = evaluate5(f);
    if (!best || compareEval(ev, best) < 0) {
      best = ev;
    }
  }
  return best;
}

// Omaha evaluators (stub hooks to fill later)
function bestOmahaHi9(hole4, board5) {
  // TODO: exactly 2 from hole + 3 from board; return best high
  return null;
}
function bestOmahaHiLo9(hole4, board5) {
  // TODO: high + low computation with qualifiers
  return null;
}

// -----------------------------
// Firestore Structure
// tables/{tableId} main doc:
//   stage: 'idle'|'preflop'|'flop'|'turn'|'river'|'showdown'
//   gameType: 'holdem'|'omaha_hi'|'omaha_hilo'
//   sb, bb
//   dealerSeat: number
//   currentSeat: number (whose turn)
//   pot: number
//   community: string[] // board cards
//   handId: string (incrementing id per hand)
//   actingSince: Timestamp (for timeouts)
//   minPlayersToStart: 2
//
// tables/{tableId}/seats/{seatNo} subdoc:
//   playerId, username, chips, betThisStreet, hasFolded, isAllIn,
//   privateHole: string[] (only readable by that player via rules)
//   publicHole: string[] (empty until showdown)
//   lastActionAt: Timestamp
// -----------------------------

async function getSeatedPlayers(tableId) {
  const snap = await db.collection('tables').doc(tableId).collection('seats').get();
  const seats = [];
  snap.forEach(doc=>{
    const d = doc.data();
    seats.push({ seat: parseInt(doc.id,10), ...d });
  });
  return seats.filter(s => !!s.playerId);
}

function seatOrderStartingFrom(seats, startSeat) {
  // seats: array of {seat, ...}, returns sorted seat numbers starting from startSeat and wrapping
  const nums = seats.map(s=>s.seat).sort((a,b)=>a-b);
  const idx = nums.indexOf(startSeat);
  if (idx < 0) return nums;
  return nums.slice(idx).concat(nums.slice(0,idx));
}

function nextOccupiedSeatInOrder(order, currentSeat) {
  if (!order.length) return null;
  const idx = order.indexOf(currentSeat);
  const nextIdx = (idx + 1) % order.length;
  return order[nextIdx];
}

async function rotateDealer(tableRef, seatsArr, prevDealer) {
  const seatNums = seatsArr.map(s=>s.seat).sort((a,b)=>a-b);
  if (prevDealer == null) {
    // pick lowest seat as first dealer by default (or do high-card draw later)
    return seatNums[0];
  }
  const idx = seatNums.indexOf(prevDealer);
  return seatNums[(idx + 1) % seatNums.length];
}

function drawCards(deck, n) {
  const drawn = deck.splice(0, n);
  return drawn;
}

// -----------------------------
// Callable: createTable
// -----------------------------
exports.createTable = functions.region(REGION).https.onCall(async (data, context) => {
  const {
    tableId,
    sb = 5,
    bb = 10,
    gameType = 'holdem',
    maxSeats = 9,
    minPlayersToStart = 2
  } = data || {};

  if (!context.auth) { throw new functions.https.HttpsError('unauthenticated','Login required'); }
  if (!tableId) { throw new functions.https.HttpsError('invalid-argument','tableId required'); }

  const tableRef = db.collection('tables').doc(tableId);
  const tableSnap = await tableRef.get();
  if (tableSnap.exists) {
    throw new functions.https.HttpsError('already-exists','Table already exists');
  }

  await tableRef.set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    stage: 'idle',
    gameType,
    sb, bb,
    maxSeats,
    dealerSeat: null,
    currentSeat: null,
    community: [],
    pot: 0,
    handId: '0',
    actingSince: null,
    minPlayersToStart
  });

  // Pre-create empty seats 1..maxSeats
  const batch = db.batch();
  for (let s=1; s<=maxSeats; s++) {
    batch.set(tableRef.collection('seats').doc(String(s)), {
      playerId: null,
      username: null,
      chips: 0,
      betThisStreet: 0,
      hasFolded: false,
      isAllIn: false,
      publicHole: [],
      privateHole: [],
      lastActionAt: null
    }, { merge: true });
  }
  await batch.commit();

  return { ok: true };
});

// -----------------------------
// Callable: joinSeat
// data: { tableId, seat, buyIn, username }
// -----------------------------
exports.joinSeat = functions.region(REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { tableId, seat, buyIn = 1000, username = 'Player' } = data || {};
  if (!tableId || !seat) throw new functions.https.HttpsError('invalid-argument','tableId & seat required');

  const uid = context.auth.uid;
  const seatRef = db.collection('tables').doc(tableId).collection('seats').doc(String(seat));
  const seatSnap = await seatRef.get();
  if (!seatSnap.exists) throw new functions.https.HttpsError('not-found','Seat not found');
  if (seatSnap.data().playerId) throw new functions.https.HttpsError('already-exists','Seat occupied');

  await seatRef.set({
    playerId: uid,
    username,
    chips: buyIn,
    betThisStreet: 0,
    hasFolded: false,
    isAllIn: false,
    publicHole: [],
    privateHole: [],
    lastActionAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true };
});

// -----------------------------
// Callable: leaveSeat
// -----------------------------
exports.leaveSeat = functions.region(REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { tableId, seat } = data || {};
  if (!tableId || !seat) throw new functions.https.HttpsError('invalid-argument','tableId & seat required');

  const uid = context.auth.uid;
  const seatRef = db.collection('tables').doc(tableId).collection('seats').doc(String(seat));
  const seatSnap = await seatRef.get();
  if (!seatSnap.exists) throw new functions.https.HttpsError('not-found','Seat not found');
  if (seatSnap.data().playerId !== uid) throw new functions.https.HttpsError('permission-denied','Not your seat');

  await seatRef.set({
    playerId: null,
    username: null,
    chips: 0,
    betThisStreet: 0,
    hasFolded: false,
    isAllIn: false,
    publicHole: [],
    privateHole: [],
    lastActionAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true };
});

// -----------------------------
// Start Hand (server-side deal, set blinds, set currentTurn)
// data: { tableId }
// -----------------------------
exports.startHand = functions.region(REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { tableId } = data || {};
  if (!tableId) throw new functions.https.HttpsError('invalid-argument','tableId required');

  const tableRef = db.collection('tables').doc(tableId);
  const tableSnap = await tableRef.get();
  if (!tableSnap.exists) throw new functions.https.HttpsError('not-found','Table not found');

  const table = tableSnap.data();
  if (table.stage !== 'idle' && table.stage !== 'showdown') {
    throw new functions.https.HttpsError('failed-precondition','Hand already in progress');
  }

  const seatsArr = await getSeatedPlayers(tableId);
  if (seatsArr.length < (table.minPlayersToStart || 2)) {
    throw new functions.https.HttpsError('failed-precondition','Not enough players');
  }

  // Rotate dealer
  const newDealer = await rotateDealer(tableRef, seatsArr, table.dealerSeat);

  // Prepare deck & deal
  const deck = shuffleDeck(makeDeck());
  const gameType = table.gameType || 'holdem';

  // Clear per-seat status, deal hole cards
  const batch = db.batch();
  for (const s of seatsArr) {
    const seatDoc = tableRef.collection('seats').doc(String(s.seat));
    batch.set(seatDoc, {
      betThisStreet: 0,
      hasFolded: false,
      isAllIn: false,
      publicHole: [],
      privateHole: []
    }, { merge: true });
  }

  const order = seatOrderStartingFrom(seatsArr, newDealer);
  // Blinds: SB = next seat, BB = next next
  const sbSeat = nextOccupiedSeatInOrder(order, newDealer);
  const bbSeat = nextOccupiedSeatInOrder(order, sbSeat);

  // Deal hole cards
  if (gameType === 'holdem') {
    // two cards each
    for (const seatNum of order) {
      const hole = drawCards(deck, 2);
      batch.set(tableRef.collection('seats').doc(String(seatNum)), {
        privateHole: hole
      }, { merge: true });
    }
  } else if (gameType.startsWith('omaha')) {
    for (const seatNum of order) {
      const hole = drawCards(deck, 4);
      batch.set(tableRef.collection('seats').doc(String(seatNum)), {
        privateHole: hole
      }, { merge: true });
    }
  }

  // Post blinds
  const sb = table.sb || 5;
  const bb = table.bb || 10;

  async function seatDoc(seat) {
    return db.runTransaction(async tx => {
      const ref = tableRef.collection('seats').doc(String(seat));
      const snap = await tx.get(ref);
      const d = snap.data();
      let post = (seat === sbSeat) ? sb : (seat === bbSeat) ? bb : 0;
      let chips = d.chips;
      if (post > chips) { post = chips; } // all-in blind if short
      chips -= post;
      tx.set(ref, {
        chips,
        betThisStreet: post,
      }, { merge: true });
      return post;
    });
  }

  const sbPosted = await seatDoc(sbSeat);
  const bbPosted = await seatDoc(bbSeat);

  // Set table state: preflop, currentSeat = first to act after BB
  const firstToAct = nextOccupiedSeatInOrder(order, bbSeat);

  const nextHandId = String((parseInt(table.handId || '0', 10) + 1));

  batch.set(tableRef, {
    stage: 'preflop',
    dealerSeat: newDealer,
    currentSeat: firstToAct,
    pot: (table.pot || 0) + sbPosted + bbPosted,
    community: [],
    handId: nextHandId,
    actingSince: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Save deck stub (we only persist remaining deck server-side in a hidden field if desired)
  // For simplicity, we won’t store deck; we’ll draw on the fly by reseeding from a deterministic handId if needed.
  // (Alternatively, you can store the deck encrypted in table doc.)

  await batch.commit();

  return { ok: true, dealerSeat: newDealer, sbSeat, bbSeat, currentSeat: firstToAct };
});

// -----------------------------
// Internal: advance stage or end hand
// -----------------------------
async function advanceStage(tableRef) {
  const tableSnap = await tableRef.get();
  if (!tableSnap.exists) return;
  const table = tableSnap.data();
  const seatsArr = await getSeatedPlayers(tableRef.id);
  const order = seatOrderStartingFrom(seatsArr, table.dealerSeat);

  // Build a fresh deck, but reconstruct board by drawing in the correct burn/draw count based on stage.
  // (Simplified: we won't simulate burn cards; purely draw community counts.)
  // Persist community in table.
  const deck = shuffleDeck(makeDeck());

  // Remove cards already dealt to seats + community
  const dealt = new Set();
  for (const s of seatsArr) {
    (s.privateHole || []).forEach(c => dealt.add(c));
    (s.publicHole || []).forEach(c => dealt.add(c));
  }
  (table.community || []).forEach(c => dealt.add(c));
  // Filter the deck to remove dealt
  const filteredDeck = deck.filter(c => !dealt.has(c));

  // Advance stage
  let stage = table.stage;
  const community = [...(table.community || [])];
  if (stage === 'preflop') {
    // flop: 3
    while (community.length < 3) community.push(filteredDeck.shift());
    stage = 'flop';
  } else if (stage === 'flop') {
    if (community.length < 4) community.push(filteredDeck.shift());
    stage = 'turn';
  } else if (stage === 'turn') {
    if (community.length < 5) community.push(filteredDeck.shift());
    stage = 'river';
  } else if (stage === 'river') {
    stage = 'showdown';
  }

  // Reset bets on new street (except when moving to showdown)
  if (stage !== 'showdown') {
    const batch = db.batch();
    for (const s of seatsArr) {
      const seatRef = tableRef.collection('seats').doc(String(s.seat));
      batch.set(seatRef, { betThisStreet: 0 }, { merge: true });
    }
    batch.set(tableRef, {
      stage,
      community,
      actingSince: admin.firestore.FieldValue.serverTimestamp(),
      // set currentSeat to first active player left of dealer on new street
      currentSeat: nextOccupiedSeatInOrder(order, table.dealerSeat)
    }, { merge: true });
    await batch.commit();
    return;
  }

  // SHOWDOWN: evaluate and award pot (Hold’em for now)
  const inHand = seatsArr.filter(s => !s.hasFolded && !s.isAllIn && s.playerId);
  const contesters = seatsArr.filter(s => !s.hasFolded && s.playerId);

  // Reveal publicHole for all contesters
  const revealBatch = db.batch();
  for (const s of contesters) {
    revealBatch.set(tableRef.collection('seats').doc(String(s.seat)), {
      publicHole: s.privateHole || []
    }, { merge: true });
  }
  await revealBatch.commit();

  // Evaluate
  let best = null;
  let winners = [];
  for (const s of contesters) {
    let ev = null;
    if (table.gameType === 'holdem') {
      ev = bestHoldem7([...(s.privateHole||[]), ...community]);
    } else if (table.gameType === 'omaha_hi') {
      // TODO
      ev = null;
    } else if (table.gameType === 'omaha_hilo') {
      // TODO
      ev = null;
    }
    if (!ev) continue;
    if (!best) { best = ev; winners = [s]; }
    else {
      const cmp = compareEval(ev, best);
      if (cmp < 0) { best = ev; winners = [s]; }
      else if (cmp === 0) { winners.push(s); }
    }
  }

  const pot = table.pot || 0;
  const share = (winners.length > 0) ? Math.floor(pot / winners.length) : 0;
  const remainder = (winners.length > 0) ? pot % winners.length : 0;

  const batch = db.batch();
  for (let i=0; i<winners.length; i++) {
    const w = winners[i];
    const add = share + (i === 0 ? remainder : 0);
    const seatRef = tableRef.collection('seats').doc(String(w.seat));
    batch.set(seatRef, { chips: (w.chips || 0) + add }, { merge: true });
  }
  // Reset table to idle
  batch.set(tableRef, {
    stage: 'idle',
    currentSeat: null,
    pot: 0,
    community: [],
    actingSince: null
  }, { merge: true });

  // Clear per-street bets & publicHole (we’ll keep publicHole until next hand start)
  for (const s of seatsArr) {
    const seatRef = tableRef.collection('seats').doc(String(s.seat));
    batch.set(seatRef, { betThisStreet: 0 }, { merge: true });
  }

  await batch.commit();
}

// -----------------------------
// Callable: playerAction
// data: { tableId, action: 'fold'|'call'|'check'|'bet'|'raise', amount? }
// Enforces turn, updates pot/bets, advances when needed.
// -----------------------------
exports.playerAction = functions.region(REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { tableId, action, amount = 0 } = data || {};
  if (!tableId || !action) throw new functions.https.HttpsError('invalid-argument','tableId & action required');

  const uid = context.auth.uid;
  const tableRef = db.collection('tables').doc(tableId);

  return await db.runTransaction(async tx => {
    const tableSnap = await tx.get(tableRef);
    if (!tableSnap.exists) throw new functions.https.HttpsError('not-found','Table not found');
    const table = tableSnap.data();

    if (!['preflop','flop','turn','river'].includes(table.stage)) {
      throw new functions.https.HttpsError('failed-precondition','No active betting round');
    }

    // Find the acting seat
    const seatsSnap = await tx.get(tableRef.collection('seats'));
    const seats = [];
    seatsSnap.forEach(doc=>seats.push({ seat: parseInt(doc.id,10), ...doc.data(), _ref: doc.ref }));
    const actingSeat = seats.find(s=>s.seat === table.currentSeat);
    if (!actingSeat) throw new functions.https.HttpsError('failed-precondition','Current seat missing');
    if (actingSeat.playerId !== uid) throw new functions.https.HttpsError('permission-denied','Not your turn');

    if (actingSeat.hasFolded || actingSeat.chips < 0) {
      throw new functions.https.HttpsError('failed-precondition','Seat cannot act');
    }

    // Determine highest bet this street
    const highestBet = Math.max(0, ...seats.map(s=>s.betThisStreet||0));

    let pot = table.pot || 0;
    let newBet = actingSeat.betThisStreet || 0;

    if (action === 'fold') {
      tx.set(actingSeat._ref, {
        hasFolded: true,
        lastActionAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else if (action === 'check') {
      if (highestBet !== newBet) throw new functions.https.HttpsError('failed-precondition','Cannot check facing a bet');
      tx.set(actingSeat._ref, { lastActionAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } else if (action === 'call') {
      const toCall = highestBet - newBet;
      let pay = Math.min(toCall, actingSeat.chips);
      pot += pay;
      tx.set(actingSeat._ref, {
        chips: actingSeat.chips - pay,
        betThisStreet: newBet + pay,
        isAllIn: (actingSeat.chips - pay) === 0,
        lastActionAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else if (action === 'bet' || action === 'raise') {
      const minRaise = (table.bb || 10);
      let target = amount|0;
      if (target <= highestBet && action === 'raise') throw new functions.https.HttpsError('invalid-argument','Raise must exceed current bet');
      if (action === 'raise' && target < highestBet + minRaise) target = highestBet + minRaise;
      if (action === 'bet' && highestBet > 0) throw new functions.https.HttpsError('failed-precondition','Bet not allowed, you must raise');

      // Pay up to target
      const toPut = target - newBet;
      if (toPut <= 0) throw new functions.https.HttpsError('invalid-argument','Invalid amount');
      const pay = Math.min(toPut, actingSeat.chips);
      pot += pay;
      tx.set(actingSeat._ref, {
        chips: actingSeat.chips - pay,
        betThisStreet: newBet + pay,
        isAllIn: (actingSeat.chips - pay) === 0,
        lastActionAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      throw new functions.https.HttpsError('invalid-argument','Unknown action');
    }

    // Determine next player
    const activeSeats = seats
      .filter(s=>!s.hasFolded && s.playerId)
      .map(s=>s.seat)
      .sort((a,b)=>a-b);

    // If only one player remains -> immediate showdown/award
    const notFolded = seats.filter(s=>!s.hasFolded && s.playerId);
    if (notFolded.length === 1) {
      const winner = notFolded[0];
      tx.set(winner._ref, { chips: (winner.chips||0) + pot }, { merge: true });
      tx.set(tableRef, {
        stage: 'idle',
        currentSeat: null,
        pot: 0,
        community: [],
        actingSince: null
      }, { merge: true });
      return { ok: true, ended: true, winner: winner.seat };
    }

    // Has betting round ended? (everyone either matched highest or all-in/folded)
    const afterSeatDocs = await Promise.all(
      seats.map(async s => {
        const snap = await s._ref.get();
        return { ...s, ...snap.data() };
      })
    );

    const streetHighest = Math.max(0, ...afterSeatDocs.map(s=>s.betThisStreet||0));
    const needsAction = afterSeatDocs.filter(s=>{
      if (!s.playerId || s.hasFolded) return false;
      if (s.isAllIn) return false;
      return (s.betThisStreet||0) !== streetHighest;
    });

    if (needsAction.length === 0) {
      // Move to next stage or showdown
      tx.set(tableRef, {
        pot,
        actingSince: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      // We'll perform stage advance outside of the transaction
      return { ok: true, advance: true };
    }

    // Otherwise, set next currentSeat to next active in order
    const order = seatOrderStartingFrom(afterSeatDocs.filter(s=>s.playerId), table.currentSeat).map(s=>s.seat);
    let nextSeat = nextOccupiedSeatInOrder(order, table.currentSeat);
    // Skip folded/all-in seats
    for (let guard=0; guard<order.length; guard++) {
      const peek = afterSeatDocs.find(s=>s.seat===nextSeat);
      if (peek && !peek.hasFolded && !peek.isAllIn) break;
      nextSeat = nextOccupiedSeatInOrder(order, nextSeat);
    }

    tx.set(tableRef, {
      pot,
      currentSeat: nextSeat,
      actingSince: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { ok: true, nextSeat };
  }).then(async result => {
    // If we need to advance stage, do it post-transaction
    if (result.advance) {
      await advanceStage(db.collection('tables').doc(tableId));
    }
    return result;
  });
});

// -----------------------------
// Scheduled: enforceTurnTimeouts
// Every minute, folds seats that have exceeded 20s without action.
// Requires Cloud Scheduler API enabled.
// -----------------------------
exports.enforceTurnTimeouts = functions
  .region(REGION)
  .pubsub.schedule('every 1 minutes')
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const cutoffSeconds = 20;

    const tablesSnap = await db.collection('tables')
      .where('stage', 'in', ['preflop','flop','turn','river'])
      .get();

    for (const tableDoc of tablesSnap.docs) {
      const table = tableDoc.data();
      if (!table.actingSince || !table.currentSeat) continue;

      const elapsed = now.seconds - table.actingSince.seconds;
      if (elapsed < cutoffSeconds) continue;

      // Timeout -> fold the current seat
      const seatRef = tableDoc.ref.collection('seats').doc(String(table.currentSeat));
      const seatSnap = await seatRef.get();
      if (!seatSnap.exists) continue;
      const s = seatSnap.data();
      if (!s.playerId || s.hasFolded) continue;

      // Force a fold using a small transaction to keep pot/bets intact (fold doesn’t change pot)
      await db.runTransaction(async tx => {
        const tSnap = await tx.get(tableDoc.ref);
        const t = tSnap.data();
        const seatsSnap = await tx.get(tableDoc.ref.collection('seats'));
        const seats = [];
        seatsSnap.forEach(doc=>seats.push({ seat: parseInt(doc.id,10), ...doc.data(), _ref: doc.ref }));

        tx.set(seatRef, {
          hasFolded: true,
          lastActionAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // pick next actor
        const order = seatOrderStartingFrom(seats.filter(x=>x.playerId), t.currentSeat).map(x=>x.seat);
        let nextSeat = nextOccupiedSeatInOrder(order, t.currentSeat);
        for (let guard=0; guard<order.length; guard++) {
          const peek = seats.find(x=>x.seat===nextSeat);
          if (peek && !peek.hasFolded && !peek.isAllIn && peek.playerId) break;
          nextSeat = nextOccupiedSeatInOrder(order, nextSeat);
        }

        tx.set(tableDoc.ref, {
          currentSeat: nextSeat,
          actingSince: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
    }

    return null;
  });

// -----------------------------
// Callable: revealRequest (optional)
// Lets a player explicitly reveal at showdown if UI wants control (not required since we auto-reveal).
// -----------------------------
exports.revealRequest = functions.region(REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { tableId, seat } = data || {};
  if (!tableId || !seat) throw new functions.https.HttpsError('invalid-argument','tableId & seat required');

  const seatRef = db.collection('tables').doc(tableId).collection('seats').doc(String(seat));
  const snap = await seatRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found','Seat not found');
  const d = snap.data();
  if (d.playerId !== context.auth.uid) throw new functions.https.HttpsError('permission-denied','Not your seat');

  await seatRef.set({ publicHole: d.privateHole || [] }, { merge: true });
  return { ok: true };
});
