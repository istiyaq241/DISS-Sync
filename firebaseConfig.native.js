import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyD0ODAyvsJD1_1b4tlOnEk7MS0Gc_lev2k',
  authDomain: 'diss-sync.firebaseapp.com',
  projectId: 'diss-sync',
  storageBucket: 'diss-sync.firebasestorage.app',
  messagingSenderId: '1072940846539',
  appId: '1:1072940846539:web:75bd59d7143a58cd8e3a4e',
};

const app = initializeApp(firebaseConfig);

let authInstance;

try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const db = getFirestore(app);
