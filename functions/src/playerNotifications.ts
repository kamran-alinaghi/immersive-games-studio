/* eslint-disable max-len, require-jsdoc, @typescript-eslint/no-explicit-any */
import {createHash} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore, Timestamp} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {defineSecret} from "firebase-functions/params";
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import nodemailer from "nodemailer";

if (getApps().length === 0) initializeApp();

const db = getFirestore();
const smtpUser = defineSecret("SMTP_USER");
const smtpAppPassword = defineSecret("SMTP_APP_PASSWORD");
const dashboardUrl = "https://immersive-games.com/#/player";
const emailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;
const deliveryLeaseMs = 5 * 60 * 1000;

type PlayerEmail = {
  subject: string;
  heading: string;
  message: string;
  details?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function getPlayerContact(uid: string) {
  const playerSnapshot = await db.collection("players").doc(uid).get();
  if (!playerSnapshot.exists || playerSnapshot.data()?.status !== "approved") {
    logger.warn("Player notification skipped: active player record not found.", {uid});
    return null;
  }

  const registrationId = playerSnapshot.data()?.registrationId;
  if (typeof registrationId !== "string" || !registrationId) {
    logger.warn("Player notification skipped: registration link not found.", {uid});
    return null;
  }

  const registrationSnapshot = await db.collection("registrations").doc(registrationId).get();
  const registration = registrationSnapshot.data();
  const email = typeof registration?.email === "string" ?
    registration.email.trim().toLowerCase() : "";
  if (!registrationSnapshot.exists || !emailPattern.test(email) ||
      registration?.status !== "approved") {
    logger.warn("Player notification skipped: approved registration email not found.", {uid});
    return null;
  }

  const fullName = typeof playerSnapshot.data()?.fullName === "string" ?
    playerSnapshot.data()!.fullName.trim() : "";
  return {email, fullName};
}

/**
 * Claims a delivery record before sending. The deterministic key prevents normal
 * Firestore event retries from sending the same notification more than once.
 * An expired lease can be reclaimed if a function instance stopped unexpectedly.
 */
async function claimDelivery(eventId: string, uid: string): Promise<string | null> {
  const deliveryId = createHash("sha256")
    .update(eventId + ":" + uid)
    .digest("hex");
  const ref = db.collection("_playerEmailDeliveries").doc(deliveryId);
  const now = Date.now();

  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    if (current?.status === "sent") return false;

    const leaseUntil = current?.leaseUntil;
    if (current?.status === "sending" &&
        leaseUntil instanceof Timestamp &&
        leaseUntil.toMillis() > now) {
      return false;
    }

    transaction.set(ref, {
      eventId,
      playerUid: uid,
      status: "sending",
      attemptCount: Number(current?.attemptCount ?? 0) + 1,
      leaseUntil: Timestamp.fromMillis(now + deliveryLeaseMs),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return true;
  });

  return claimed ? deliveryId : null;
}

async function sendPlayerEmail(
  uid: string,
  eventId: string,
  notification: PlayerEmail,
): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    logger.info("Emulator run: player notification email skipped.", {
      uid,
      eventId,
      subject: notification.subject,
    });
    return;
  }

  const contact = await getPlayerContact(uid);
  if (!contact) return;

  const deliveryId = await claimDelivery(eventId, uid);
  if (!deliveryId) return;

  const deliveryRef = db.collection("_playerEmailDeliveries").doc(deliveryId);
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: smtpUser.value(),
        pass: smtpAppPassword.value(),
      },
    });

    const greeting = contact.fullName ?
      "Hello " + escapeHtml(contact.fullName) + "," : "Hello,";
    const detailsHtml = notification.details ?
      '<p style="padding:12px;background:#f4f4f4;border-radius:6px">' +
        escapeHtml(notification.details) + "</p>" : "";
    const html = [
      '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#242424;max-width:600px;margin:auto">',
      "<p>" + greeting + "</p>",
      "<h2>" + escapeHtml(notification.heading) + "</h2>",
      "<p>" + escapeHtml(notification.message) + "</p>",
      detailsHtml,
      '<p><a href="' + dashboardUrl + '">Open your player dashboard</a></p>',
      "<p>Immersive Games Studio</p>",
      "</div>",
    ].join("");

    const textBody = [
      contact.fullName ? "Hello " + contact.fullName + "," : "Hello,",
      "",
      notification.heading,
      notification.message,
      notification.details ?? "",
      "",
      "Open your player dashboard: " + dashboardUrl,
      "",
      "Immersive Games Studio",
    ].filter(Boolean).join("\n");

    await transporter.sendMail({
      from: "Immersive Games Studio <" + smtpUser.value() + ">",
      to: contact.email,
      subject: notification.subject,
      text: textBody,
      html,
    });

    await deliveryRef.update({
      status: "sent",
      sentAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info("Player notification email sent.", {
      uid,
      eventId,
      subject: notification.subject,
    });
  } catch (error) {
    await deliveryRef.set({
      status: "failed",
      leaseUntil: FieldValue.delete(),
      lastError: error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed.",
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    logger.error("Player notification email failed.", {uid, eventId, error});
    throw error;
  }
}

function changed(before: any, after: any, field: string): boolean {
  return JSON.stringify(before?.[field] ?? null) !==
    JSON.stringify(after?.[field] ?? null);
}

export const notifyOnQuestAssignmentCreated = onDocumentCreated(
  {
    document: "questAssignments/{assignmentId}",
    region: "us-central1",
    secrets: [smtpUser, smtpAppPassword],
    retry: true,
  },
  async (event) => {
    const assignment = event.data?.data();
    if (!assignment || typeof assignment.playerUid !== "string") return;
    const questTitle = typeof assignment.questTitle === "string" ?
      assignment.questTitle : "a new quest";
    await sendPlayerEmail(assignment.playerUid, event.id, {
      subject: "A New Quest Has Been Assigned",
      heading: "You have a new quest",
      message: "A new quest has been assigned to your player dashboard.",
      details: questTitle,
    });
  },
);

export const notifyOnQuestAssignmentUpdated = onDocumentUpdated(
  {
    document: "questAssignments/{assignmentId}",
    region: "us-central1",
    secrets: [smtpUser, smtpAppPassword],
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || typeof after.playerUid !== "string") return;

    const statusChanged = before.status !== after.status;
    const filesChanged = changed(before, after, "files");
    const questTitle = typeof after.questTitle === "string" ?
      after.questTitle : "your quest";

    if (after.status === "submitted" &&
        (statusChanged || filesChanged)) {
      await sendPlayerEmail(after.playerUid, event.id, {
        subject: "Your Evidence Has Been Received",
        heading: "Evidence received",
        message: "Your evidence for the following quest has been received and is awaiting review.",
        details: questTitle,
      });
      return;
    }

    if (!statusChanged) return;

    const notifications: Record<string, PlayerEmail> = {
      under_review: {
        subject: "Your Quest Is Under Review",
        heading: "Your submission is under review",
        message: "Your submitted evidence is now being reviewed.",
        details: questTitle,
      },
      approved: {
        subject: "Your Quest Submission Has Been Approved",
        heading: "Quest submission approved",
        message: "Your evidence has been reviewed and approved. You can view the updated status in your player dashboard.",
        details: questTitle,
      },
      revision_required: {
        subject: "A Revision Is Needed for Your Quest",
        heading: "Your quest needs a revision",
        message: "Your submission has been reviewed. Please sign in to your player dashboard to read the feedback and submit a revision.",
        details: typeof after.feedback === "string" ? after.feedback : questTitle,
      },
    };
    const notification = notifications[String(after.status)];
    if (notification) {
      await sendPlayerEmail(after.playerUid, event.id, notification);
    }
  },
);

export const notifyOnQuestUpdated = onDocumentUpdated(
  {
    document: "quests/{questId}",
    region: "us-central1",
    secrets: [smtpUser, smtpAppPassword],
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const activeChanged = before.active !== after.active;
    const titleChanged = before.title !== after.title;
    const descriptionChanged = before.description !== after.description;
    if (!activeChanged && !titleChanged && !descriptionChanged) return;

    const questId = event.params.questId;
    const assignments = await db.collection("questAssignments")
      .where("questId", "==", questId).get();
    const playerUids = [...new Set(assignments.docs
      .map((document) => document.data().playerUid)
      .filter((uid): uid is string => typeof uid === "string"))];

    const title = typeof after.title === "string" ? after.title : "your quest";
    const notification: PlayerEmail = activeChanged && after.active === false ? {
      subject: "A Quest Has Been Updated",
      heading: "Quest status updated",
      message: "A quest assigned to you is no longer active. Sign in to your dashboard to review its current status.",
      details: title,
    } : {
      subject: "Your Quest Details Have Been Updated",
      heading: "Quest details updated",
      message: "The instructions or details for a quest assigned to you have changed. Please review the latest information in your player dashboard.",
      details: title,
    };

    await Promise.all(playerUids.map((uid) =>
      sendPlayerEmail(uid, event.id, notification)));
  },
);

export const notifyOnTeamMembershipUpdated = onDocumentUpdated(
  {
    document: "teams/{teamId}",
    region: "us-central1",
    secrets: [smtpUser, smtpAppPassword],
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const oldMembers = Array.isArray(before.memberUids) ? before.memberUids : [];
    const newMembers = Array.isArray(after.memberUids) ? after.memberUids : [];
    const addedMembers = newMembers.filter((uid: unknown) =>
      typeof uid === "string" && !oldMembers.includes(uid));
    if (!addedMembers.length) return;

    const teamName = typeof after.name === "string" ? after.name : "your team";
    const existingMembers = oldMembers.filter((uid: unknown): uid is string =>
      typeof uid === "string" && !addedMembers.includes(uid));

    await Promise.all(addedMembers.map((uid: string) =>
      sendPlayerEmail(uid, event.id + ":joined:" + uid, {
        subject: "You've Joined a Team",
        heading: "You've been added to a team",
        message: "You are now a member of the following team. Sign in to your player dashboard to see your team information.",
        details: teamName,
      })));

    await Promise.all(existingMembers.map((uid: string) =>
      sendPlayerEmail(uid, event.id + ":teammate:" + uid, {
        subject: "A New Teammate Has Joined",
        heading: "A new teammate has joined",
        message: "A new player has joined your team. Sign in to your player dashboard to see the updated team.",
        details: teamName,
      })));
  },
);

export const notifyOnTeamSuggestionCreated = onDocumentCreated(
  {
    document: "teamSuggestions/{suggestionId}",
    region: "us-central1",
    secrets: [smtpUser, smtpAppPassword],
    retry: true,
  },
  async (event) => {
    const suggestion = event.data?.data();
    if (!suggestion || typeof suggestion.suggestedByUid !== "string") return;
    await sendPlayerEmail(suggestion.suggestedByUid, event.id, {
      subject: "Your Teammate Suggestion Was Received",
      heading: "Suggestion received",
      message: "Your teammate suggestion has been submitted and is awaiting administrator review.",
      details: typeof suggestion.suggestedPlayerId === "string" ?
        "Player ID: " + suggestion.suggestedPlayerId : undefined,
    });
  },
);

export const notifyOnTeamSuggestionUpdated = onDocumentUpdated(
  {
    document: "teamSuggestions/{suggestionId}",
    region: "us-central1",
    secrets: [smtpUser, smtpAppPassword],
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status) return;

    const teamName = typeof after.teamName === "string" ? after.teamName : "the team";
    const playerA = typeof after.suggestedByUid === "string" ?
      after.suggestedByUid : "";
    const playerB = typeof after.suggestedPlayerUid === "string" ?
      after.suggestedPlayerUid : "";

    if (after.status === "awaiting_player") {
      const tasks: Promise<void>[] = [];
      if (playerA) {
        tasks.push(sendPlayerEmail(playerA, event.id + ":admin-approved", {
          subject: "Your Teammate Suggestion Was Approved",
          heading: "Suggestion approved",
          message: "Your suggestion passed administrator review and is now awaiting the other player's response.",
          details: teamName,
        }));
      }
      if (playerB) {
        tasks.push(sendPlayerEmail(playerB, event.id + ":invitation", {
          subject: "You've Been Invited to Join a Team",
          heading: "You have a team invitation",
          message: "A player has suggested you as a teammate, and the suggestion has been approved for your response. Sign in to your player dashboard to accept or decline.",
          details: teamName,
        }));
      }
      await Promise.all(tasks);
      return;
    }

    if (playerA && after.status === "rejected_admin") {
      await sendPlayerEmail(playerA, event.id, {
        subject: "Your Teammate Suggestion Was Not Approved",
        heading: "Suggestion not approved",
        message: "Your teammate suggestion was not approved by the administrator.",
        details: teamName,
      });
    } else if (playerA && after.status === "declined_player") {
      await sendPlayerEmail(playerA, event.id, {
        subject: "Your Team Invitation Was Declined",
        heading: "Invitation declined",
        message: "The player you invited has declined the team invitation.",
        details: teamName,
      });
    } else if (playerA && after.status === "accepted") {
      await sendPlayerEmail(playerA, event.id, {
        subject: "Your Teammate Invitation Was Accepted",
        heading: "Invitation accepted",
        message: "The player you suggested has accepted the invitation and joined your team.",
        details: teamName,
      });
    }
  },
);
