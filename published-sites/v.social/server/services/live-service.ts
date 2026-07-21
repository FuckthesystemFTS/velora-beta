import { LiveBroadcastStatus, NotificationType, PostStatus, Visibility } from "@prisma/client";
import type { LiveBroadcastMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { normalizeText, sanitizeRichText } from "@/lib/sanitize";
import { createNotification } from "@/server/services/notification-service";

const LIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function startLiveBroadcast(input: {
  creatorId: string;
  content?: string | null;
  visibility?: Visibility;
  mode: LiveBroadcastMode;
}) {
  const content = normalizeText(input.content ?? "").trim() || "Diretta in corso";
  const visibility = input.visibility ?? Visibility.PUBLIC;

  const existing = await prisma.liveBroadcast.findFirst({
    where: {
      creatorId: input.creatorId,
      status: LiveBroadcastStatus.ACTIVE,
    },
    include: {
      post: true,
    },
  });

  if (existing) {
    return existing;
  }

  const broadcast = await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        authorId: input.creatorId,
        content,
        sanitizedContent: sanitizeRichText(content),
        visibility,
        hashtags: ["#live"],
      },
    });

    return tx.liveBroadcast.create({
      data: {
        creatorId: input.creatorId,
        postId: post.id,
        mode: input.mode,
        status: LiveBroadcastStatus.ACTIVE,
      },
      include: {
        creator: { include: { profile: true } },
        post: true,
      },
    });
  });

  const followers = await prisma.follow.findMany({
    where: { followedId: input.creatorId },
    select: { followerId: true },
  });

  await Promise.all(
    followers.map(({ followerId }) =>
      createNotification({
        recipientId: followerId,
        actorId: input.creatorId,
        type: NotificationType.SYSTEM,
        title: "Diretta iniziata",
        body: `${broadcast.creator.profile?.displayName ?? broadcast.creator.username} e in diretta ora.`,
        link: `/post/${broadcast.postId}`,
      }),
    ),
  );

  return broadcast;
}

export async function finishLiveBroadcast(input: {
  creatorId: string;
  broadcastId: string;
  recording?: {
    secureUrl: string;
    publicId: string;
    format?: string | null;
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    bytes?: number | null;
    fingerprint?: string | null;
  } | null;
}) {
  const broadcast = await prisma.liveBroadcast.findUnique({
    where: { id: input.broadcastId },
    include: { post: true },
  });

  if (!broadcast || broadcast.creatorId !== input.creatorId) {
    throw new Error("Diretta non trovata.");
  }

  const endedAt = new Date();
  const expiresAt = new Date(endedAt.getTime() + LIVE_RETENTION_MS);

  return prisma.$transaction(async (tx) => {
    if (input.recording?.secureUrl) {
      const existingMedia = await tx.postMedia.findFirst({
        where: {
          postId: broadcast.postId,
          publicId: input.recording.publicId,
        },
      });

      if (!existingMedia) {
        await tx.postMedia.create({
          data: {
            ownerId: input.creatorId,
            postId: broadcast.postId,
            resourceType: "VIDEO",
            secureUrl: input.recording.secureUrl,
            publicId: input.recording.publicId,
            format: input.recording.format ?? null,
            width: input.recording.width ?? null,
            height: input.recording.height ?? null,
            duration: input.recording.duration ? Math.round(input.recording.duration) : null,
            bytes: input.recording.bytes ?? null,
            fingerprint: input.recording.fingerprint ?? null,
          },
        });
      }
    }

    return tx.liveBroadcast.update({
      where: { id: input.broadcastId },
      data: {
        status: LiveBroadcastStatus.ENDED,
        endedAt,
        expiresAt,
        recordingUrl: input.recording?.secureUrl ?? broadcast.recordingUrl,
        recordingPublicId: input.recording?.publicId ?? broadcast.recordingPublicId,
        durationSeconds: input.recording?.duration ? Math.round(input.recording.duration) : broadcast.durationSeconds,
        bytes: input.recording?.bytes ?? broadcast.bytes,
      },
      include: {
        creator: { include: { profile: true } },
        post: {
          include: {
            author: { include: { profile: true } },
            media: true,
            liveBroadcast: true,
            _count: { select: { likes: true, comments: true, shares: true } },
            shareOfPost: {
              include: {
                author: { include: { profile: true } },
                media: true,
                _count: { select: { likes: true, comments: true, shares: true } },
              },
            },
          },
        },
      },
    });
  });
}

export async function getLiveHub(viewerId: string) {
  const followingIds = (
    await prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followedId: true },
    })
  ).map((item) => item.followedId);

  const [active, archive, ownActive] = await Promise.all([
    prisma.liveBroadcast.findMany({
      where: {
        status: LiveBroadcastStatus.ACTIVE,
        post: { deletedAt: null, status: PostStatus.ACTIVE },
      },
      include: {
        creator: { include: { profile: true } },
        post: {
          include: {
            media: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
      take: 24,
    }),
    prisma.liveBroadcast.findMany({
      where: {
        status: LiveBroadcastStatus.ENDED,
        expiresAt: { gt: new Date() },
        OR: [
          { creatorId: viewerId },
          { creatorId: { in: followingIds } },
          { post: { visibility: Visibility.PUBLIC } },
        ],
      },
      include: {
        creator: { include: { profile: true } },
        post: {
          include: {
            media: true,
          },
        },
      },
      orderBy: { endedAt: "desc" },
      take: 24,
    }),
    prisma.liveBroadcast.findFirst({
      where: {
        creatorId: viewerId,
        status: LiveBroadcastStatus.ACTIVE,
      },
      include: {
        creator: { include: { profile: true } },
        post: { include: { media: true } },
      },
    }),
  ]);

  return { active, archive, ownActive };
}
