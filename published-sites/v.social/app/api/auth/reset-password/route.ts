import { jsonError, verifySameOrigin } from "@/lib/http";
import { resetPasswordFromToken } from "@/server/services/auth-service";
import { resetPasswordSchema } from "@/server/services/schemas";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const parsed = resetPasswordSchema.parse(await request.json());
    await resetPasswordFromToken(parsed.token, parsed.newPassword);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Reset fallito");
  }
}
