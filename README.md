# FindCourts

FindCourts is an Expo/React Native app for discovering nearby sports courts,
searching court data, viewing community photos, and leaving ratings and reviews.

The app uses:

- Expo and Expo Router for the mobile client
- Supabase PostgreSQL and Edge Functions for court, profile, review, and photo metadata
- Firebase Authentication for email/password accounts
- Cloudinary for uploaded court photos
- Overpass for OpenStreetMap court discovery
- Geoapify for optional address enrichment

The application source is in [`findCourts`](findCourts).

## Prerequisites

- Node.js 22.13 or newer; Node.js 24 is recommended
- npm
- An Android/iOS device with Expo Go, or an Android/iOS simulator
- A Supabase project
- A Firebase project with Email/Password authentication enabled
- A Cloudinary product environment with a signed upload preset
- Optional: Docker Desktop for running the complete Supabase stack locally

An Overpass API key is needed to discover courts in a new, empty database.
Geoapify is optional unless address enrichment is enabled.

## Quick start

From the repository root:

```powershell
cd findCourts
npm ci
Copy-Item .env.example .env
```

On macOS/Linux, use `cp .env.example .env` instead.

Set these values in `findCourts/.env`:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Both values are available in the Supabase dashboard under the project's API
settings. They are client-side values; never put a Supabase service-role or
server secret in an `EXPO_PUBLIC_` variable.

Start Expo:

```powershell
npx expo start --clear
```

Scan the QR code with Expo Go or select an emulator from the Expo terminal.
The device and development computer must be able to reach each other.

The checked-in Firebase client configuration points to the project's existing
Firebase app. To use a different Firebase project, follow the Firebase setup
below before starting Expo.

## Provision a new backend

These steps are only required when using your own Supabase, Firebase, and
Cloudinary projects. Run all commands from `findCourts`.

### 1. Link Supabase and apply migrations

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migrations create the court cache, search functions, profiles, reviews,
photo metadata, limits, and address-enrichment jobs. Apply migrations before
deploying Edge Functions.

### 2. Configure Firebase Authentication

In Firebase Console:

1. Create or select a Firebase project.
2. Open **Authentication > Sign-in method**.
3. Enable **Email/Password**.
4. Register a Web app and copy its Firebase client configuration.
5. Replace `firebaseConfig` in
   [`findCourts/src/lib/firebase.ts`](findCourts/src/lib/firebase.ts).

The Firebase Web configuration is a public client identifier. Do not download,
commit, or bundle a Firebase Admin service-account JSON file.

Tell the hosted Edge Functions which Firebase project may issue tokens:

```powershell
npx supabase secrets set FIREBASE_PROJECT_ID=YOUR_FIREBASE_PROJECT_ID
```

The Firebase project ID must match the `projectId` in `firebase.ts`.

### 3. Configure Cloudinary

In the intended Cloudinary product environment:

1. Open **Settings > Upload > Upload presets**.
2. Create an upload preset with signing mode set to **Signed**.
3. Copy the preset name, not its PID.
4. Open **Settings > API Keys** and copy the cloud name, API key, and API secret.

All four values must come from the same Cloudinary product environment.

```powershell
npx supabase secrets set CLOUDINARY_CLOUD_NAME=YOUR_CLOUD_NAME
npx supabase secrets set CLOUDINARY_API_KEY=YOUR_API_KEY
npx supabase secrets set CLOUDINARY_API_SECRET=YOUR_API_SECRET
npx supabase secrets set CLOUDINARY_UPLOAD_PRESET=YOUR_PRESET_NAME
```

For production, configure the upload preset to enforce appropriate image
formats and file-size/dimension limits. The app also applies a 10 MB client-side
limit, but client validation is not a security boundary.

### 4. Configure court discovery and address providers

For a new database, enable Overpass so map requests can discover courts:

```powershell
npx supabase secrets set OVERPASS_ENABLED=true
npx supabase secrets set OVERPASS_API_KEY=YOUR_OVERPASS_KEY
```

Without these values, `get-courts` returns already cached courts only. A fresh
database will therefore appear empty.

Address enrichment is optional:

