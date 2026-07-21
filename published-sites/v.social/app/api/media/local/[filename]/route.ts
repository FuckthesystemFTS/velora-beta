import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { jsonError } from "@/lib/http";
import { resolveLocalUploadDir } from "@/server/services/upload-service";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

export async function GET(request: Request, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return jsonError("File non valido", 400);
    }

    const fullPath = path.join(resolveLocalUploadDir(), filename);
    const fileStats = await stat(fullPath);
    const fileBuffer = await readFile(fullPath);
    const extension = path.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? "application/octet-stream";

    const range = request.headers.get("range");
    if (range) {
      const [rawStart, rawEnd] = range.replace("bytes=", "").split("-");
      const start = Number.parseInt(rawStart, 10);
      const end = rawEnd ? Number.parseInt(rawEnd, 10) : fileStats.size - 1;
      const chunk = fileBuffer.subarray(start, end + 1);

      return new Response(chunk, {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${start}-${end}/${fileStats.size}`,
          "Content-Type": contentType,
        },
      });
    }

    return new Response(fileBuffer, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(fileStats.size),
        "Content-Type": contentType,
      },
    });
  } catch {
    return jsonError("Media non trovato", 404);
  }
}
