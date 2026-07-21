const url = process.env.APP_URL ?? "http://localhost:3000";

async function main() {
  const response = await fetch(`${url}/api/health`);
  if (!response.ok) {
    throw new Error(`Healthcheck failed with ${response.status}`);
  }
  const payload = await response.json();
  console.log(payload);
}

void main();
