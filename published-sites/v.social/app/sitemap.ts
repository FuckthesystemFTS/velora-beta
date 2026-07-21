import type { MetadataRoute } from "next";
import { Visibility } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.APP_URL.replace(/\/+$/, "");
  const now = new Date();

  const [posts, users] = await Promise.all([
    prisma.post.findMany({
      where: {
        deletedAt: null,
        visibility: Visibility.PUBLIC,
      },
      select: {
        id: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 250,
    }),
    prisma.user.findMany({
      where: {
        deletedAt: null,
        isSuspended: false,
      },
      select: {
        username: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 250,
    }),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/feed`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/explore`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${baseUrl}/register`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/install-app`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/cookie`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/moderation-policy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  return [
    ...staticRoutes,
    ...posts.map((post) => ({
      url: `${baseUrl}/post/${post.id}`,
      lastModified: post.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...users.map((user) => ({
      url: `${baseUrl}/profile/${user.username}`,
      lastModified: user.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
