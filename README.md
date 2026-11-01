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
