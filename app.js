// — your on‑chain wallet address here —
const walletAddress = '0x1234…ABCD';

const buyBtn       = document.getElementById('buyBtn');
const registerBtn  = document.getElementById('registerBtn');
const clubsocialBtn= document.getElementById('clubsocialBtn');
const buyModal     = document.getElementById('buyModal');
const walletAddrEl = document.getElementById('walletAddr');
const paidBtn      = document.getElementById('paidBtn');

// BUY flow
buyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(walletAddress);
  walletAddrEl.textContent = walletAddress;
  buyModal.style.display = 'flex';
});

// After user sends MATIC, click “I’ve Paid”
paidBtn.addEventListener('click', () => {
  // TODO: invoke your back‑end to:
  //   • validate transaction & email receipt
  //   • create a temp wallet tied to their new account
  //   • schedule your “release date” alert for yourself
  window.location.href = '/register.html';
});

// REGISTER button
registerBtn.addEventListener('click', () => {
  window.location.href = '/register.html';
});

// CLUBSOCIAL button
clubsocialBtn.addEventListener('click', () => {
  window.location.href = 'https://clubsocial.click';
});
