import {createHash, randomInt} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {logger, setGlobalOptions} from "firebase-functions";
import {defineSecret} from "firebase-functions/params";
import {HttpsError, onCall, onRequest} from "firebase-functions/v2/https";
import nodemailer from "nodemailer";

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();
const smtpUser = defineSecret("SMTP_USER");
const smtpAppPassword = defineSecret("SMTP_APP_PASSWORD");

setGlobalOptions({maxInstances: 3});

const allowedOrigins = [
  "https://immersive-game-studio.web.app",
  "https://immersive-game-studio.firebaseapp.com",
  "https://immersive-games.com",
  "https://www.immersive-games.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const areas = [
  "Anmore",
  "Belcarra",
  "Bowen Island",
  "Burnaby",
  "Coquitlam",
  "Delta",
  "City of Langley",
  "Township of Langley",
  "Lions Bay",
  "Maple Ridge",
  "Metro Vancouver A (Electoral Area A)",
  "New Westminster",
  "City of North Vancouver",
  "District of North Vancouver",
  "Pitt Meadows",
  "Port Coquitlam",
  "Port Moody",
  "Richmond",
  "Surrey",
  "Tsawwassen",
  "Vancouver",
  "West Vancouver",
  "White Rock",
] as const;

const puzzleOptions = [
  "Try a different approach",
  "Look at the clues again to see if I missed anything",
  "Discuss it with the team",
  "Focus harder and keep trying",
  "Look for a hint",
] as const;

const uncertaintyOptions = [
  "I enjoy figuring it out",
  "I find it exciting, especially with a team",
  "I prefer having some direction",
  "I find it frustrating",
] as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const text = (value: unknown): value is string => typeof value === "string";
const isOneOf = <T extends readonly string[]>(
  value: unknown,
  options: T,
): value is T[number] => text(value) && options.includes(value as T[number]);

type RegistrationPayload = {
  ageConfirmed: "Yes" | "No";
  fullName: string;
  email: string;
  travelMetroVancouver: "Yes" | "No";
  area: (typeof areas)[number];
  commitToSessions: "Yes" | "No" | "Not sure";
  availability: "Weekends" | "Long weekends" | "Both" | "Neither";
  motivation: string;
  puzzleApproaches: (typeof puzzleOptions)[number][];
  uncertaintyReaction: (typeof uncertaintyOptions)[number];
  comfortableRecording: "Yes" | "No";
  comfortableExperience: "Yes" | "No";
};

/**
 * Validates an untrusted registration request body.
 * @param {unknown} body - The request body to validate.
 * @return {{ok: true, value: RegistrationPayload} | {ok: false}}
 * The validated payload or a validation failure.
 */
function validatePayload(body: unknown):
  {ok: true; value: RegistrationPayload} | {ok: false} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {ok: false};
  }

  const data = body as Record<string, unknown>;

  if (
    !isOneOf(data.ageConfirmed, ["Yes", "No"] as const) ||
    !text(data.fullName) ||
    !text(data.email) ||
    !isOneOf(data.travelMetroVancouver, ["Yes", "No"] as const) ||
    !isOneOf(data.area, areas) ||
    !isOneOf(data.commitToSessions, ["Yes", "No", "Not sure"] as const) ||
    !isOneOf(data.availability, [
      "Weekends",
      "Long weekends",
      "Both",
      "Neither",
    ] as const) ||
    !text(data.motivation) ||
    !Array.isArray(data.puzzleApproaches) ||
    !isOneOf(data.uncertaintyReaction, uncertaintyOptions) ||
    !isOneOf(data.comfortableRecording, ["Yes", "No"] as const) ||
    !isOneOf(data.comfortableExperience, ["Yes", "No"] as const) ||
    !text(data.website)
  ) {
    return {ok: false};
  }

  const fullName = data.fullName.trim();
  const email = data.email.trim().toLowerCase();
  const motivation = data.motivation.trim();

  if (
    fullName.length < 1 ||
    fullName.length > 120 ||
    email.length > 254 ||
    !emailPattern.test(email) ||
    motivation.length < 1 ||
    motivation.length > 2000 ||
    data.puzzleApproaches.length < 1 ||
    data.puzzleApproaches.length > puzzleOptions.length ||
    !data.puzzleApproaches.every((option) => isOneOf(option, puzzleOptions)) ||
    new Set(data.puzzleApproaches).size !== data.puzzleApproaches.length
  ) {
    return {ok: false};
  }

  return {
    ok: true,
    value: {
      ageConfirmed: data.ageConfirmed,
      fullName,
      email,
      travelMetroVancouver: data.travelMetroVancouver,
      area: data.area,
      commitToSessions: data.commitToSessions,
      availability: data.availability,
      motivation,
      puzzleApproaches: data.puzzleApproaches,
      uncertaintyReaction: data.uncertaintyReaction,
      comfortableRecording: data.comfortableRecording,
      comfortableExperience: data.comfortableExperience,
    },
  };
}

