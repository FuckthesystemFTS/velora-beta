import { createSession } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";
import { authenticateUser } from "@/server/services/auth-service";
import { loginSchema } from "@/server/services/schemas";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    assertRateLimit("login", getRequestIp(request), { limit: 15, windowMs: 60 * 60 * 1000 });
    const parsed = loginSchema.parse(await request.json());
    const user = await authenticateUser(parsed.identifier, parsed.password);
    if (!user) {
      return jsonError("Credenziali non valide", 401);
    }
    await createSession(user.id);
    return Response.json({ ok: true, userId: user.id });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Login fallito");
  }
}
