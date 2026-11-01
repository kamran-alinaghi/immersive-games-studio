# Immersive Games Studio — Treasure Hunt Landing Page

A responsive React + TypeScript + Vite landing page for the Treasure Hunt experience. It intentionally avoids story and character spoilers.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell, copy the environment template with:

```powershell
Copy-Item .env.example .env
```

## Connect the existing questionnaire

Set `VITE_QUESTIONNAIRE_URL` in `.env` to the URL of your candidate questionnaire. The “Start registration” links will use that URL. If it is not configured, the page displays a notice and does not pretend that an application has been submitted.

Restart the dev server after changing `.env`.

## Build

```bash
npm run build
npm run preview
```

## Before launch

- Connect and test the real questionnaire URL.
- Replace the illustrative CSS map artwork with approved brand imagery if desired.
- Add verified Contact, Privacy Policy, and Terms URLs.
- Review prize wording and recording/publication disclosure against the finalized rules and consent documents.
- Confirm the exact hint deduction and prize calculation in the official rules.
- Review privacy, recording, publication, and participant consent requirements before recruiting.

The landing page does not collect questionnaire answers. Applications are intended to be handled by the existing questionnaire.
