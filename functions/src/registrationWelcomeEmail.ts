import {createHash} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore, Timestamp} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {defineSecret} from "firebase-functions/params";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import nodemailer from "nodemailer";

if (getApps().length === 0) initializeApp();

const db = getFirestore();
const smtpUser = defineSecret("SMTP_USER");
const smtpAppPassword = defineSecret("SMTP_APP_PASSWORD");
const sender = "Immersive Games Studio <registeration@immersive-games.com>";
const senderAddress = "registeration@immersive-games.com";
const deliveryLeaseMs = 5 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const subject = "A Few Things to Know Before We Begin";

const plainText = `Hello,

Thank you for registering for the experience.

Before moving forward, we'd like to give you a better understanding of what you've signed up for and what you can expect.

WHAT KIND OF EXPERIENCE IS THIS?

This is not a conventional treasure hunt. It's a story-driven, multi-stage experience that combines mystery, investigation, problem-solving, and collaboration.

Throughout the experience, participants will encounter clues, uncover information, make decisions, and gradually piece together a larger story. Each stage brings new discoveries, and some answers may lead to more questions.

HOW DOES IT WORK?

The experience unfolds over several stages. Participants will be organized into teams, with each team consisting of seven players.

You won't receive the entire story or all the instructions at once. Information will be revealed progressively as the experience develops.

WHAT IS EXPECTED OF YOU?

- Be willing to participate, investigate, and think creatively.
- Collaborate and communicate with your fellow team members.
- Pay attention to details. Sometimes the smallest things matter.
- Follow the instructions and guidelines provided at each stage.
- Respect other participants and maintain the confidentiality of the experience.

You don't need to be an expert at puzzles or have any particular background. Curiosity, observation, and a willingness to engage are what matter most.

A FEW THINGS TO KEEP IN MIND

The experience is designed to be engaging and immersive, but your participation should also be comfortable and enjoyable. Practical requirements, schedules, and relevant participation conditions will be communicated before each stage.

Some details will remain confidential to preserve the experience for everyone.

WHAT'S NEXT?

Once your registration has been reviewed and approved, you'll receive your Player ID and instructions to activate your account. Your player account is the gateway to the participant portal, where you'll receive relevant information and updates.

We look forward to having you with us.

Immersive Games Studio
Participant Coordination Team
registeration@immersive-games.com`;

const html = `
  <div style="font-family:Arial,sans-serif;line-height:1.65;color:#242424;max-width:640px;margin:0 auto;padding:8px 16px">
    <p>Hello,</p>
    <p>Thank you for registering for the experience.</p>
    <p>Before moving forward, we'd like to give you a better understanding of what you've signed up for and what you can expect.</p>

    <h3>What kind of experience is this?</h3>
    <p>This is not a conventional treasure hunt. It's a story-driven, multi-stage experience that combines mystery, investigation, problem-solving, and collaboration.</p>
    <p>Throughout the experience, participants will encounter clues, uncover information, make decisions, and gradually piece together a larger story. Each stage brings new discoveries, and some answers may lead to more questions.</p>

    <h3>How does it work?</h3>
    <p>The experience unfolds over several stages. Participants will be organized into teams, with each team consisting of seven players.</p>
    <p>You won't receive the entire story or all the instructions at once. Information will be revealed progressively as the experience develops.</p>

    <h3>What is expected of you?</h3>
    <ul>
      <li>Be willing to participate, investigate, and think creatively.</li>
      <li>Collaborate and communicate with your fellow team members.</li>
      <li>Pay attention to details. Sometimes the smallest things matter.</li>
      <li>Follow the instructions and guidelines provided at each stage.</li>
      <li>Respect other participants and maintain the confidentiality of the experience.</li>
    </ul>
    <p>You don't need to be an expert at puzzles or have any particular background. Curiosity, observation, and a willingness to engage are what matter most.</p>

    <h3>A few things to keep in mind</h3>
    <p>The experience is designed to be engaging and immersive, but your participation should also be comfortable and enjoyable. Practical requirements, schedules, and relevant participation conditions will be communicated before each stage.</p>
    <p>Some details will remain confidential to preserve the experience for everyone.</p>

    <h3>What's next?</h3>
    <p>Once your registration has been reviewed and approved, you'll receive your Player ID and instructions to activate your account. Your player account is the gateway to the participant portal, where you'll receive relevant information and updates.</p>
    <p>We look forward to having you with us.</p>
    <p>Immersive Games Studio<br />Participant Coordination Team<br /><a href="mailto:registeration@immersive-games.com">registeration@immersive-games.com</a></p>
  </div>
`;

async function claimDelivery(registrationId: string, eventId: string): Promise<string | null> {
  const deliveryId = createHash("sha256")
    .update(registrationId + ":" + eventId)
    .digest("hex");
  const ref = db.collection("_registrationWelcomeEmailDeliveries").doc(deliveryId);
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
      registrationId,
      eventId,
      status: "sending",
      attemptCount: Number(current?.attemptCount ?? 0) + 1,
      leaseUntil: Timestamp.fromMillis(now + deliveryLeaseMs),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return true;
  });

  return claimed ? deliveryId : null;
}

/**
 * Sends the welcome and orientation email after a registration is created.
 */
export const sendRegistrationWelcomeEmail = onDocumentCreated(
  {
    document: "registrations/{registrationId}",
    region: "us-central1",
    secrets: [smtpUser, smtpAppPassword],
    retry: true,
  },
  async (event) => {
    const registration = event.data?.data();
    if (!registration || registration.status !== "new") return;

    const email = typeof registration.email === "string" ?
      registration.email.trim().toLowerCase() : "";
    if (!emailPattern.test(email)) {
      logger.warn("Registration welcome email skipped: invalid email address.", {
        registrationId: event.params.registrationId,
      });
      return;
    }

    if (process.env.FUNCTIONS_EMULATOR === "true") {
      logger.info("Emulator run: registration welcome email skipped.", {
        registrationId: event.params.registrationId,
        email,
      });
      return;
    }

    const deliveryId = await claimDelivery(event.params.registrationId, event.id);
    if (!deliveryId) return;

    const deliveryRef = db.collection("_registrationWelcomeEmailDeliveries").doc(deliveryId);
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

      await transporter.sendMail({
        from: sender,
        to: email,
        replyTo: senderAddress,
        subject,
        text: plainText,
        html,
      });

      await deliveryRef.update({
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
        leaseUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      logger.info("Registration welcome email sent.", {
        registrationId: event.params.registrationId,
      });
    } catch (error) {
      await deliveryRef.set({
        status: "failed",
        leaseUntil: FieldValue.delete(),
        lastError: error instanceof Error ?
          error.message.slice(0, 500) : "Email delivery failed.",
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      logger.error("Registration welcome email failed.", {
        registrationId: event.params.registrationId,
        error,
      });
      throw error;
    }
  },
);
