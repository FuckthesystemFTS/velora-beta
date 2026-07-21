import { requireUser } from "@/lib/auth";
import { jsonError, verifySameOrigin } from "@/lib/http";
import { toggleFollowUser } from "@/server/services/social-service";

export async function POST(request: Request, { params }: { params: Promise<{ username: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    const { username } = await params;
    const result = await toggleFollowUser(user.id, username);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Operazione non riuscita");
  }
}
