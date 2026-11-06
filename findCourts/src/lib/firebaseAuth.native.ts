import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseError, type FirebaseApp } from 'firebase/app';
import {
    getAuth,
    initializeAuth,
    // @ts-expect-error Firebase's default types omit this verified React Native runtime export.
    getReactNativePersistence,
} from 'firebase/auth';

// Metro selects this file on iOS and Android, including Expo Go.
export function initializeFirebaseAuth(app: FirebaseApp) {
    try {
        return initializeAuth(app, {
            persistence: getReactNativePersistence(AsyncStorage),
        });
    } catch (error) {
        // Fast Refresh can run this module again after Auth is initialized.
        if (error instanceof FirebaseError && error.code === 'auth/already-initialized') {
            return getAuth(app);
        }
        throw error;
    }
}
