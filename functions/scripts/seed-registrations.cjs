const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { initializeApp } = require("firebase-admin/app");
const {
  getFirestore,
  Timestamp,
} = require("firebase-admin/firestore");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "immersive-game-studio";

// Refuse to run unless the Firestore emulator is explicitly configured.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "Error: FIRESTORE_EMULATOR_HOST is not set. Start the Firestore emulator first."
  );
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });

const db = getFirestore();

const registrationsFile = process.env.SEED_REGISTRATIONS_FILE || "seed-registrations.json";
const jsonPath = path.resolve(process.cwd(), registrationsFile);

async function seedRegistrations() {
  const registrations = JSON.parse(
    fs.readFileSync(jsonPath, "utf8")
  );

  if (!Array.isArray(registrations)) {
    throw new Error("The JSON file must contain an array of registrations.");
  }

  let inserted = 0;
  let skipped = 0;

  for (const registration of registrations) {
    if (!registration.fullName || !registration.email) {
      throw new Error("Every registration must have a fullName and email.");
    }

    // Stable ID: running the script again won't create duplicates.
    const hash = crypto
      .createHash("sha256")
      .update(registration.email.trim().toLowerCase())
      .digest("hex")
      .slice(0, 20);

    const documentId = `seed_${hash}`;
    const registrationRef = db
      .collection("registrations")
      .doc(documentId);

    try {
      await registrationRef.create({
        ...registration,
        email: registration.email.trim().toLowerCase(),
        createdAt: Timestamp.now(),
        status: "new",
      });

      inserted++;
      console.log(`Added: ${registration.fullName}`);
    } catch (error) {
      if (error.code === 6 || error.code === "already-exists") {
        skipped++;
        console.log(`Skipped existing registration: ${registration.email}`);
      } else {
        throw error;
      }
    }
  }

  console.log("\nImport completed.");
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped: ${skipped}`);
}

seedRegistrations()
  .catch((error) => {
    console.error("Import failed:", error);
    process.exitCode = 1;
  });