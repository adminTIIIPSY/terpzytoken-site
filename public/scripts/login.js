// scripts/login.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ✅ Firebase config (TerpzyVerseClubSocial project)
const firebaseConfig = {
  apiKey: "AIzaSyAAJfscsLm4TdBzbYZ5dYa1BWZwpSPcVf8",
  authDomain: "terpzyverseclubsocial.firebaseapp.com",
  projectId: "terpzyverseclubsocial",
  storageBucket: "terpzyverseclubsocial.appspot.com",
  messagingSenderId: "125077088870",
  appId: "1:125077088870:web:91195a40d290c6bff09ba7"
};

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ✅ Exported login function
export async function login(email, password) {
  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    const user = userCred.user;
    if (!user.emailVerified) {
      throw new Error("Please verify your email before logging in.");
    }
    return user;
  } catch (err) {
    throw err;
  }
}
