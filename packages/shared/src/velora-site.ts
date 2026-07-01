import { z } from "zod";
import { navigationCategories } from "./categories.js";
import { zoneSlugRegex } from "./zones.js";

export const veloraPermissionsSchema = z.object({
  externalNetwork: z.boolean().default(false),
  clipboardRead: z.boolean().default(false),
  clipboardWrite: z.boolean().default(false),
  notifications: z.boolean().default(false),
  fileDownload: z.boolean().default(false)
});

export const veloraManifestSchema = z.object({
  formatVersion: z.literal(1),
  address: z.string().regex(/^[a-z0-9]+(?:\.[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)$/),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  category: z.enum(navigationCategories),
  entryFile: z.string().min(1),
  languages: z.array(z.string().min(2).max(16)).min(1),
  keywords: z.array(z.string().min(1).max(64)).max(50),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  ageRating: z.enum(["EVERYONE", "13+", "16+", "18+"]),
  familySafe: z.boolean(),
  permissions: veloraPermissionsSchema,
  allowedExternalOrigins: z.array(z.url()).default([])
}).superRefine((manifest, context) => {
  const [category, slug] = manifest.address.split(".");
  if (category !== manifest.category) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Manifest category must match address prefix",
      path: ["category"]
    });
  }
  if (!slug || !zoneSlugRegex.test(slug)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Address slug is invalid",
      path: ["address"]
    });
  }
});

export const veloraValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  excludedFiles: z.array(z.string()),
  includedFiles: z.array(z.string()),
  totalFiles: z.number(),
  totalSize: z.number(),
  requestedPermissions: veloraPermissionsSchema
});

export const publisherChunkSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  chunkHash: z.string().min(1),
  chunkSize: z.number().int().nonnegative(),
  localPath: z.string().min(1)
});

export const publisherFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  hash: z.string().min(1)
});

export const publisherPackageResponseSchema = z.object({
  address: z.string().min(1),
  version: z.string().min(1),
  contentCid: z.string().min(1),
  manifestJson: z.record(z.string(), z.unknown()),
  manifestHash: z.string().min(1),
  packageHash: z.string().min(1),
  publisherPublicKey: z.string().min(1),
  publisherSignature: z.string().min(1),
  totalSize: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(publisherFileSchema),
  chunks: z.array(publisherChunkSchema),
  packagePath: z.string().min(1)
});

export const publisherReleaseMutationSchema = z.object({
  releaseId: z.string().optional(),
  address: z.string().min(1),
  version: z.string().min(1),
  contentCid: z.string().optional(),
  status: z.string().min(1)
});

export const publisherReleaseRecordSchema = z.object({
  id: z.string(),
  version: z.string(),
  content_cid: z.string(),
  status: z.string(),
  total_size: z.number(),
  file_count: z.number(),
  created_at: z.string(),
  published_at: z.string().nullable().optional()
});

export const publisherSearchResultSchema = z.object({
  address: z.string(),
  category: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  content_cid: z.string(),
  release_version: z.string(),
  availability: z.number()
});

export const publisherContentObjectSchema = z.object({
  object: z.record(z.string(), z.unknown()),
  chunks: z.array(z.record(z.string(), z.unknown())),
  providers: z.array(z.record(z.string(), z.unknown()))
});

export type VeloraManifest = z.infer<typeof veloraManifestSchema>;
export type VeloraValidationResult = z.infer<typeof veloraValidationResultSchema>;
export type PublisherPackageResponse = z.infer<typeof publisherPackageResponseSchema>;
export type PublisherReleaseMutation = z.infer<typeof publisherReleaseMutationSchema>;
export type PublisherReleaseRecord = z.infer<typeof publisherReleaseRecordSchema>;
export type PublisherSearchResult = z.infer<typeof publisherSearchResultSchema>;
export type PublisherContentObject = z.infer<typeof publisherContentObjectSchema>;

export interface VeloraSiteApi {
  validateRelease(input: { sitePath: string }): Promise<VeloraValidationResult>;
  packageRelease(input: { sitePath: string; publisherPublicKey: string; userId?: string; token?: string }): Promise<PublisherPackageResponse>;
  registerRelease(input: PublisherPackageResponse & { userId?: string; token?: string }): Promise<PublisherReleaseMutation>;
  listReleases(address: string): Promise<{ releases: PublisherReleaseRecord[] }>;
  getRelease(address: string, releaseId: string): Promise<PublisherReleaseRecord>;
  completeRelease(input: { address: string; releaseId: string }): Promise<PublisherReleaseMutation>;
  failRelease(input: { address: string; releaseId: string; reason?: string }): Promise<PublisherReleaseMutation>;
  activateRelease(input: { address: string; releaseId: string; reason?: string }): Promise<PublisherReleaseMutation>;
  revokeRelease(input: { address: string; releaseId: string; reason?: string }): Promise<PublisherReleaseMutation>;
  rollbackRelease(input: { address: string; version: string; reason?: string }): Promise<PublisherReleaseMutation>;
  search(query: string): Promise<{ query: string; results: PublisherSearchResult[] }>;
  getContent(contentCid: string): Promise<PublisherContentObject>;
}

