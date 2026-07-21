import { LiveBroadcastStatus, NotificationType, PostStatus, Visibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { normalizeText, sanitizeRichText } from "@/lib/sanitize";
import { createNotification } from "@/server/services/notification-service";
import { commentSchema, postSchema, postUpdateSchema } from "@/server/services/schemas";

function extractHashtags(content: string) {
  return Array.from(new Set((content.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.toLowerCase())));
}

const feedInclude = {
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
} as const;

export async function createPost(authorId: string, input: unknown) {
  const parsed = postSchema.parse(input);
  const normalized = normalizeText(parsed.content);

  return prisma.post.create({
    data: {
      authorId,
      content: normalized,
      sanitizedContent: sanitizeRichText(normalized),
      visibility: parsed.visibility,
      shareOfPostId: parsed.shareOfPostId ?? null,
      hashtags: extractHashtags(normalized),
      media: {
        create: parsed.media.map((item) => ({
          ownerId: authorId,
          secureUrl: item.secureUrl,
          publicId: item.publicId,
          resourceType: item.resourceType,
          format: item.format ?? null,
          width: item.width ?? null,
          height: item.height ?? null,
          duration: item.duration ?? null,
          bytes: item.bytes ?? null,
          fingerprint: item.fingerprint ?? null,
        })),
      },
    },
    include: feedInclude,
  });
}

export async function createComment(authorId: string, input: unknown) {
  const parsed = commentSchema.parse(input);
  const normalized = normalizeText(parsed.content);

  const comment = await prisma.comment.create({
    data: {
      authorId,
      postId: parsed.postId,
      parentCommentId: parsed.parentCommentId ?? null,
      content: normalized,
      sanitizedContent: sanitizeRichText(normalized),
    },
    include: {
      post: { include: { author: true } },
      author: { include: { profile: true } },
    },
  });

  if (comment.post.authorId !== authorId) {
    await createNotification({
      recipientId: comment.post.authorId,
      actorId: authorId,
      type: parsed.parentCommentId ? NotificationType.REPLY : NotificationType.COMMENT,
      title: parsed.parentCommentId ? "Nuova risposta" : "Nuovo commento",
      body: normalized,
      link: `/home?post=${comment.postId}`,
    });
  }

  return comment;
}

export async function getCommentsForPost(postId: string) {
  return prisma.comment.findMany({
    where: {
      postId,
      deletedAt: null,
    },
    include: {
      author: {
        include: {
          profile: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function toggleLike(postId: string, userId: string) {
  const existing = await prisma.postLike.findUnique({
    where: {
      userId_postId: {
        userId,
        postId,
      },
    },
    include: { post: { include: { author: true } } },
  });

  if (existing) {
    await prisma.postLike.delete({ where: { id: existing.id } });
    return { liked: false };
  }

  const like = await prisma.postLike.create({
    data: { postId, userId },
    include: { post: { include: { author: true } } },
  });

  if (like.post.authorId !== userId) {
    await createNotification({
      recipientId: like.post.authorId,
      actorId: userId,
      type: NotificationType.LIKE,
      title: "Nuovo like",
      body: "Qualcuno ha apprezzato il tuo contenuto.",
      link: `/home?post=${postId}`,
    });
  }

  return { liked: true };
}

export async function sharePost(userId: string, postId: string, content = "", visibility: Visibility = Visibility.PUBLIC) {
  const targetPost = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      authorId: true,
      status: true,
      visibility: true,
      deletedAt: true,
    },
  });

  if (!targetPost || targetPost.deletedAt || targetPost.status !== PostStatus.ACTIVE) {
    throw new Error("Post non condivisibile.");
  }

  if (targetPost.visibility === Visibility.PRIVATE && targetPost.authorId !== userId) {
    throw new Error("Questo contenuto non puo essere condiviso.");
  }

  if (targetPost.visibility === Visibility.FOLLOWERS_ONLY && targetPost.authorId !== userId) {
    const isFollower = await prisma.follow.findUnique({
      where: {
        followerId_followedId: {
          followerId: userId,
          followedId: targetPost.authorId,
        },
      },
      select: { id: true },
    });

    if (!isFollower) {
      throw new Error("Puoi condividere solo contenuti che puoi visualizzare.");
    }
  }

  const sharedPost = await createPost(userId, {
    content,
    visibility,
    media: [],
    shareOfPostId: targetPost.id,
  });

  if (targetPost.authorId !== userId) {
    await createNotification({
      recipientId: targetPost.authorId,
      actorId: userId,
      type: NotificationType.SYSTEM,
      title: "Post condiviso",
      body: "Un utente ha condiviso il tuo contenuto.",
      link: "/home",
    });
  }

  return sharedPost;
}

export async function updatePost(userId: string, postId: string, input: unknown) {
  const existingPost = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      authorId: true,
      deletedAt: true,
      shareOfPostId: true,
      media: { select: { id: true } },
    },
  });

  if (!existingPost || existingPost.deletedAt) {
    throw new Error("Post non trovato.");
  }

  if (existingPost.authorId !== userId) {
    throw new Error("Non autorizzato.");
  }

  const parsed = postUpdateSchema.parse(input);
  const normalized = normalizeText(parsed.content);

  if (!normalized.trim() && existingPost.media.length === 0 && !existingPost.shareOfPostId) {
    throw new Error("Il contenuto del post non puo essere vuoto.");
  }

  return prisma.post.update({
    where: { id: postId },
    data: {
      content: normalized,
      sanitizedContent: sanitizeRichText(normalized),
      visibility: parsed.visibility,
      hashtags: extractHashtags(normalized),
    },
    include: feedInclude,
  });
}

export async function deletePost(userId: string, postId: string) {
  const existingPost = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      authorId: true,
      deletedAt: true,
    },
  });

  if (!existingPost || existingPost.deletedAt) {
    throw new Error("Post non trovato.");
  }

  if (existingPost.authorId !== userId) {
    throw new Error("Non autorizzato.");
  }

  await prisma.post.update({
    where: { id: postId },
    data: {
      status: PostStatus.DELETED,
      deletedAt: new Date(),
    },
  });

  return { deleted: true };
}

