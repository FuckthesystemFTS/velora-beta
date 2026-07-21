import { InviteStatus, NotificationType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { createId } from "@paralleldrive/cuid2";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/server/services/notification-service";
import { isMailConfigured, sendMail } from "@/server/services/mail-service";

const INVITE_EXPIRY_DAYS = 14;
const REFERRAL_REWARD_POINTS = 1;

export function buildInviteLink(code: string) {
  return `${env.APP_URL}/register?invite=${code}`;
}

async function createInviteRecord(db: Prisma.TransactionClient | typeof prisma, inviterId: string, email?: string) {
  const code = createId();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  return db.invitation.create({
    data: {
      inviterId,
      code,
      email: email?.toLowerCase() || null,
      expiresAt,
      emailSentAt: email ? new Date() : null,
    },
  });
}

export async function ensurePrimaryInvite(inviterId: string) {
  const existing = await prisma.invitation.findFirst({
    where: {
      inviterId,
      email: null,
      status: InviteStatus.PENDING,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return existing;
  }

  return createInviteRecord(prisma, inviterId);
}

export async function createInvite(inviterId: string, email?: string, forceNew = false) {
  const invitation =
    email || forceNew ? await createInviteRecord(prisma, inviterId, email) : await ensurePrimaryInvite(inviterId);

  if (email) {
    if (!isMailConfigured()) {
      throw new Error("Invito email non disponibile: SMTP non configurato.");
    }

    const link = buildInviteLink(invitation.code);
    await sendMail({
      to: email,
      subject: "Invito a V per Verita",
      text: `Hai ricevuto un invito per unirti a V per Verita. Registrati qui: ${link}`,
      html: `<p>Hai ricevuto un invito per unirti a <strong>V per Verita</strong>.</p><p><a href="${link}">${link}</a></p>`,
    });
  }

  return invitation;
}

export async function acceptInviteWithClient(
  db: Prisma.TransactionClient | typeof prisma,
  code: string,
  acceptedById: string,
) {
  const invite = await db.invitation.findUnique({
    where: { code },
  });

  if (!invite) {
    throw new Error("Invito non valido.");
  }

  if (invite.status !== InviteStatus.PENDING) {
    throw new Error("Invito non disponibile.");
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    await db.invitation.update({
      where: { id: invite.id },
      data: { status: InviteStatus.EXPIRED },
    });
    throw new Error("Invito scaduto.");
  }

  if (invite.inviterId === acceptedById) {
    throw new Error("Non puoi usare il tuo stesso invito.");
  }

  await db.invitation.update({
    where: { id: invite.id },
    data: {
      status: InviteStatus.ACCEPTED,
      acceptedById,
      acceptedAt: new Date(),
    },
  });

  await db.user.update({
    where: { id: invite.inviterId },
    data: {
      vPoints: {
        increment: REFERRAL_REWARD_POINTS,
      },
    },
  });

  return invite;
}

export async function acceptInvite(code: string, acceptedById: string) {
  const invite = await acceptInviteWithClient(prisma, code, acceptedById);

  await createNotification({
    recipientId: invite.inviterId,
    actorId: acceptedById,
    type: NotificationType.SYSTEM,
    title: "Invito accettato",
    body: "Una persona invitata si e registrata. Hai ottenuto 1 V point.",
    link: "/invite",
  });
}

export async function getInvitesForUser(inviterId: string) {
  return prisma.invitation.findMany({
    where: { inviterId },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
}

export async function getInviteSummaryForUser(inviterId: string) {
  const [primaryInvite, invites, user, acceptedCount] = await Promise.all([
    ensurePrimaryInvite(inviterId),
    getInvitesForUser(inviterId),
    prisma.user.findUnique({
      where: { id: inviterId },
      select: { vPoints: true },
    }),
    prisma.invitation.count({
      where: { inviterId, status: InviteStatus.ACCEPTED },
    }),
  ]);

  return {
    primaryInvite,
    invites,
    vPoints: user?.vPoints ?? 0,
    acceptedCount,
  };
}