```powershell
npx supabase secrets set ADDRESS_ENRICHMENT_ENABLED=true
npx supabase secrets set GEOAPIFY_API_KEY=YOUR_GEOAPIFY_KEY
```

Keep address enrichment disabled if no Geoapify key is configured. See
[`findCourts/supabase/README.md`](findCourts/supabase/README.md) for provider
budgets, scheduling, Vault configuration, and worker operations.

### 5. Deploy Edge Functions

```powershell
npx supabase functions deploy get-courts --use-api
npx supabase functions deploy search-courts --use-api
npx supabase functions deploy profile --use-api
npx supabase functions deploy reviews --use-api
npx supabase functions deploy cloudinary-signature --use-api
npx supabase functions deploy court-images --use-api
npx supabase functions deploy contributions --use-api
npx supabase functions deploy enrich-court-addresses --use-api
```

`verify_jwt = false` in `supabase/config.toml` is intentional. Account-related
functions verify Firebase ID tokens themselves; public court and gallery reads
do not use Supabase Auth.

### 6. Configure the mobile client

Copy `findCourts/.env.example` to `findCourts/.env`, then use the URL and
publishable key belonging to the same Supabase project linked above.

Restart Expo after changing client environment variables:

```powershell
npx expo start --clear
```

## Local Edge Function development

Copy the server environment template:

```powershell
Copy-Item supabase/functions/.env.example supabase/functions/.env.local
```

Fill in the local server secrets, then start Supabase and serve the functions:

```powershell
npx supabase start
npx supabase functions serve --env-file supabase/functions/.env.local
```

The `.env.local` file is ignored and must never be committed. Hosted functions
use Supabase Edge Function Secrets instead of this file.

## Verification

Run these commands before committing:

```powershell
npx tsc --noEmit
npx expo lint
npx --yes deno check --config supabase/deno.json supabase/functions/profile/index.ts supabase/functions/reviews/index.ts supabase/functions/cloudinary-signature/index.ts supabase/functions/court-images/index.ts
npx --yes deno test --config supabase/deno.json --allow-env --allow-read supabase/tests/
npx expo-doctor
```

Recommended device checks:

1. Load and search for courts.
2. Create an account, restart the app, and confirm the session persists.
3. Create, edit, and delete a review.
4. Upload multiple photos, open one full screen, and delete an owned photo.
5. Confirm logged-out users can view reviews/photos but cannot modify them.

## Common problems

### My contributions

Account > My contributions shows the signed-in user's currently published
reviews and photos in separate tabs. It includes court links, review ratings
and text, upload/review dates, and full-screen photo previews. Pull to refresh;
use Load more for older entries. Returning to the page refreshes its contents.
Deleted records and previous review versions are not retained here.

For an existing backend, run `npx supabase db push` and
`npx supabase functions deploy contributions --use-api` from `findCourts`.
The function uses the existing `FIREBASE_PROJECT_ID` secret and verifies the
Firebase token before filtering records by the user's UID. History uses
20-item cursor pages ordered by creation time and ID. The migration adds
indexes for these queries; it does not change existing contributions.

### The app says Supabase is unavailable

Check `findCourts/.env`, then restart Expo with `npx expo start --clear`.

### Cloudinary says "Upload preset not found"

Use the upload preset **name**, not the PID, and confirm that the preset, cloud
name, API key, and API secret belong to the same Cloudinary product environment.

### Docker/Supabase CLI creates files in the repository root

Run Supabase commands from `findCourts`, where `supabase/config.toml` lives. The
generated `supabase/.temp` directory is ignored.

### Expo reports dependency mismatches

Review them with:

```powershell
npx expo install --check
```

Use `npx expo install <package>` for Expo/React Native dependencies so the
installed version matches this Expo SDK.

## Security notes

- Never commit `.env`, Firebase Admin JSON, Cloudinary API secrets, or Supabase
  service-role/server keys.
- Only values prefixed with `EXPO_PUBLIC_` belong in the mobile environment.
- Cloudinary stores the image binary; Supabase stores its public ID, secure URL,
  court ID, and uploader UID.
- Firebase owns login email/password data. Supabase stores the Firebase UID and
  username profile, not user passwords.