function scoreTrendingPost(post: {
  createdAt: Date;
  _count: { likes: number; comments: number; shares: number };
}) {
  const hours = Math.max(1, (Date.now() - post.createdAt.getTime()) / (1000 * 60 * 60));
  const engagement = post._count.likes * 2 + post._count.comments * 3 + post._count.shares * 5;
  return engagement / Math.pow(hours + 2, 0.65);
}

export async function getTrendingPostsForUser(userId?: string) {
  const feed = await getFeedForUser(userId);
  return [...feed]
    .sort((a, b) => scoreTrendingPost(b) - scoreTrendingPost(a))
    .slice(0, 5);
}

export async function getFeedForUser(userId?: string) {
  const followingIds = userId
    ? (
        await prisma.follow.findMany({
          where: { followerId: userId },
          select: { followedId: true },
        })
      ).map((item) => item.followedId)
    : [];

  const blockedIds = userId
    ? (
        await prisma.block.findMany({
          where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
          select: { blockerId: true, blockedId: true },
        })
      ).flatMap((row) => [row.blockerId, row.blockedId])
    : [];

  return prisma.post.findMany({
    where: {
      status: PostStatus.ACTIVE,
      deletedAt: null,
      AND: [
        {
          OR: [
            { liveBroadcast: null },
            { liveBroadcast: { status: LiveBroadcastStatus.ACTIVE } },
            { liveBroadcast: { expiresAt: { gt: new Date() } } },
          ],
        },
      ],
      authorId: blockedIds.length ? { notIn: blockedIds } : undefined,
      OR: [
        { visibility: Visibility.PUBLIC },
        ...(userId
          ? [
              { authorId: userId },
              {
                AND: [{ visibility: Visibility.FOLLOWERS_ONLY }, { authorId: { in: followingIds } }],
              },
            ]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      ...feedInclude,
      likes: userId ? { where: { userId }, select: { id: true } } : false,
    },
  });
}

export async function getPostForUser(postId: string, userId?: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      ...feedInclude,
      likes: userId ? { where: { userId }, select: { id: true } } : false,
    },
  });

  if (!post || post.deletedAt || post.status === PostStatus.DELETED) {
    return null;
  }

  if (post.liveBroadcast && post.liveBroadcast.status === LiveBroadcastStatus.ENDED && post.liveBroadcast.expiresAt && post.liveBroadcast.expiresAt <= new Date()) {
    return null;
  }

  if (post.visibility === Visibility.PRIVATE && post.authorId !== userId) {
    return null;
  }

  if (post.visibility === Visibility.FOLLOWERS_ONLY && post.authorId !== userId) {
    if (!userId) {
      return null;
    }

    const allowed = await prisma.follow.findUnique({
      where: {
        followerId_followedId: {
          followerId: userId,
          followedId: post.authorId,
        },
      },
    });

    if (!allowed) {
      return null;
    }
  }

  return post;
}
