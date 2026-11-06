import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Web uses Firebase's default browser persistence.
export function initializeFirebaseAuth(app: FirebaseApp) {
    return getAuth(app);
}
