import type { NotificationType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function createNotification(input: {
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  metadata?: unknown;
}) {
  return prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      metadata: input.metadata as object | undefined,
    },
  });
}
