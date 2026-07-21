import { LiveBroadcastMode, Visibility } from "@prisma/client";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";
import { getLiveHub, startLiveBroadcast } from "@/server/services/live-service";

const startSchema = z.object({
  content: z.string().max(5000).optional().nullable(),
  visibility: z.nativeEnum(Visibility).default(Visibility.PUBLIC),
  mode: z.nativeEnum(LiveBroadcastMode),
});

export async function GET() {
  try {
    const user = await requireUser();
    const hub = await getLiveHub(user.id);
    return Response.json({ ok: true, ...hub });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Impossibile caricare le dirette");
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);

  try {
    const user = await requireUser();
    assertRateLimit("live-start", `${user.id}:${getRequestIp(request)}`, { limit: 8, windowMs: 60 * 60 * 1000 });
    const body = startSchema.parse(await request.json());
    const broadcast = await startLiveBroadcast({
      creatorId: user.id,
      content: body.content,
      visibility: body.visibility,
      mode: body.mode,
    });
    return Response.json({ ok: true, broadcast });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Impossibile avviare la diretta");
  }
}
