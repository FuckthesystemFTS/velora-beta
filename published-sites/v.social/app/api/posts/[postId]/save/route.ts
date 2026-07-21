import { requireUser } from "@/lib/auth";
import { jsonError, verifySameOrigin } from "@/lib/http";
import { toggleSavePost } from "@/server/services/social-service";

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    const { postId } = await params;
    const result = await toggleSavePost(user.id, postId);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Operazione non riuscita");
  }
}
