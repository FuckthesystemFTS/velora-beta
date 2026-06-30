export const config = {
  port: Number(process.env.PORT ?? 3000),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL,
  accessTokenSecret: process.env.ACCESS_TOKEN_SECRET ?? "development-access-secret",
  membershipSigningPrivateKeyBase64: process.env.MEMBERSHIP_SIGNING_PRIVATE_KEY_BASE64 ?? "",
  zoneRegistrySigningPrivateKeyBase64: process.env.ZONE_REGISTRY_SIGNING_PRIVATE_KEY_BASE64 ?? "",
  releaseSigningPrivateKeyBase64: process.env.RELEASE_SIGNING_PRIVATE_KEY_BASE64 ?? "",
  controlApiServerSigningPublicKeyBase64: process.env.CONTROL_API_SERVER_SIGNING_PUBLIC_KEY_BASE64 ?? "",
  chunkSizeBytes: Number(process.env.VELORA_CHUNK_SIZE_BYTES ?? 1048576),
  maxSiteSizeMb: Number(process.env.MAX_SITE_SIZE_MB ?? 250),
  maxSiteFileCount: Number(process.env.MAX_SITE_FILE_COUNT ?? 5000),
  targetReplicationFactor: Number(process.env.TARGET_REPLICATION_FACTOR ?? 3),
  zoneReservationHours: Number(process.env.ZONE_REQUEST_RESERVATION_HOURS ?? 48),
  adminSessionMinutes: Number(process.env.ADMIN_SESSION_MINUTES ?? 15)
};
