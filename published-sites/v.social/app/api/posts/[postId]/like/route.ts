import { requireUser } from "@/lib/auth";
import { jsonError, verifySameOrigin } from "@/lib/http";
import { toggleLike } from "@/server/services/post-service";

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);
  try {
    const user = await requireUser();
    const { postId } = await params;
    const result = await toggleLike(postId, user.id);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Like fallito");
  }
}
