const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "immersive-game-studio";

// Safety: never allow this script to run against production.
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;

if (
  !authHost ||
  !firestoreHost ||
  !["127.0.0.1:9099", "localhost:9099"].includes(authHost) ||
  !["127.0.0.1:8081", "localhost:8081"].includes(firestoreHost)
) {
  console.error("Error: Local Auth and Firestore emulators must be running.");
  process.exit(1);
}

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const displayName = process.env.ADMIN_NAME || "Local Administrator";

if (!email || !password || password.length < 12) {
  console.error(
    "Set ADMIN_EMAIL and ADMIN_PASSWORD. Password must be at least 12 characters."
  );
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });

const auth = getAuth();
const db = getFirestore();

async function seedAdmin() {
  let user;

  // Find an existing account or create a new one.
  try {
    user = await auth.getUserByEmail(email);
    console.log("Existing Authentication account found:", email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw error;
    }

    user = await auth.createUser({
      email,
      password,
      displayName,
      emailVerified: true,
      disabled: false,
    });

    console.log("Created Authentication account:", email);
  }

  // Create or activate the corresponding admin document.
  const adminRef = db.collection("admins").doc(user.uid);
  const adminSnapshot = await adminRef.get();

  await adminRef.set({
    active: true,
    email,
    role: "admin",
    displayName,
    ...(adminSnapshot.exists
      ? {}
      : { createdAt: FieldValue.serverTimestamp() }),
  }, { merge: true });

  console.log("\nAdmin setup completed successfully.");
  console.log("Email:", email);
  console.log("UID:", user.uid);
  console.log("Firestore document: admins/" + user.uid);
  console.log("Active: true");
}

seedAdmin().catch((error) => {
  console.error("Admin setup failed:", error);
  process.exitCode = 1;
});