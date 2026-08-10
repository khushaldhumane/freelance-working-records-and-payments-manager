// Firebase configuration
// Replace these values with your actual Firebase project config
// Get this from: Firebase Console → Project Settings → Your Apps → Web App

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyCCH_q6LL-n8b3umpIMf2TPry4VFxLX6X8",
  authDomain: "freelance-tracker-52b3e.firebaseapp.com",
  projectId: "freelance-tracker-52b3e",
  storageBucket: "freelance-tracker-52b3e.firebasestorage.app",
  messagingSenderId: "1076487973015",
  appId: "1:1076487973015:web:696a7e4613a8a0fc9461d2"
};

// Guard against duplicate initialization on HMR
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
