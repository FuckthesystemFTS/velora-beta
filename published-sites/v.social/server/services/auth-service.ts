import { NotificationType, PolicyType, Role } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

import { hashPassword, verifyPassword } from "@/lib/auth";
import { env } from "@/lib/env";
import { policyVersion } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { acceptInviteWithClient } from "@/server/services/invite-service";
import { createNotification } from "@/server/services/notification-service";
import { sendPasswordResetEmail, sendWelcomeEmail } from "@/server/services/mail-service";
import { registerSchema } from "@/server/services/schemas";

export async function registerUser(input: {
  email: string;
  username: string;
  displayName: string;
  password: string;
  acceptPolicies: boolean;
  inviteCode?: string | null;
}) {
  const parsed = registerSchema.parse(input);

  const passwordHash = await hashPassword(parsed.password);

  let inviterId: string | null = null;

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: parsed.email.toLowerCase(),
        username: parsed.username.toLowerCase(),
        passwordHash,
        role: Role.USER,
        profile: {
          create: {
            displayName: parsed.displayName,
          },
        },
        policyAcceptances: {
          create: Object.values(PolicyType).map((policy) => ({
            policy,
            version: policyVersion,
          })),
        },
      },
      include: { profile: true },
    });

    if (input.inviteCode) {
      const invite = await acceptInviteWithClient(tx, input.inviteCode, createdUser.id);
      inviterId = invite.inviterId;
    }

    return createdUser;
  });

  if (inviterId) {
    await createNotification({
      recipientId: inviterId,
      actorId: user.id,
      type: NotificationType.SYSTEM,
      title: "Invito accettato",
      body: "Una persona invitata si e registrata. Hai ottenuto 1 V point.",
      link: "/invite",
    });
  }

  await sendWelcomeEmail(user.email, user.username);
  return user;
}

export async function authenticateUser(identifier: string, password: string) {
  const normalized = identifier.toLowerCase().trim();
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalized }, { username: normalized }],
    },
    include: { profile: true },
  });

  if (!user || user.deletedAt || user.isSuspended) {
    return null;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return user;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createPasswordResetToken(identifier: string) {
  const normalized = identifier.toLowerCase().trim();
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalized }, { username: normalized }],
      deletedAt: null,
      isSuspended: false,
    },
  });

  if (!user) {
    return;
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.verification.create({
    data: {
      userId: user.id,
      type: "PASSWORD_RESET",
      tokenHash,
      expiresAt,
    },
  });

  const resetLink = `${env.APP_URL}/reset-password?token=${token}`;
  await sendPasswordResetEmail(user.email, user.username, resetLink);
}

export async function resetPasswordFromToken(token: string, newPassword: string) {
  const tokenHash = sha256(token);
  const record = await prisma.verification.findFirst({
    where: {
      tokenHash,
      type: "PASSWORD_RESET",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!record?.userId) {
    throw new Error("Token non valido o scaduto.");
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId! },
      data: { passwordHash },
    });
    await tx.verification.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    await tx.session.updateMany({
      where: { userId: record.userId!, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}
