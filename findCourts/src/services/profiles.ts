import type { User } from 'firebase/auth';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type Profile = { firebase_uid: string; username: string; created_at: string };
export class ProfileError extends Error {}

export function validateUsername(username: string) {
    return /^[A-Za-z0-9_]{3,24}$/.test(username.trim());
}

async function requestProfile(user: User, username?: string): Promise<Profile | null> {
    if (!supabase) throw new ProfileError('Profile storage is unavailable. Please try again later.');
    try {
        const { data, error } = await supabase.functions.invoke('profile', {
            method: username === undefined ? 'GET' : 'POST',
            headers: { Authorization: `Bearer ${await user.getIdToken()}` },
            ...(username === undefined ? {} : { body: { username: username.trim() } }),
        });
        if (error) {
            if (error instanceof FunctionsHttpError) {
                const body = await error.context.json().catch(() => null);
                throw new ProfileError(body?.error || 'Unable to access your profile. Please try again.');
            }
            throw new ProfileError('Unable to reach profile storage. Check your connection and try again.');
        }
        const profile = data?.profile;
        if (profile === null && username === undefined) return null;
        if (!profile || profile.firebase_uid !== user.uid || typeof profile.username !== 'string') {
            throw new ProfileError('Unable to read your profile. Please try again.');
        }
        return profile;
    } catch (error) {
        if (error instanceof ProfileError) throw error;
        throw new ProfileError('Unable to access your profile. Please try again.');
    }
}

export function getProfile(user: User) { return requestProfile(user); }
export function saveProfile(user: User, username: string) {
    if (!validateUsername(username)) {
        throw new ProfileError('Use 3–24 letters, numbers, or underscores for your username.');
    }
    return requestProfile(user, username);
}
