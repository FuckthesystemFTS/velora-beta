import { requireUser } from "@/lib/auth";
import { jsonError, verifySameOrigin } from "@/lib/http";
import { deletePost, updatePost } from "@/server/services/post-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    const { postId } = await params;
    const body = await request.json();
    const post = await updatePost(user.id, postId, body);
    return Response.json({ ok: true, post });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Aggiornamento post fallito");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    const { postId } = await params;
    const result = await deletePost(user.id, postId);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Eliminazione post fallita");
  }
}
