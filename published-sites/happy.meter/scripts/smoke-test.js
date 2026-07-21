const routes = ["/", "/welcome", "/welcome/2", "/splash", "/login", "/register", "/forgot-password", "/reset-password/not-valid", "/test", "/test/a", "/test/b", "/test/c", "/daily-test", "/privacy", "/cookie", "/terms", "/health", "/app", "/app/today"];

async function run() {
  const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
  let failures = 0;

  for (const route of routes) {
    const response = await fetch(`${baseUrl}${route}`, {
      redirect: "manual"
    });

    const allowed = [200, 302];
    const ok = allowed.includes(response.status) && response.status !== 500;
    console.log(`${ok ? "OK" : "FAIL"} ${route} -> ${response.status}`);

    if (!ok) {
      failures += 1;
    }
  }

  if (failures) {
    throw new Error(`Smoke test fallito su ${failures} route`);
  }

  console.log("Smoke test completato senza errori 500");
}

run().catch((error) => {
  console.error("[HappyMeter Smoke]", error.message);
  process.exit(1);
});
