import {createHash} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function requireAdmin(uid?: string) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  const admin = await db.collection("admins").doc(uid).get();
  if (!admin.exists || admin.data()?.active !== true) {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
}
async function requirePlayer(uid?: string) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  const player = await db.collection("players").doc(uid).get();
  if (!player.exists || player.data()?.status !== "approved") {
    throw new HttpsError("permission-denied", "An approved player account is required.");
  }
  return player;
}
const clean = (v: unknown, max = 500) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export const createQuest = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const title = clean(request.data?.title, 120);
  const description = clean(request.data?.description, 4000);
  const allowedTypes = request.data?.allowedTypes;
  const maxFiles = Number(request.data?.maxFiles ?? 5);
  const maxFileSizeBytes = Number(request.data?.maxFileSizeBytes ?? 50 * 1024 * 1024);
  if (!title || !description || !Array.isArray(allowedTypes) || !allowedTypes.length ||
      !allowedTypes.every((x: unknown) => ["image/jpeg","image/png","image/webp","video/mp4","video/quicktime","video/webm","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(String(x))) ||
      !Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 20 ||
      !Number.isInteger(maxFileSizeBytes) || maxFileSizeBytes < 1 || maxFileSizeBytes > 50 * 1024 * 1024) {
    throw new HttpsError("invalid-argument", "Enter a title, description, allowed file types, and valid upload limits.");
  }
  const ref = await db.collection("quests").add({
    title, description, allowedTypes, maxFiles, maxFileSizeBytes,
    active: true, createdAt: FieldValue.serverTimestamp(), createdBy: request.auth!.uid,
  });
  return {ok: true, questId: ref.id};
});

export const updateQuest = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const questId = clean(request.data?.questId, 150);
  if (!questId) throw new HttpsError("invalid-argument", "Quest ID is required.");
  const patch: Record<string, unknown> = {updatedAt: FieldValue.serverTimestamp()};
  if (typeof request.data?.active === "boolean") patch.active = request.data.active;
  if (typeof request.data?.title === "string" && clean(request.data.title,120)) patch.title = clean(request.data.title,120);
  if (typeof request.data?.description === "string" && clean(request.data.description,4000)) patch.description = clean(request.data.description,4000);
  await db.collection("quests").doc(questId).update(patch);
  return {ok: true};
});

export const assignQuest = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const questId = clean(request.data?.questId,150);
  const playerId = clean(request.data?.playerId,20).toUpperCase();
  if (!questId || !/^IGS-[A-Z0-9]{6}$/.test(playerId)) throw new HttpsError("invalid-argument","Valid quest and Player ID are required.");
  const quest = await db.collection("quests").doc(questId).get();
  if (!quest.exists || quest.data()?.active !== true) throw new HttpsError("not-found","Active quest not found.");
  const idDoc = await db.collection("playerIds").doc(playerId).get();
  const registrationId = idDoc.data()?.registrationId;
  if (!idDoc.exists || typeof registrationId !== "string") throw new HttpsError("not-found","Player not found.");
  const registration = await db.collection("registrations").doc(registrationId).get();
  if (!registration.exists || registration.data()?.status !== "approved") throw new HttpsError("failed-precondition","Player is not approved.");
  const uid = "player_" + createHash("sha256").update(registrationId).digest("hex").slice(0,40);
  const player = await db.collection("players").doc(uid).get();
  if (!player.exists || player.data()?.status !== "approved") throw new HttpsError("failed-precondition","Player account is not active.");
  const existing = await db.collection("questAssignments").where("playerUid","==",uid).where("questId","==",questId).limit(1).get();
  if (!existing.empty) return {ok:true, assignmentId:existing.docs[0].id, alreadyAssigned:true};
  const ref = await db.collection("questAssignments").add({
    playerUid:uid, playerId, questId, questTitle:quest.data()?.title, questDescription:quest.data()?.description,
    status:"not_started", createdAt:FieldValue.serverTimestamp(), createdBy:request.auth!.uid,
  });
  return {ok:true, assignmentId:ref.id, alreadyAssigned:false};
});

