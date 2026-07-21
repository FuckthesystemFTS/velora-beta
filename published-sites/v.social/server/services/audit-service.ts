import type { AuditActorType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function auditLog(input: {
  actorId?: string | null;
  actorType: AuditActorType;
  action: string;
  entityType: string;
  entityId: string;
  moderationCaseId?: string | null;
  metadata?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorType: input.actorType,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      moderationCaseId: input.moderationCaseId ?? null,
      metadata: input.metadata as object | undefined,
    },
  });
}
