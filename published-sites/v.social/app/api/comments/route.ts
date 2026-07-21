import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";
import { createComment } from "@/server/services/post-service";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    assertRateLimit("comment", `${user.id}:${getRequestIp(request)}`, { limit: 50, windowMs: 60 * 60 * 1000 });
    const comment = await createComment(user.id, await request.json());
    return Response.json({ ok: true, comment });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Commento non salvato");
  }
}
