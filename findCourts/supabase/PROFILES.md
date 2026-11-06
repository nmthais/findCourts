# Firebase user profiles

Firebase owns email/password authentication and enforces unique email login
identities. Supabase `profiles` stores `firebase_uid` (primary key), `username`,
and `created_at`. Usernames are **not unique** and accept 3–24 ASCII letters,
numbers, or underscores. Email/password are not copied into this table.

## Deploy

From `findCourts`, with the intended Supabase project linked:

```powershell
npx supabase db push
npx supabase secrets set FIREBASE_PROJECT_ID=findcourts-8a30a
npx supabase functions deploy profile --use-api
```

The hosted function uses Supabase's provided `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Never put a server secret in Expo environment
variables. Local function testing also needs `FIREBASE_PROJECT_ID` in the local
functions env file. Firebase Email/Password must be enabled in Firebase Console.

## Authorization

The app sends a Firebase ID token in the Authorization header. The `profile`
function verifies its RS256 signature against Google's public keys, issuer,
project audience, expiry, subject, and issued/authentication times. It selects or
upserts only the UID from the verified token, never a caller-supplied UID.

`verify_jwt = false` skips Supabase's gateway JWT check because the function
performs Firebase verification itself. No Firebase Admin key, custom role claim,
or Supabase third-party-auth integration is needed for this backend-mediated
profile flow. Existing public court requests remain unchanged.

RLS is enabled and direct `anon`/`authenticated` table access is revoked. Only
the backend service role accesses profiles. Signature verification does not
check immediate Firebase revocation/disabled-user status; an already-issued
token can remain valid until expiry. Add revocation checks if immediate account
blocking is required later.

## Recovery and checks

Firebase signup and the database write cannot be one transaction. If the write
fails, keep the Firebase account signed in and navigate to Account with a notice.
Do not repeat account creation. Account offers a username field and **Save username**
when no profile exists, or Retry when the profile service is unavailable. This
also works after restarting. Signup is only for new accounts; signed-in users
opening it are redirected to Account.

Account reads the saved username from Supabase. Login remains email/password.

```powershell
npx tsc --noEmit
npx expo lint
npx --yes deno check --config supabase/deno.json supabase/functions/profile/index.ts
npx --yes deno test --config supabase/deno.json --allow-read supabase/tests/profiles_test.ts
```

Device checks after deploy: create two different-email users with the same
username; verify duplicate email is rejected; verify username survives restart;
interrupt profile saving and retry without creating another Firebase account.
