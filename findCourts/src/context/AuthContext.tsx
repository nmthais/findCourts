import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import {
    createUserWithEmailAndPassword,
    deleteUser,
    EmailAuthProvider,
    onAuthStateChanged,
    reauthenticateWithCredential,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signOut,
    updatePassword,
    type User,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { ProfileError, saveProfile, validateUsername } from '@/services/profiles';
import { isSupabaseConfigured } from '@/lib/supabase';

function requireAuth() {
    if (!auth) throw new Error('Firebase authentication is not configured.');
    return auth;
}

async function login(email: string, password: string) {
    await signInWithEmailAndPassword(requireAuth(), email.trim(), password);
}

async function resetPassword(email: string) {
    await sendPasswordResetEmail(requireAuth(), email.trim());
}

async function signup(email: string, password: string, username: string) {
    if (!isSupabaseConfigured) throw new ProfileError('Profile storage is unavailable. Please try again later.');
    if (!email.trim() || !password || !username.trim()) throw new ProfileError('Complete all fields.');
    if (!validateUsername(username)) throw new ProfileError('Use 3–24 letters, numbers, or underscores for your username.');
    const { user } = await createUserWithEmailAndPassword(requireAuth(), email.trim(), password);
    try {
        await saveProfile(user, username);
    } catch (profileError) {
        // Account creation spans two services with no shared transaction; undo the
        // Firebase signup if saving the required Supabase profile fails.
        try {
            await deleteUser(user);
        } catch {
            await signOut(requireAuth()).catch(() => undefined);
            throw new ProfileError(
                'Your login was created, but your profile could not be saved. Log in and try setting your username again.',
            );
        }
        throw profileError;
    }
}

async function logout() {
    await signOut(requireAuth());
}

async function changePassword(currentPassword: string, newPassword: string) {
    const currentUser = requireAuth().currentUser;
    if (!currentUser?.email) throw new Error('No email account is available.');
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
}

type AuthContextValue = {
    user: User | null;
    loading: boolean;
    isConfigured: boolean;
    login: typeof login;
    resetPassword: typeof resetPassword;
    signup: typeof signup;
    logout: typeof logout;
    changePassword: typeof changePassword;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(isFirebaseConfigured);

    useEffect(() => {
        if (!auth) return;

        // The first callback runs after Firebase has restored the saved session.
        // Returning the unsubscribe function removes this listener on unmount.
        return onAuthStateChanged(auth, (nextUser) => {
            setUser(nextUser);
            setLoading(false);
        });
    }, []);

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            isConfigured: isFirebaseConfigured,
            login,
            resetPassword,
            signup,
            logout,
            changePassword,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used inside AuthProvider.');
    return context;
}