export function createVeloraSiteApi(baseUrl: string, fetchImpl: typeof fetch = ensureFetch()): VeloraSiteApi {
  const requestJson = async <T>(path: string, init: RequestInit | undefined, schema: z.ZodType<T>) => {
    const response = await fetchImpl(joinApiUrl(baseUrl, path), init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractApiError(payload, response.status));
    }
    return schema.parse(payload);
  };

  return {
    validateRelease(input: { sitePath: string }) {
      return requestJson(
        "/api/v1/sites/validate-release",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input)
        },
        veloraValidationResultSchema
      );
    },
    packageRelease(input: { sitePath: string; publisherPublicKey: string; userId?: string; token?: string }) {
      return requestJson(
        "/api/v1/sites/package-release",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders(input)
          },
          body: JSON.stringify({
            sitePath: input.sitePath,
            publisherPublicKey: input.publisherPublicKey
          })
        },
        publisherPackageResponseSchema
      );
    },
    registerRelease(input: PublisherPackageResponse & { userId?: string; token?: string }) {
      return requestJson(
        "/api/v1/sites/register-release",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders(input)
          },
          body: JSON.stringify(stripAuth(input))
        },
        publisherReleaseMutationSchema
      );
    },
    listReleases(address: string) {
      return requestJson(
        `/api/v1/sites/${encodeURIComponent(address)}/releases`,
        undefined,
        z.object({ releases: z.array(publisherReleaseRecordSchema) })
      );
    },
    getRelease(address: string, releaseId: string) {
      return requestJson(
        `/api/v1/sites/${encodeURIComponent(address)}/releases/${encodeURIComponent(releaseId)}`,
        undefined,
        publisherReleaseRecordSchema
      );
    },
    completeRelease(input: { address: string; releaseId: string }) {
      return requestJson(
        `/api/v1/sites/${encodeURIComponent(input.address)}/releases/${encodeURIComponent(input.releaseId)}/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        },
        publisherReleaseMutationSchema
      );
    },
    failRelease(input: { address: string; releaseId: string; reason?: string }) {
      return requestJson(
        `/api/v1/sites/${encodeURIComponent(input.address)}/releases/${encodeURIComponent(input.releaseId)}/fail`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: input.reason })
        },
        publisherReleaseMutationSchema
      );
    },
    activateRelease(input: { address: string; releaseId: string; reason?: string }) {
      return requestJson(
        `/api/v1/sites/${encodeURIComponent(input.address)}/releases/${encodeURIComponent(input.releaseId)}/activate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: input.reason })
        },
        publisherReleaseMutationSchema
      );
    },
    revokeRelease(input: { address: string; releaseId: string; reason?: string }) {
      return requestJson(
        `/api/v1/sites/${encodeURIComponent(input.address)}/releases/${encodeURIComponent(input.releaseId)}/revoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: input.reason })
        },
        publisherReleaseMutationSchema
      );
    },
    rollbackRelease(input: { address: string; version: string; reason?: string }) {
      return requestJson(
        `/api/v1/sites/${encodeURIComponent(input.address)}/rollback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: input.version, reason: input.reason })
        },
        publisherReleaseMutationSchema
      );
    },
    search(query: string) {
      return requestJson(
        `/api/v1/search?q=${encodeURIComponent(query)}`,
        undefined,
        z.object({ query: z.string(), results: z.array(publisherSearchResultSchema) })
      );
    },
    getContent(contentCid: string) {
      return requestJson(`/api/v1/content/${encodeURIComponent(contentCid)}`, undefined, publisherContentObjectSchema);
    }
  };
}

function ensureFetch() {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available in this runtime");
  }
  return fetch;
}

function joinApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function extractApiError(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.code === "string") {
      return record.code;
    }
    if (typeof record.message === "string") {
      return record.message;
    }
    if (typeof record.error === "string") {
      return record.error;
    }
  }
  return `HTTP_${status}`;
}

function stripAuth<T extends { userId?: string; token?: string }>(value: T): Omit<T, "userId" | "token"> {
  const { userId: _userId, token: _token, ...rest } = value;
  return rest;
}

function authHeaders(input: { token?: string; userId?: string }): Record<string, string> {
  if (input.token) {
    return { authorization: `Bearer ${input.token}` };
  }
  return {};
}
