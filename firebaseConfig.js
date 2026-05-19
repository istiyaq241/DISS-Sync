import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyD0ODAyvsJD1_1b4tlOnEk7MS0Gc_lev2k',
  authDomain: 'diss-sync.firebaseapp.com',
  projectId: 'diss-sync',
  storageBucket: 'diss-sync.firebasestorage.app',
  messagingSenderId: '1072940846539',
  appId: '1:1072940846539:web:75bd59d7143a58cd8e3a4e',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
