require("dotenv").config();

const { sendMail } = require("../src/services/mailService");

async function run() {
  const to = process.env.MAIL_TEST_TO || process.env.SMTP_USER;
  if (!to) {
    throw new Error("Imposta MAIL_TEST_TO o SMTP_USER per inviare la mail di prova");
  }

  const result = await sendMail({
    to,
    subject: "Test email HappyMeter",
    text: "Email di prova inviata da HappyMeter tramite SMTP Register.it.",
    html: "<p>Email di prova inviata da HappyMeter tramite SMTP Register.it.</p>"
  });

  if (result.skipped || result.failed) {
    throw new Error("Email non inviata. Controlla SMTP_HOST, SMTP_USER e SMTP_PASS");
  }

  console.log(`Email di prova inviata a ${to}`);
}

run().catch((error) => {
  console.error("[HappyMeter Mail Check]", error.message);
  process.exit(1);
});
