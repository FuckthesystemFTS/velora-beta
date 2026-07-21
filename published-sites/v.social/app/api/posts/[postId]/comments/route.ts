import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";
import { createComment, getCommentsForPost } from "@/server/services/post-service";

export async function GET(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    await requireUser();
    const { postId } = await params;
    const comments = await getCommentsForPost(postId);
    return Response.json({ ok: true, comments });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Commenti non disponibili", 400);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    assertRateLimit("comment", `${user.id}:${getRequestIp(request)}`, { limit: 50, windowMs: 60 * 60 * 1000 });
    const { postId } = await params;
    const body = await request.json();
    const comment = await createComment(user.id, {
      ...body,
      postId,
    });
    return Response.json({ ok: true, comment });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Commento non salvato");
  }
}
