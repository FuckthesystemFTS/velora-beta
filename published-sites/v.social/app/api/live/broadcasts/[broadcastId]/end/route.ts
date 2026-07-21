import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";
import { finishLiveBroadcast } from "@/server/services/live-service";

const endSchema = z.object({
  recording: z
    .object({
      secureUrl: z.string().url(),
      publicId: z.string().min(1),
      format: z.string().optional().nullable(),
      width: z.number().int().optional().nullable(),
      height: z.number().int().optional().nullable(),
      duration: z.number().optional().nullable(),
      bytes: z.number().int().optional().nullable(),
      fingerprint: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ broadcastId: string }> },
) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    assertRateLimit("live-end", `${user.id}:${getRequestIp(request)}`, { limit: 12, windowMs: 60 * 60 * 1000 });
    const { broadcastId } = await params;
    const body = endSchema.parse(await request.json());
    const broadcast = await finishLiveBroadcast({
      creatorId: user.id,
      broadcastId,
      recording: body.recording ?? null,
    });
    return Response.json({ ok: true, broadcast });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Impossibile chiudere la diretta");
  }
}