export const recordQuestSubmission = onCall(async (request) => {
  const player = await requirePlayer(request.auth?.uid);
  const assignmentId = clean(request.data?.assignmentId,150);
  const files = request.data?.files;
  if (!assignmentId || !Array.isArray(files) || !files.length || files.length > 20) throw new HttpsError("invalid-argument","Upload at least one evidence file.");
  const ref = db.collection("questAssignments").doc(assignmentId);
  const assignment = await ref.get();
  if (!assignment.exists || assignment.data()?.playerUid !== request.auth!.uid) throw new HttpsError("not-found","Quest assignment not found.");
  if (!["not_started","revision_required"].includes(String(assignment.data()?.status))) throw new HttpsError("failed-precondition","This quest is not currently accepting evidence.");
  const quest = await db.collection("quests").doc(String(assignment.data()?.questId)).get();
  const allowed = quest.data()?.allowedTypes as string[] | undefined;
  const maxFiles = Number(quest.data()?.maxFiles ?? 5);
  const maxSize = Number(quest.data()?.maxFileSizeBytes ?? 50 * 1024 * 1024);
  const valid = files.every((f: any) => f && typeof f.name === "string" && f.name.length <= 180 &&
    typeof f.path === "string" && f.path.startsWith("quest-submissions/" + request.auth!.uid + "/" + assignmentId + "/") &&
    typeof f.contentType === "string" && allowed?.includes(f.contentType) &&
    Number.isInteger(f.size) && f.size > 0 && f.size <= maxSize);
  if (!valid || files.length > maxFiles) throw new HttpsError("invalid-argument","One or more files do not meet this quest's upload requirements.");
  const existingFiles = Array.isArray(assignment.data()?.files) ? assignment.data()!.files : [];
  const merged = [...existingFiles, ...files.map((f: any) => ({name:f.name, path:f.path, contentType:f.contentType, size:f.size}))];
  if (merged.length > maxFiles) throw new HttpsError("resource-exhausted","This quest's maximum file count has been reached.");
  await ref.update({
    files:merged, status:"submitted", submittedAt:FieldValue.serverTimestamp(),
    lastSubmissionBy:request.auth!.uid, playerName:player.data()?.fullName ?? "",
    feedback:FieldValue.delete(),
  });
  return {ok:true, fileCount:merged.length};
});

export const reviewQuestSubmission = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const assignmentId = clean(request.data?.assignmentId,150);
  const decision = clean(request.data?.decision,30);
  const feedback = clean(request.data?.feedback,2000);
  if (!assignmentId || !["approved","revision_required","under_review"].includes(decision)) throw new HttpsError("invalid-argument","Invalid review decision.");
  const ref = db.collection("questAssignments").doc(assignmentId);
  const snap = await ref.get();
  if (!snap.exists || !["submitted","under_review","revision_required"].includes(String(snap.data()?.status))) throw new HttpsError("failed-precondition","This quest is not awaiting review.");
  if (decision === "revision_required" && !feedback) throw new HttpsError("invalid-argument","Feedback is required when requesting a revision.");
  await ref.update({
    status:decision, feedback:feedback || FieldValue.delete(),
    reviewedAt:FieldValue.serverTimestamp(), reviewedBy:request.auth!.uid,
  });
  return {ok:true};
});

export const createTeam = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const name = clean(request.data?.name,80);
  if (!name) throw new HttpsError("invalid-argument","Team name is required.");
  const ref = await db.collection("teams").add({
    name, memberUids:[], memberPlayerIds:[], suggestionsOpen:true,
    createdAt:FieldValue.serverTimestamp(), createdBy:request.auth!.uid,
  });
  return {ok:true, teamId:ref.id};
});

export const setTeamSuggestionsOpen = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const teamId = clean(request.data?.teamId,150);
  if (!teamId || typeof request.data?.open !== "boolean") throw new HttpsError("invalid-argument","Team and open/closed status are required.");
  await db.collection("teams").doc(teamId).update({suggestionsOpen:request.data.open,updatedAt:FieldValue.serverTimestamp()});
  return {ok:true};
});

export const assignPlayerToTeam = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const teamId = clean(request.data?.teamId,150);
  const playerId = clean(request.data?.playerId,20).toUpperCase();
  if (!teamId || !/^IGS-[A-Z0-9]{6}$/.test(playerId)) throw new HttpsError("invalid-argument","Team and valid Player ID are required.");
  const teamRef = db.collection("teams").doc(teamId);
  const team = await teamRef.get();
  if (!team.exists) throw new HttpsError("not-found","Team not found.");
  const idDoc = await db.collection("playerIds").doc(playerId).get();
  const registrationId = idDoc.data()?.registrationId;
  if (!idDoc.exists || typeof registrationId !== "string") throw new HttpsError("not-found","Player not found.");
  const uid = "player_" + (await import("node:crypto")).createHash("sha256").update(registrationId).digest("hex").slice(0,40);
  const playerRef = db.collection("players").doc(uid);
  const player = await playerRef.get();
  if (!player.exists || player.data()?.status !== "approved") throw new HttpsError("failed-precondition","Player is not active.");
  if (player.data()?.teamId) throw new HttpsError("failed-precondition","Player already belongs to a team. Remove or transfer them explicitly first.");
  await db.runTransaction(async tx => {
    tx.update(teamRef,{memberUids:FieldValue.arrayUnion(uid),memberPlayerIds:FieldValue.arrayUnion(playerId),memberNames:FieldValue.arrayUnion(player.data()?.fullName ?? playerId),updatedAt:FieldValue.serverTimestamp()});
    tx.update(playerRef,{teamId,teamName:team.data()?.name});
  });
  return {ok:true};
});

