require("dotenv").config();

const { startServer } = require("./src");

startServer().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});
