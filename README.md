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
