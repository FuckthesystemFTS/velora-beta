import { Visibility } from "@prisma/client";

import { requireUser } from "@/lib/auth";
import { jsonError, verifySameOrigin } from "@/lib/http";
import { sharePost } from "@/server/services/post-service";

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    const { postId } = await params;
    const body = (await request.json().catch(() => ({}))) as { content?: string; visibility?: Visibility };

    const post = await sharePost(user.id, postId, body.content ?? "", body.visibility ?? Visibility.PUBLIC);
    return Response.json({ ok: true, post });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Condivisione fallita");
  }
}
