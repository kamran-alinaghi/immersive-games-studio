import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
} from 'firebase/functions';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length) {
  console.warn(
    `Firebase client configuration is missing: ${missing.join(', ')}`,
  );
}

const app = initializeApp(config);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'us-central1');

// The emulator ports are defined in firebase.json.
// Keep local development isolated from production Firestore and Functions.
if (import.meta.env.DEV) {
  connectFirestoreEmulator(db, '127.0.0.1', 8081);
  connectFunctionsEmulator(functions, '127.0.0.1', 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  console.info(
    '[Firebase] Using local Firestore (127.0.0.1:8081) and ' +
      'Functions (127.0.0.1:8080) emulators.',
  );
}

