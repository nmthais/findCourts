import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'npm:jose@6';

const firebaseKeys = createRemoteJWKSet(new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
));

export async function verifyFirebaseIdentity(token: string, project: string, keys: JWTVerifyGetKey = firebaseKeys) {
    const { payload } = await jwtVerify(token, keys, {
        algorithms: ['RS256'],
        issuer: `https://securetoken.google.com/${project}`,
        audience: project,
        requiredClaims: ['sub', 'exp', 'iat', 'auth_time'],
    });
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub || payload.sub.length > 128 ||
        typeof payload.iat !== 'number' || payload.iat > now ||
        typeof payload.auth_time !== 'number' || payload.auth_time > now) {
        throw new Error('Invalid Firebase identity.');
    }
    return payload.sub;
}
