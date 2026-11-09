import type { User } from 'firebase/auth';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Court } from '@/type/Court';

export type ContributionTab = 'reviews' | 'photos';
export type Contribution = {
    id: string;
    court_id: string;
    court: Court;
    created_at: string;
    updated_at?: string;
    rating?: number;
    comment?: string | null;
    cloudinary_secure_url?: string;
};
export type ContributionPage = { items: Contribution[]; nextCursor: string | null };

export async function getContributions(user: User, tab: ContributionTab, cursor: string | null = null): Promise<ContributionPage> {
    if (!supabase) throw new Error('Contributions are unavailable right now.');
    const params = new URLSearchParams({ tab });
    if (cursor) params.set('cursor', cursor);
    const { data, error } = await supabase.functions.invoke(`contributions?${params}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        throw new Error(body?.error ?? 'Unable to load your contributions.');
    }
    if (error) throw new Error('Unable to reach contributions. Check your connection and try again.');
    if (!data || !Array.isArray(data.items)) throw new Error('The contributions response was invalid.');
    return data;
}
