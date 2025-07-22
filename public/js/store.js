import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();

const PACKAGES = [
  { id: "starter", name: "Starter Pack", tokens: 100, price: 100 },
  { id: "gamer",   name: "Gamer Pack",   tokens: 500, price: 450 },
  { id: "whale",   name: "Whale Pack",   tokens: 1200, price: 1000 },
];

onAuthStateChanged(auth, user => {
  if (!user) return window.location.href = "/login.html";
  renderStore(user.uid);
});

function renderStore(uid) {
  const container = document.getElementById("packages");
  PACKAGES.forEach(pkg => {
    const div = document.createElement("div");
    div.innerHTML = `
      <h2>${pkg.name}</h2>
      <p>${pkg.tokens} TRPZ — $${pkg.price}</p>
      <div id="paypal-${pkg.id}"></div>
      <button id="crypto-${pkg.id}">Pay with Crypto</button>
    `;
    container.appendChild(div);

    paypal.Buttons({
      createOrder: (_, actions) =>
        actions.order.create({ purchase_units: [{ amount: { value: pkg.price.toFixed(2) } }] }),
      onApprove: (_, actions) =>
        actions.order.capture().then(() =>
          fetch("/confirmPayPal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderID: _.orderID, userId: uid, packageId: pkg.id, tokens: pkg.tokens })
          })
        )
    }).render(`#paypal-${pkg.id}`);

    document.getElementById(`crypto-${pkg.id}`)
      .addEventListener("click", () => {
        fetch("/createCoinbaseCharge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: uid, packageId: pkg.id, tokens: pkg.tokens, price: pkg.price })
        })
        .then(r => r.json())
        .then(data => window.location.href = data.hosted_url);
      });
  });
}
