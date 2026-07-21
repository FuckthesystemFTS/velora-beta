async function run() {
  const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";

  const readResponse = await fetch(`${baseUrl}/api/chat/messages`, {
    headers: { Accept: "application/json" }
  });
  const readPayload = await readResponse.json();
  if (!readResponse.ok || !readPayload.ok) {
    throw new Error("La lettura della chat pubblica non funziona");
  }

  const sendResponse = await fetch(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ content: "Messaggio di test non autenticato" })
  });
  const sendPayload = await sendResponse.json();

  if (sendResponse.status !== 401 || !sendPayload.authRequired) {
    throw new Error("La protezione login della chat non restituisce authRequired");
  }

  console.log("Chat pubblica leggibile e popup login attivabile correttamente");
}

run().catch((error) => {
  console.error("[HappyMeter Chat Check]", error.message);
  process.exit(1);
});
