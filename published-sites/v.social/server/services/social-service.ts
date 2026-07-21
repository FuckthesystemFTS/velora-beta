import { NotificationType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createNotification } from "@/server/services/notification-service";

export async function toggleSavePost(userId: string, postId: string) {
  const existing = await prisma.savedPost.findUnique({
    where: { userId_postId: { userId, postId } },
  });

  if (existing) {
    await prisma.savedPost.delete({ where: { id: existing.id } });
    return { saved: false };
  }

  await prisma.savedPost.create({
    data: { userId, postId },
  });
  return { saved: true };
}

export async function toggleFollowUser(currentUserId: string, targetUsername: string) {
  const target = await prisma.user.findUnique({
    where: { username: targetUsername },
  });
  if (!target) throw new Error("Utente non trovato.");
  if (target.id === currentUserId) throw new Error("Non puoi seguirti da solo.");

  const existing = await prisma.follow.findUnique({
    where: { followerId_followedId: { followerId: currentUserId, followedId: target.id } },
  });

  if (existing) {
    await prisma.follow.delete({ where: { id: existing.id } });
    return { following: false };
  }

  await prisma.follow.create({
    data: { followerId: currentUserId, followedId: target.id },
  });

  await createNotification({
    recipientId: target.id,
    actorId: currentUserId,
    type: NotificationType.FOLLOW,
    title: "Nuovo follower",
    body: "Un utente ha iniziato a seguirti.",
    link: `/profile/${target.username}`,
  });

  return { following: true };
}
