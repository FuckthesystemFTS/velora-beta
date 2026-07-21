import { createPost } from "@/server/services/post-service";
import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);
  try {
    const user = await requireUser();
    assertRateLimit("post", `${user.id}:${getRequestIp(request)}`, { limit: 25, windowMs: 60 * 60 * 1000 });
    const body = await request.json();
    const post = await createPost(user.id, body);
    return Response.json({ ok: true, post });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Creazione post fallita");
  }
}
