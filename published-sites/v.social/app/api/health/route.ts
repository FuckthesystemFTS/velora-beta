export async function GET() {
  return Response.json({ ok: true, service: "V", timestamp: new Date().toISOString() });
}
