import { parseReviewInput } from '../functions/reviews/index.ts';

function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
}

Deno.test('Review input accepts valid ratings and normalizes comments', () => {
    const result = parseReviewInput({ court_id: ' node-123 ', rating: 5, comment: ' Great court! ' });
    assert(result?.courtId === 'node-123', 'Court ID was not normalized.');
    assert(result?.rating === 5, 'Rating was not preserved.');
    assert(result?.comment === 'Great court!', 'Comment was not normalized.');
    assert(parseReviewInput({ court_id: 'node-123', rating: 4, comment: '   ' })?.comment === null,
        'Blank comments should be stored as null.');
});

Deno.test('Review input rejects invalid data', () => {
    assert(parseReviewInput({ court_id: '', rating: 5 }) === null, 'Blank court IDs must fail.');
    assert(parseReviewInput({ court_id: 'node-123', rating: 0 }) === null, 'Ratings below 1 must fail.');
    assert(parseReviewInput({ court_id: 'node-123', rating: 6 }) === null, 'Ratings above 5 must fail.');
    assert(parseReviewInput({ court_id: 'node-123', rating: 4.5 }) === null, 'Decimal ratings must fail.');
    assert(parseReviewInput({ court_id: 'node-123', rating: 5, comment: 42 }) === null,
        'Non-string comments must fail.');
    assert(parseReviewInput({ court_id: 'node-123', rating: 5, comment: 'x'.repeat(2001) }) === null,
        'Oversized comments must fail.');
});
