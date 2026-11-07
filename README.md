# Immersive Games Studio — Treasure Hunt Website

A responsive React + TypeScript + Vite website for the Immersive Games Studio treasure hunt. The public site intentionally avoids story and character spoilers.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Custom registration form

The homepage's “Start registration” links open the custom form at the hash route `#/register`, so it works without requiring host-side rewrite rules.

The form implements the approved questionnaire:
- Questions 2, 3, and 8 are free-text fields.
- Question 9 is multiple-choice (checkboxes).
- The remaining questions are single-choice.
- Free-text input has length limits; the email field uses browser email validation.
- The form submits JSON to the server-side URL configured in `VITE_REGISTRATION_API_URL`.

### Registration backend

The Firebase Cloud Function named `submitRegistration` accepts `POST` requests, validates the approved questionnaire fields on the server, applies a basic per-IP rate limit, rejects invalid submissions, ignores submissions with the honeypot filled, and writes accepted applications to the private `registrations` Firestore collection. It does not return applicant data to the caller. The rate-limit collection is named `_registrationRateLimits` and stores a SHA-256 hash of the request IP rather than the raw IP address.

The allowed browser origins currently include the default Firebase Hosting domains and local Vite development origins. Add any future custom website domain to `allowedOrigins` in `functions/src/index.ts` before using it.

Deploy only after running the build and lint checks and testing with non-sensitive test data.

### Important: submission backend is not connected yet

Until `VITE_REGISTRATION_API_URL` points to a working HTTPS endpoint, the form will explicitly tell applicants that their answers have **not** been sent or saved. Do not launch recruitment until the endpoint is implemented and tested.

The endpoint must validate every field on the server, allow only the expected choice values, enforce text length limits, reject submissions with the honeypot field populated, apply reasonable rate limiting, and save records privately. It should return a successful 2xx response only after the record is safely stored. Never put Firestore admin credentials, service-account keys, or other secrets in a `VITE_` variable or client-side code. Public users must not be able to read applicant records.

The expected request JSON uses these fields:
`ageConfirmed`, `fullName`, `email`, `travelMetroVancouver`, `area`, `commitToSessions`, `availability`, `motivation`, `puzzleApproaches` (array), `uncertaintyReaction`, `comfortableRecording`, `comfortableExperience`, and `website` (honeypot; should be empty).

After setting `VITE_REGISTRATION_API_URL`, restart the Vite development server.

## Build

```bash
npm run build
npm run preview
```

## Before launch

- Implement and configure the secure submission endpoint and private storage.
- Test valid submissions, invalid answers, long text, spam protection, service errors, and mobile layouts.
- Publish verified Contact, Privacy Policy, and Terms / Participation Rules information.
- Review prize wording and recording/publication disclosure against the finalized rules and consent documents.
- Confirm privacy, retention, recording, publication, and participant consent processes before recruiting.

The registration form does not collect formal recording consent. Applying is not confirmation of selection or participation.


## Administrator dashboard (feature branch)

The administrator interface is available at `#/admin`. It uses Firebase Authentication email/password sign-in and reads registrations directly from Firestore under restrictive security rules. Status changes are performed by the `updateRegistrationStatus` callable Cloud Function, which independently verifies the caller against the server-side `admins/{uid}` record.

### Setup before testing

1. In Firebase Authentication, enable the Email/Password provider and create the administrator account.
2. Copy the administrator's Firebase Authentication UID.
3. In Firestore, create `admins/{uid}` with exactly `{ "active": true }`. Do not expose this collection to public writes; the rules allow an authenticated user to read only their own admin record and prohibit client writes.
4. Copy the Firebase web app's API key, auth domain, project ID, and app ID into the four `VITE_FIREBASE_*` variables in `.env`. These are Firebase's public web configuration values, not service-account secrets.
5. Run `npm install` to install the Firebase client SDK and refresh the root lockfile, then run `npm run build`.
6. Deploy Firestore rules and Functions only after reviewing them: `firebase deploy --only firestore:rules,functions`. Do not deploy as part of this code change without an explicit production approval.

Open `https://your-domain/#/admin` to sign in. The initial implementation supports applicant listing, search, status filtering, viewing questionnaire fields, and backend-authorized status updates. Supported statuses are `new`, `under_review`, `approved`, `rejected`, and `contacted`.

**Important:** Approval currently changes the application status only. It does not yet create a player account, assign a player ID, or send an approval email; those belong to the next milestone. The dashboard assumes the existing registration documents contain `createdAt`, `fullName`, and `email` fields. Records missing `createdAt` may not appear in the ordered query until normalized.


## Local emulator seed data

The seed command loads its settings from the root-level `.env.seed` file. Copy `.env.seed.example` to `.env.seed`, set a local administrator email and a strong local-only password, and confirm the Auth and Firestore emulator hosts point to localhost. The command refuses to run unless both emulators are configured on the expected local ports.

```bash
npm run seed
```

The registration data file is selected with `SEED_REGISTRATIONS_FILE` (relative to the repository root, unless an absolute path is supplied). Seed scripts are for local emulator data only; never use production credentials or real participant data in this file.

## Player portal sign-in

Players sign in with their Player ID and password. The backend resolves the Player ID to the account email privately, verifies the password with Firebase Authentication, and returns a Firebase custom token. The account email is never returned by a Player ID lookup. The Functions parameter `FIREBASE_WEB_API_KEY` must be set to the Firebase project's public Web API key when deploying Functions. It is a public Firebase client configuration value, not a service-account credential.
