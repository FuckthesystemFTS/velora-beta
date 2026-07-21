import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";
import { createInvite, getInviteSummaryForUser } from "@/server/services/invite-service";

export async function GET() {
  try {
    const user = await requireUser();
    const summary = await getInviteSummaryForUser(user.id);
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Inviti non disponibili");
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    const ip = getRequestIp(request);
    assertRateLimit("invite:create", `${user.id}:${ip}`, { limit: 20, windowMs: 24 * 60 * 60 * 1000 });
    const body = (await request.json().catch(() => ({}))) as { email?: string; forceNew?: boolean };

    if (body.email) {
      assertRateLimit("invite:email", `${user.id}:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    }

    const invite = await createInvite(user.id, body.email, body.forceNew === true);
    const summary = await getInviteSummaryForUser(user.id);
    return Response.json({ ok: true, invite, summary });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invito non creato");
  }
}
