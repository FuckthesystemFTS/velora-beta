import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";
import { createReportCase } from "@/server/services/moderation-service";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);
  try {
    const user = await requireUser();
    assertRateLimit("report", `${user.id}:${getRequestIp(request)}`, { limit: 20, windowMs: 24 * 60 * 60 * 1000 });
    const report = await createReportCase(user.id, await request.json());
    return Response.json({ ok: true, report });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Segnalazione fallita");
  }
}
