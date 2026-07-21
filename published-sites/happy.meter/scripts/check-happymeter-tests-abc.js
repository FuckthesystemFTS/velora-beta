async function assertOk(route, accepted = [200]) {
  const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
  const response = await fetch(`${baseUrl}${route}`, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "text/html" }
  });

  if (!accepted.includes(response.status)) {
    throw new Error(`${route} ha restituito ${response.status}`);
  }
}

async function assertPost(route, formData) {
  const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
  const body = new URLSearchParams();
  Object.entries(formData).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => body.append(key, item));
      return;
    }
    body.append(key, value);
  });
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html"
    },
    body: body.toString()
  });

  if (response.status === 500) {
    throw new Error(`${route} ha restituito 500`);
  }

  const text = await response.text();
  if (!text.includes("Happy Score")) {
    throw new Error(`${route} non mostra il risultato atteso`);
  }
}

async function run() {
  await assertOk("/test");
  await assertOk("/test/a");
  await assertOk("/test/b");
  await assertOk("/test/c");

  await assertPost("/test/a/submit", {
    happiness: "7",
    energy: "7",
    sleep: "6",
    stress: "3",
    social_relations: "7",
    gratitude: "8",
    meaning: "7",
    day_satisfaction: "7",
    summary_note: "Giornata semplice ma positiva"
  });

  await assertPost("/test/b/save", {
    missions: ["1", "2", "3"],
    reflection_text: "Ho scelto alcuni gesti semplici che mi hanno fatto bene oggi"
  });

  await assertPost("/test/c/save", {
    happiness: "7",
    energy: "7",
    stress: "3",
    social_relations: "8",
    gratitude: "8",
    missions: ["1", "2"],
    reflection_text: "Una giornata da chiudere con lucidita e riconoscenza"
  });

  console.log("Test A B C raggiungibili e salvabili senza errori 500");
}

run().catch((error) => {
  console.error("[HappyMeter Tests Check]", error.message);
  process.exit(1);
});
