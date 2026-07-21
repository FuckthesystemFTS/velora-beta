import { requireUser } from "@/lib/auth";
import { getRequestIp, jsonError, verifySameOrigin } from "@/lib/http";
import { assertRateLimit } from "@/lib/rate-limit";
import { uploadMedia } from "@/server/services/upload-service";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("Origine non valida", 403);
  try {
    const user = await requireUser();
    assertRateLimit("upload", `${user.id}:${getRequestIp(request)}`, { limit: 30, windowMs: 60 * 60 * 1000 });
    const formData = await request.formData();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File);
    const items = [];
    for (const file of files) {
      items.push(await uploadMedia(file));
    }
    return Response.json({ ok: true, items });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Upload fallito");
  }
}
