import {createHash} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {logger, setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

setGlobalOptions({maxInstances: 3});

const allowedOrigins = [
  "https://immersive-game-studio.web.app",
  "https://immersive-game-studio.firebaseapp.com",
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
  "Try different approach",
  "Look at the clues again",
  "Discuss with team",
  "Focus harder",
  "Look for hint",
] as const;

const uncertaintyOptions = [
  "Enjoy figuring it out",
  "Exciting especially with team",
  "Prefer direction",
  "Frustrating",
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
    cors: allowedOrigins,
    maxInstances: 3,
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST");
      response.status(405).json({error: "Method not allowed."});
      return;
    }

    const origin = request.get("origin");
    if (origin && !allowedOrigins.includes(origin)) {
      response.status(403).json({error: "Origin not allowed."});
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
