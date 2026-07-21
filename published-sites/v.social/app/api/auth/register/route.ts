import { createSession } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/rate-limit";
import { registerUser } from "@/server/services/auth-service";
import { ZodError } from "zod";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    assertRateLimit("register", getRequestIp(request), { limit: 10, windowMs: 60 * 60 * 1000 });
    const body = await request.json();
    const [existingEmail, existingUsername] = await Promise.all([
      body.email
        ? prisma.user.findUnique({
            where: { email: String(body.email).toLowerCase() },
            select: { id: true },
          })
        : null,
      body.username
        ? prisma.user.findUnique({
            where: { username: String(body.username).toLowerCase() },
            select: { id: true },
          })
        : null,
    ]);

    if (existingEmail) {
      return jsonError("Questa email e gia registrata.", 409);
    }

    if (existingUsername) {
      return jsonError("Questo username e gia in uso.", 409);
    }

    const user = await registerUser(body);
    await createSession(user.id);
    return Response.json({ ok: true, userId: user.id });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(error.issues[0]?.message ?? "Controlla i dati inseriti.", 400);
    }
    return jsonError(error instanceof Error ? error.message : "Registrazione fallita");
  }
}
