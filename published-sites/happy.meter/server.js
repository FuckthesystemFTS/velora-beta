require("dotenv").config({ quiet: true });

const { start } = require("./src");

start().catch((error) => {
  console.error("Failed to start HappyMeter:", error);
  process.exit(1);
});
