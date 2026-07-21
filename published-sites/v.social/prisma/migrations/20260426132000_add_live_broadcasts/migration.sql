CREATE TYPE "LiveBroadcastStatus" AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE "LiveBroadcastMode" AS ENUM ('AUDIO_VIDEO', 'AUDIO_ONLY');

CREATE TABLE "LiveBroadcast" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "mode" "LiveBroadcastMode" NOT NULL,
  "status" "LiveBroadcastStatus" NOT NULL DEFAULT 'ACTIVE',
  "recordingUrl" TEXT,
  "recordingPublicId" TEXT,
  "thumbnailUrl" TEXT,
  "thumbnailPublicId" TEXT,
  "durationSeconds" INTEGER,
  "bytes" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LiveBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveBroadcast_postId_key" ON "LiveBroadcast"("postId");
CREATE INDEX "LiveBroadcast_creatorId_startedAt_idx" ON "LiveBroadcast"("creatorId", "startedAt");
CREATE INDEX "LiveBroadcast_status_startedAt_idx" ON "LiveBroadcast"("status", "startedAt");
CREATE INDEX "LiveBroadcast_expiresAt_idx" ON "LiveBroadcast"("expiresAt");

ALTER TABLE "LiveBroadcast"
ADD CONSTRAINT "LiveBroadcast_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveBroadcast"
ADD CONSTRAINT "LiveBroadcast_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
