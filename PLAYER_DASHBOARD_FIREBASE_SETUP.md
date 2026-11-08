# Player Dashboard — Firebase setup and rollout

This feature is implemented on `feature/player-dashboard`. It has **not** been deployed to Firebase.

## Firebase changes required before testing/deployment

1. **Confirm Firebase Storage is enabled** for project `immersive-game-studio`. In Firebase Console, open Build → Storage and create/use the project's default bucket. Copy the exact bucket name shown there; do not guess it.
2. Add the bucket name to the frontend environment:
   ```env
   VITE_FIREBASE_STORAGE_BUCKET=YOUR_EXACT_BUCKET_NAME
   ```
   Add it to the local environment used by Vite and to whichever production build environment you use. Vite embeds `VITE_*` values at build time. Do not commit production secrets.
3. The repository now contains updated `firestore.rules`, `firestore.indexes.json`, and new `storage.rules`. Review these files, then deploy the rules and indexes:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage --project immersive-game-studio
   ```
4. The Storage emulator is configured on port `9199`. For local development, start all four emulators:
   ```bash
   firebase emulators:start --only auth,firestore,functions,storage --project immersive-game-studio
   ```
   The frontend now connects to the Storage emulator whenever `import.meta.env.DEV` is true.
5. Build and test locally before deploying:
   ```bash
   npm run build
   npm --prefix functions run lint
   npm --prefix functions run build
   ```

## Deploy only the new Cloud Functions

The project has older production functions that are intentionally not in the current source tree. To avoid a broad functions deployment that could prompt about deleting unrelated deployed functions, deploy only the new exports:

```bash
firebase deploy --only functions:createQuest,functions:updateQuest,functions:assignQuest,functions:recordQuestSubmission,functions:reviewQuestSubmission,functions:createTeam,functions:setTeamSuggestionsOpen,functions:assignPlayerToTeam,functions:suggestTeammate,functions:reviewTeamSuggestion,functions:respondToTeamSuggestion --project immersive-game-studio
```

Do not deploy these changes until the branch has been reviewed and the local tests pass.

## Data model created by this feature

- `quests/{questId}`: reusable quest definition, allowed MIME types and upload limits.
- `questAssignments/{assignmentId}`: one player's assignment, status, evidence metadata and review feedback.
- `teams/{teamId}`: team membership, display names and whether suggestions are open.
- `teamSuggestions/{suggestionId}`: Player A's request, admin decision, Player B's response and final status.
- Storage path: `quest-submissions/{playerUid}/{assignmentId}/{fileName}`.

Client writes to these Firestore collections are denied. Callable Functions validate the authenticated player or active admin before mutating data. Evidence files are private to their owner and active admins.

## Team workflow implemented

1. Admin creates a team.
2. Admin manually adds Player A to the team using their Player ID.
3. If suggestions are open, Player A can suggest Player B by Player ID.
4. Admin approves or rejects the suggestion.
5. On approval, Player B sees the request in their player portal.
6. Player B accepts or declines. Only acceptance adds Player B to the team.

Player B remains unassigned until accepting. The player portal is not real-time; refresh/revisit the dashboard to load changes.

## Current V1 limits

- Up to 5 evidence files per assignment, 50 MB each.
- Supported file types: JPEG, PNG, WebP, MP4, QuickTime/MOV, WebM, PDF, DOC and DOCX.
- Quest submissions are individual and private to the submitting player and admins.
- Teammate progress is not exposed.
- Team membership changes are performed by admins; no self-service transfers/removals are provided.