/**
 * Checks and updates the hourly submission limit for an IP address.
 * @param {string} ip - The request IP address to check.
 * @return {Promise<boolean>} Whether the address has exceeded its limit.
 */
async function isRateLimited(ip: string): Promise<boolean> {
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const rateLimitRef = db.collection("_registrationRateLimits").doc(ipHash);
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const maxSubmissions = 3;

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const data = snapshot.data();
    const windowStartedAt = data?.windowStartedAt as number | undefined;
    const count = data?.count as number | undefined;

    if (
      typeof windowStartedAt === "number" &&
      now - windowStartedAt < windowMs &&
      typeof count === "number" &&
      count >= maxSubmissions
    ) {
      return true;
    }

    const withinWindow =
      typeof windowStartedAt === "number" &&
      now - windowStartedAt < windowMs;

    transaction.set(rateLimitRef, {
      windowStartedAt: withinWindow && typeof windowStartedAt === "number" ?
        windowStartedAt : now,
      count: withinWindow && typeof count === "number" ? count + 1 : 1,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return false;
  });
}

export const submitRegistration = onRequest(
  {
    maxInstances: 3,
  },
  async (request, response) => {
    const origin = request.get("origin");

    // Enforce the origin allowlist before handling browser preflight requests.
    if (origin && !allowedOrigins.includes(origin)) {
      response.status(403).json({error: "Origin not allowed."});
      return;
    }

    if (origin) {
      response.set("Access-Control-Allow-Origin", origin);
      response.set("Vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.set("Access-Control-Allow-Headers", "Content-Type");
      response.status(204).send();
      return;
    }

    if (request.method !== "POST") {
      response.set("Allow", "POST, OPTIONS");
      response.status(405).json({error: "Method not allowed."});
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;

    // Quietly discard bot submissions that fill in the hidden honeypot field.
    if (body && text(body.website) && body.website.trim() !== "") {
      response.status(204).send();
      return;
    }

    const validation = validatePayload(body);
    if (!validation.ok) {
      response.status(400).json({
        error: "Please check your answers and try again.",
      });
      return;
    }

    const ip = request.ip || "unknown";
    try {
      if (await isRateLimited(ip)) {
        response.status(429).json({
          error: "Too many attempts. Please try again later.",
        });
        return;
      }

      await db.collection("registrations").add({
        ...validation.value,
        createdAt: FieldValue.serverTimestamp(),
        status: "new",
      });

      response.status(201).json({ok: true});
    } catch (error) {
      logger.error("Registration submission failed.", error);
      response.status(500).json({
        error: "We could not submit your registration.",
      });
    }
  },
);


type RegistrationStatus = "new" | "under_review" | "approved" | "rejected" | "contacted";

/**
 * Updates an application status after verifying the caller is an active administrator.
 * All authorization and mutation logic stays on the trusted backend.
 */
export const updateRegistrationStatus = onCall(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    const adminSnapshot = await db.collection("admins").doc(request.auth.uid).get();
    if (!adminSnapshot.exists || adminSnapshot.data()?.active !== true) {
      throw new HttpsError("permission-denied", "Administrator access is required.");
    }

    const data = request.data as {registrationId?: unknown; status?: unknown};
    const registrationId = typeof data?.registrationId === "string" ?
      data.registrationId.trim() : "";
    const allowedStatuses: RegistrationStatus[] = [
      "new", "under_review", "rejected", "contacted",
    ];
    if (
      !registrationId ||
      registrationId.length > 150 ||
      typeof data?.status !== "string" ||
      !allowedStatuses.includes(data.status as RegistrationStatus)
    ) {
      throw new HttpsError("invalid-argument", "A valid registration and status are required.");
    }

    const status = data.status as RegistrationStatus;
    const registrationRef = db.collection("registrations").doc(registrationId);
    await db.runTransaction(async (transaction) => {
      const registration = await transaction.get(registrationRef);
      if (!registration.exists) {
        throw new HttpsError("not-found", "The application could not be found.");
      }
      if (registration.data()?.status === "approved") {
        throw new HttpsError("failed-precondition", "An approved application cannot be moved back to another status.");
      }
      transaction.update(registrationRef, {
        status,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: request.auth!.uid,
      });
    });

    logger.info("Registration status updated.", {
      registrationId,
      status,
      administratorUid: request.auth.uid,
    });
    return {ok: true};
  },
);


/**
 * Approves an applicant, creates its player account, and emails the password setup link.
 * The Player ID and player record are persisted before any email is sent.
 * Calling this again safely reuses the same account and Player ID and resends the email.
 */
export const approveRegistration = onCall(
  {secrets: [smtpUser, smtpAppPassword]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    const adminSnapshot = await db.collection("admins").doc(request.auth.uid).get();
    if (!adminSnapshot.exists || adminSnapshot.data()?.active !== true) {
      throw new HttpsError("permission-denied", "Administrator access is required.");
    }

    const data = request.data as {registrationId?: unknown};
    const registrationId = typeof data?.registrationId === "string" ?
      data.registrationId.trim() : "";
    if (!registrationId || registrationId.length > 150) {
      throw new HttpsError("invalid-argument", "A valid registration is required.");
    }

    const registrationRef = db.collection("registrations").doc(registrationId);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    const approval = await db.runTransaction(async (transaction) => {
      const registration = await transaction.get(registrationRef);
      if (!registration.exists) {
        throw new HttpsError("not-found", "The application could not be found.");
      }

      const current = registration.data()!;
      const email = typeof current.email === "string" ?
        current.email.trim().toLowerCase() : "";
      const fullName = typeof current.fullName === "string" ?
        current.fullName.trim() : "";

      if (!emailPattern.test(email) || !fullName) {
        throw new HttpsError("failed-precondition", "The application is missing a valid name or email address.");
      }
      if (current.status === "rejected") {
        throw new HttpsError("failed-precondition", "A rejected application cannot be approved.");
      }

      if (current.status === "approved" && typeof current.playerId === "string") {
        return {
          playerId: current.playerId,
          alreadyApproved: true,
          email,
          fullName,
        };
      }

      let playerId = "";
      let playerIdRef = db.collection("playerIds").doc();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        let suffix = "";
        for (let index = 0; index < 6; index += 1) {
          suffix += alphabet[randomInt(alphabet.length)];
        }
        const candidate = `IGS-${suffix}`;
        const candidateRef = db.collection("playerIds").doc(candidate);
        const existing = await transaction.get(candidateRef);
        if (!existing.exists) {
          playerId = candidate;
          playerIdRef = candidateRef;
          break;
        }
      }

      if (!playerId) {
        throw new HttpsError("resource-exhausted", "A unique Player ID could not be generated. Please try again.");
      }

      transaction.set(playerIdRef, {
        registrationId,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(registrationRef, {
        status: "approved",
        playerId,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: request.auth!.uid,
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: request.auth!.uid,
      });

      return {playerId, alreadyApproved: false, email, fullName};
    });

    try {
      // A deterministic UID makes retries safe if a function stops after account creation.
      const uid = `player_${createHash("sha256").update(registrationId).digest("hex").slice(0, 40)}`;
      const playerAuth = getAuth();
      let playerUser;
      try {
        playerUser = await playerAuth.getUser(uid);
      } catch (error) {
        if ((error as {code?: string}).code !== "auth/user-not-found") {
          throw error;
        }
        playerUser = await playerAuth.createUser({
          uid,
          email: approval.email,
          displayName: approval.fullName,
          emailVerified: false,
          disabled: false,
        });
      }

      if (playerUser.email?.toLowerCase() !== approval.email) {
        throw new Error("The player account email does not match the application email.");
      }

      const playerRef = db.collection("players").doc(uid);
      const playerSnapshot = await playerRef.get();
      if (playerSnapshot.exists && playerSnapshot.data()?.registrationId !== registrationId) {
        throw new Error("The player account is linked to a different application.");
      }
      await playerRef.set({
        uid,
        playerId: approval.playerId,
        email: approval.email,
        fullName: approval.fullName,
        registrationId,
        status: "approved",
        createdAt: playerSnapshot.exists ?
          playerSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp() :
          FieldValue.serverTimestamp(),
        approvedAt: FieldValue.serverTimestamp(),
      }, {merge: true});

      const portalUrl = "https://immersive-games.com/#/player";
      const passwordSetupLink = await playerAuth.generatePasswordResetLink(
        approval.email,
        {url: portalUrl, handleCodeInApp: false},
      );

      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: smtpUser.value(),
          pass: smtpAppPassword.value(),
        },
      });

      const html = `
        <p>Congratulations!</p>
        <p>Your application to Immersive Games Studio has been approved.</p>
        <p>This is the first step in the process. There are a few more stages ahead, and we'll guide you through each one.</p>
        <h3>Your Player ID</h3>
        <p><strong>${approval.playerId}</strong></p>
        <p>Please keep your Player ID safe. It will be used to identify you throughout the process.</p>
        <h3>Access Your Player Portal</h3>
        <p>You can now set your password and access your personal player portal using the link below:</p>
        <p><a href="${passwordSetupLink}">Set Your Password &amp; Access Your Portal</a></p>
        <p>Your portal will be your personal space for receiving information and completing the upcoming steps.</p>
        <h3>What Happens Next?</h3>
        <p>In the next stage, we'll send you another email with information about the interview process, including what to expect and how to prepare.</p>
        <p>We'll guide you through each step and provide all the necessary details along the way.</p>
        <h3>Choosing Your Teammates</h3>
        <p>If you are selected to move forward, you'll have the opportunity to choose your teammates.</p>
        <p>Your invited teammates will go through the same approval and interview process. They will only become part of your team if they also approve the invitation to join.</p>
        <p>For now, congratulations on passing this first step. We'll be in touch with further instructions.</p>
        <p>Immersive Games Studio</p>
      `;
      const plainText = `Congratulations!

Your application to Immersive Games Studio has been approved.

This is the first step in the process. There are a few more stages ahead, and we'll guide you through each one.

Your Player ID
${approval.playerId}
Please keep your Player ID safe. It will be used to identify you throughout the process.

Access Your Player Portal
You can now set your password and access your personal player portal using the link below:
${passwordSetupLink}
Your portal will be your personal space for receiving information and completing the upcoming steps.

What Happens Next?
In the next stage, we'll send you another email with information about the interview process, including what to expect and how to prepare.
We'll guide you through each step and provide all the necessary details along the way.

Choosing Your Teammates
If you are selected to move forward, you'll have the opportunity to choose your teammates.
Your invited teammates will go through the same approval and interview process. They will only become part of your team if they also approve the invitation to join.

For now, congratulations on passing this first step. We'll be in touch with further instructions.

Immersive Games Studio`;

      await transporter.sendMail({
        from: `Immersive Games Studio <${smtpUser.value()}>`,
        to: approval.email,
        subject: "Your Application Has Been Approved",
        text: plainText,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#242424;max-width:600px;margin:auto">${html}</div>`,
      });

      logger.info("Approval email sent.", {
        registrationId,
        playerId: approval.playerId,
        alreadyApproved: approval.alreadyApproved,
      });
      return {
        ok: true,
        playerId: approval.playerId,
        alreadyApproved: approval.alreadyApproved,
        emailSent: true,
      };
    } catch (error) {
      logger.error("Applicant approved, but player account setup or approval email failed.", {
        registrationId,
        playerId: approval.playerId,
        error,
      });
      return {
        ok: true,
        playerId: approval.playerId,
        alreadyApproved: approval.alreadyApproved,
        emailSent: false,
      };
    }
  },
);
