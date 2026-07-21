import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { v2 as cloudinary } from "cloudinary";

import { env, isCloudinaryConfigured } from "@/lib/env";

export type UploadedMedia = {
  secureUrl: string;
  publicId: string;
  resourceType: "IMAGE" | "VIDEO";
  format: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  bytes: number | null;
  fingerprint: string;
};

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export function resolveLocalUploadDir() {
  const configuredDir = env.LOCAL_UPLOAD_DIR.trim();

  if (path.isAbsolute(configuredDir)) {
    return configuredDir;
  }

  if (env.NODE_ENV === "production") {
    const safeName = configuredDir.replace(/^public[\\/]/, "").replace(/[\\/]+/g, "-") || "v-uploads";
    return path.join(os.tmpdir(), safeName);
  }

  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredDir);
}

function fingerprint(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function validateMediaFile(file: File) {
  const isImage = ALLOWED_IMAGE_TYPES.has(file.type);
  const isVideo = ALLOWED_VIDEO_TYPES.has(file.type);
  if (!isImage && !isVideo) {
    throw new Error("Tipo file non supportato.");
  }
  const limit = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > limit) {
    throw new Error("File troppo grande.");
  }
  return { resourceType: isImage ? "IMAGE" : "VIDEO" } as const;
}

export async function uploadMedia(file: File) {
  const validation = validateMediaFile(file);
  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = fingerprint(bytes);

  if (env.NODE_ENV === "production" && !isCloudinaryConfigured) {
    throw new Error("Upload media non disponibile: Cloudinary non e configurato completamente in produzione.");
  }

  if (isCloudinaryConfigured) {
    const response = await new Promise<{
      secure_url: string;
      public_id: string;
      resource_type: string;
      format?: string;
      width?: number;
      height?: number;
      duration?: number;
      bytes?: number;
    }>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "v-social",
            resource_type: validation.resourceType === "VIDEO" ? "video" : "image",
            overwrite: false,
          },
          (error, result) => {
            if (error || !result) reject(error);
            else resolve(result);
          },
        )
        .end(bytes);
    });

    return {
      secureUrl: response.secure_url,
      publicId: response.public_id,
      resourceType: validation.resourceType,
      format: response.format ?? null,
      width: response.width ?? null,
      height: response.height ?? null,
      duration: response.duration ? Math.round(response.duration) : null,
      bytes: response.bytes ?? file.size,
      fingerprint: hash,
    } satisfies UploadedMedia;
  }

  const uploadDir = resolveLocalUploadDir();
  await mkdir(uploadDir, { recursive: true });
  const extension = file.name.split(".").pop() ?? (validation.resourceType === "VIDEO" ? "mp4" : "jpg");
  const localName = `${randomUUID()}.${extension}`;
  const filePath = path.join(uploadDir, localName);
  await writeFile(filePath, bytes);

  return {
    secureUrl: `/api/media/local/${localName}`,
    publicId: `local/${localName}`,
    resourceType: validation.resourceType,
    format: extension,
    width: null,
    height: null,
    duration: null,
    bytes: file.size,
    fingerprint: hash,
  } satisfies UploadedMedia;
}
