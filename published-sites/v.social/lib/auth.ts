import { Role, type User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = env.SESSION_COOKIE_NAME;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
  const headerStore = await headers();

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: headerStore.get("user-agent") ?? "unknown",
      ipAddress: headerStore.get("x-forwarded-for") ?? "127.0.0.1",
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;

  if (rawToken) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(rawToken) },
      data: { revokedAt: new Date() },
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!rawToken) {
    return null;
  }

  const session = await prisma.session.findFirst({
    where: {
      tokenHash: sha256(rawToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        include: {
          profile: true,
        },
      },
    },
  });

  if (!session) {
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  return session;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireRole(minimumRole: Role) {
  const user = await requireUser();
  const allowed = [Role.USER, Role.VERIFIED_USER, Role.MODERATOR, Role.ADMIN, Role.SUPERADMIN];
  if (allowed.indexOf(user.role) < allowed.indexOf(minimumRole)) {
    redirect("/forbidden");
  }
  return user;
}

export async function invalidateUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export type AuthenticatedUser = User & {
  profile?: {
    displayName: string;
    avatarUrl: string | null;
  } | null;
};