export const suggestTeammate = onCall(async (request) => {
  const player = await requirePlayer(request.auth?.uid);
  const teamId = clean(request.data?.teamId,150);
  const targetPlayerId = clean(request.data?.playerId,20).toUpperCase();
  if (!teamId || !/^IGS-[A-Z0-9]{6}$/.test(targetPlayerId)) throw new HttpsError("invalid-argument","Enter a valid Player ID.");
  const teamRef = db.collection("teams").doc(teamId);
  const team = await teamRef.get();
  if (!team.exists || team.data()?.suggestionsOpen !== true || player.data()?.teamId !== teamId) throw new HttpsError("failed-precondition","Team suggestions are not available.");
  const targetId = await db.collection("playerIds").doc(targetPlayerId).get();
  const registrationId = targetId.data()?.registrationId;
  if (!targetId.exists || typeof registrationId !== "string") throw new HttpsError("not-found","The player could not be found.");
  const uid = "player_" + (await import("node:crypto")).createHash("sha256").update(registrationId).digest("hex").slice(0,40);
  if (uid === request.auth!.uid) throw new HttpsError("invalid-argument","You cannot suggest yourself.");
  const target = await db.collection("players").doc(uid).get();
  if (!target.exists || target.data()?.status !== "approved" || target.data()?.teamId) throw new HttpsError("failed-precondition","This player is not eligible to join a team.");
  const duplicate = await db.collection("teamSuggestions").where("teamId","==",teamId).where("suggestedPlayerUid","==",uid).where("status","in",["pending_admin","awaiting_player"]).limit(1).get();
  if (!duplicate.empty) throw new HttpsError("already-exists","A request for this player is already pending.");
  const ref = await db.collection("teamSuggestions").add({
    teamId, teamName:team.data()?.name, suggestedByUid:request.auth!.uid,
    suggestedByPlayerId:player.data()?.playerId, suggestedPlayerUid:uid,
    suggestedPlayerId:targetPlayerId, status:"pending_admin",
    createdAt:FieldValue.serverTimestamp(),
  });
  return {ok:true,suggestionId:ref.id};
});

export const reviewTeamSuggestion = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const suggestionId = clean(request.data?.suggestionId,150);
  const decision = clean(request.data?.decision,20);
  if (!suggestionId || !["approve","reject"].includes(decision)) throw new HttpsError("invalid-argument","Invalid suggestion decision.");
  const ref = db.collection("teamSuggestions").doc(suggestionId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.status !== "pending_admin") throw new HttpsError("failed-precondition","Suggestion is no longer awaiting review.");
  if (decision === "reject") {
    await ref.update({status:"rejected_admin",reviewedAt:FieldValue.serverTimestamp(),reviewedBy:request.auth!.uid});
    return {ok:true};
  }
  const team = await db.collection("teams").doc(String(snap.data()?.teamId)).get();
  const target = await db.collection("players").doc(String(snap.data()?.suggestedPlayerUid)).get();
  if (!team.exists || team.data()?.suggestionsOpen !== true || !target.exists || target.data()?.teamId) throw new HttpsError("failed-precondition","Team or player is no longer eligible.");
  await ref.update({status:"awaiting_player",adminApprovedAt:FieldValue.serverTimestamp(),reviewedBy:request.auth!.uid});
  return {ok:true};
});

export const respondToTeamSuggestion = onCall(async (request) => {
  const decision = clean(request.data?.decision,20);
  const suggestionId = clean(request.data?.suggestionId,150);
  if (!suggestionId || !["accept","decline"].includes(decision)) throw new HttpsError("invalid-argument","Invalid response.");
  const ref = db.collection("teamSuggestions").doc(suggestionId);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.suggestedPlayerUid !== request.auth?.uid || snap.data()?.status !== "awaiting_player") throw new HttpsError("permission-denied","This request is not available to your account.");
    const data = snap.data()!;
    if (decision === "decline") {
      tx.update(ref,{status:"declined_player",respondedAt:FieldValue.serverTimestamp()});
      return;
    }
    const teamRef = db.collection("teams").doc(String(data.teamId));
    const playerRef = db.collection("players").doc(request.auth!.uid);
    const [team,player] = await Promise.all([tx.get(teamRef),tx.get(playerRef)]);
    if (!team.exists || team.data()?.suggestionsOpen !== true || player.data()?.teamId) throw new HttpsError("failed-precondition","The team is closed or you already belong to a team.");
    tx.update(teamRef,{memberUids:FieldValue.arrayUnion(request.auth!.uid),memberPlayerIds:FieldValue.arrayUnion(data.suggestedPlayerId),memberNames:FieldValue.arrayUnion(player.data()?.fullName ?? data.suggestedPlayerId),updatedAt:FieldValue.serverTimestamp()});
    tx.update(playerRef,{teamId:data.teamId,teamName:team.data()?.name});
    tx.update(ref,{status:"accepted",respondedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true};
});
