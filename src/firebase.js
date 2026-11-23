
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBRxb--wFAvtkJmEKsVJpiHKWQESPjvWcc",
  authDomain: "cng-hisab-453a6.firebaseapp.com",
  projectId: "cng-hisab-453a6",
  storageBucket: "cng-hisab-453a6.firebasestorage.app",
  messagingSenderId: "524719729642",
  appId: "1:524719729642:web:68763fa0aacb1b6f2c2093"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
