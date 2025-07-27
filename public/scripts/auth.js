// public/scripts/auth.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, sendEmailVerification } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// 🔥 Your Firebase project config (replace only if you change the Firebase project again)
const firebaseConfig = {
  apiKey: "AIzaSyAAJfscsLm4TdBzbYZ5dYa1BWZwpSPcVf8",
  authDomain: "terpzyverseclubsocial.firebaseapp.com",
  projectId: "terpzyverseclubsocial",
  storageBucket: "terpzyverseclubsocial.appspot.com",
  messagingSenderId: "125077088870",
  appId: "1:125077088870:web:91195a40d290c6bff09ba7"
};

// 🔧 Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ✅ Register function
export async function register(email, password, avatar) {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Add user data to Firestore
  await setDoc(doc(db, "users", user.uid), {
    email: email,
    avatar: avatar,
    createdAt: new Date().toISOString(),
  });

  // Send verification email
  await sendEmailVerification(user);
}
