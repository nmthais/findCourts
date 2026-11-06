import { getApp, getApps, initializeApp } from "firebase/app";
import { initializeFirebaseAuth } from './firebaseAuth';
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAh9kN4PkJa0wRJYu-ojz1q6K3aqenY0Yg",
  authDomain: "findcourts-8a30a.firebaseapp.com",
  projectId: "findcourts-8a30a",
  storageBucket: "findcourts-8a30a.firebasestorage.app",
  messagingSenderId: "6713136078",
  appId: "1:6713136078:web:b8ea1f150ebd0237f5919f",
  measurementId: "G-7XSJHXK02P"
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId
);

export const auth = isFirebaseConfigured
  ? initializeFirebaseAuth(getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;
