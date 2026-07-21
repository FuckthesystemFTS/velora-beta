import { requireUser } from "@/lib/auth";
import { jsonError, verifySameOrigin } from "@/lib/http";
import { submitModerationVote } from "@/server/services/moderation-service";

export async function POST(request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);
  try {
    const user = await requireUser();
    const { assignmentId } = await params;
    const vote = await submitModerationVote(user.id, assignmentId, await request.json());
    return Response.json({ ok: true, vote });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Voto non registrato");
  }
}
