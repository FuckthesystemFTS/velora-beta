import { jsonError, verifySameOrigin } from "@/lib/http";
import { createPasswordResetToken } from "@/server/services/auth-service";
import { forgotPasswordSchema } from "@/server/services/schemas";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const parsed = forgotPasswordSchema.parse(await request.json());
    await createPasswordResetToken(parsed.identifier);
    return Response.json({ ok: true, message: "Se l'account esiste, riceverai un'email." });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Richiesta non valida");
  }
}
