import type { User } from 'firebase/auth';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type Review = {
    id: string;
    court_id: string;
    rating: number;
    comment: string | null;
    username: string;
    created_at: string;
    updated_at: string;
    is_mine: boolean;
};

export type ReviewsPage = {
    reviews: Review[];
    myReview: Review | null;
    count: number;
    averageRating: number | null;
    limit: number;
    offset: number;
};

export class ReviewError extends Error {}

async function firebaseHeaders(user?: User | null) {
    return user ? { Authorization: `Bearer ${await user.getIdToken()}` } : undefined;
}

async function functionError(error: unknown) {
    if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        return new ReviewError(body?.error || 'Unable to access reviews. Please try again.');
    }
    return new ReviewError('Unable to reach reviews. Check your connection and try again.');
}

function requireReviews() {
    if (!supabase) throw new ReviewError('Reviews are unavailable right now.');
    return supabase;
}

export async function getReviews(
    courtId: string,
    user?: User | null,
    offset = 0,
    limit = 20,
): Promise<ReviewsPage> {
    const client = requireReviews();
    const { data, error } = await client.functions.invoke(
        `reviews?court_id=${encodeURIComponent(courtId)}&offset=${offset}&limit=${limit}`,
        { method: 'GET', headers: await firebaseHeaders(user) },
    );
    if (error) throw await functionError(error);
    return {
        reviews: Array.isArray(data?.reviews) ? data.reviews : [],
        myReview: data?.my_review ?? null,
        count: typeof data?.count === 'number' ? data.count : 0,
        averageRating: typeof data?.average_rating === 'number' ? data.average_rating : null,
        limit: typeof data?.limit === 'number' ? data.limit : 20,
        offset: typeof data?.offset === 'number' ? data.offset : 0,
    };
}

export async function saveReview(
    user: User,
    courtId: string,
    rating: number,
    comment?: string,
): Promise<Review> {
    const client = requireReviews();
    const { data, error } = await client.functions.invoke('reviews', {
        method: 'POST',
        headers: await firebaseHeaders(user),
        body: { court_id: courtId, rating, comment: comment?.trim() || null },
    });
    if (error) throw await functionError(error);
    if (!data?.review) throw new ReviewError('The saved review could not be read.');
    return data.review;
}

export async function deleteReview(user: User, courtId: string) {
    const client = requireReviews();
    const { data, error } = await client.functions.invoke('reviews', {
        method: 'DELETE',
        headers: await firebaseHeaders(user),
        body: { court_id: courtId },
    });
    if (error) throw await functionError(error);
    if (!data?.deleted) throw new ReviewError('The review could not be deleted.');
}
