const { spawnSync } = require("node:child_process");
const path = require("node:path");

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8081";

if (
  !["127.0.0.1:9099", "localhost:9099"].includes(authHost) ||
  !["127.0.0.1:8081", "localhost:8081"].includes(firestoreHost)
) {
  console.error("Error: Seeding is restricted to the local Auth and Firestore emulators.");
  process.exit(1);
}

const env = {
  ...process.env,
  FIREBASE_AUTH_EMULATOR_HOST: authHost,
  FIRESTORE_EMULATOR_HOST: firestoreHost,
};

const scripts = ["seed-admin.cjs", "seed-registrations.cjs"];

for (const script of scripts) {
  console.log(`\nRunning ${script}...\n`);
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, script)],
    { env, stdio: "inherit" },
  );

  if (result.error) {
    console.error(`Could not run ${script}:`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nAll emulator seed scripts completed successfully.");
