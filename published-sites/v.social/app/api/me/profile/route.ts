import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({
  displayName: z.string().trim().min(2).max(50),
  bio: z.string().trim().max(280).optional().default(""),
  location: z.string().trim().max(80).optional().default(""),
  website: z.string().trim().max(200).optional().default(""),
  avatarUrl: z.string().trim().optional().nullable(),
  avatarPublicId: z.string().trim().optional().nullable(),
  coverUrl: z.string().trim().optional().nullable(),
  coverPublicId: z.string().trim().optional().nullable(),
});

export async function PATCH(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    assertRateLimit("profile:update", `${user.id}:${getRequestIp(request)}`, { limit: 20, windowMs: 60 * 60 * 1000 });
    const parsed = schema.parse(await request.json());

    const profile = await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: parsed,
      create: {
        userId: user.id,
        ...parsed,
      },
    });

    return Response.json({ ok: true, profile });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Profilo non aggiornato");
  }
}
