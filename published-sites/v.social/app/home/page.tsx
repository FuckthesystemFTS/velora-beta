import { Role } from "@prisma/client";

import { PersonRow } from "@/components/cards/person-row";
import { PostCard } from "@/components/cards/post-card";
import { PostComposer } from "@/components/forms/post-composer";
import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFeedForUser, getTrendingPostsForUser } from "@/server/services/post-service";

export default async function HomePage() {
  const user = await requireUser();
  const following = await prisma.follow.findMany({
    where: { followerId: user.id },
    include: { followed: { include: { profile: true } } },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const followingIds = following.map((item) => item.followedId);

  const [feed, trendingPosts, suggestions] = await Promise.all([
    getFeedForUser(user.id),
    getTrendingPostsForUser(user.id),
    prisma.user.findMany({
      where: {
        id: { notIn: [user.id, ...followingIds] },
        deletedAt: null,
        isSuspended: false,
      },
      include: { profile: true },
      orderBy: [{ role: "desc" }, { createdAt: "desc" }],
      take: 6,
    }),
  ]);

  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
      rightRail={
        <>
          <Card className="space-y-3 p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Profilo</div>
            <div>
              <p className="text-2xl font-semibold text-[var(--foreground)]">{user.profile?.displayName ?? user.username}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">@{user.username}</p>
            </div>
            {user.role !== Role.USER ? (
              <Badge className="border-[rgba(255,88,62,0.22)] text-[var(--foreground)]">
                {user.role.toLowerCase()}
              </Badge>
            ) : null}
          </Card>

          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Persone che segui</p>
              <Badge>{following.length}</Badge>
            </div>
            <div className="space-y-3">
              {following.length ? (
                following.map(({ followed }) => (
                  <PersonRow
                    key={followed.id}
                    username={followed.username}
                    displayName={followed.profile?.displayName ?? followed.username}
                    avatarUrl={followed.profile?.avatarUrl}
                    bio={followed.profile?.bio}
                    role={followed.role}
                  />
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">Nessun contatto seguito per ora.</p>
              )}
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Suggeriti</p>
              <Badge>{suggestions.length}</Badge>
            </div>
            <div className="space-y-3">
              {suggestions.map((candidate) => (
                <PersonRow
                  key={candidate.id}
                  username={candidate.username}
                  displayName={candidate.profile?.displayName ?? candidate.username}
                  avatarUrl={candidate.profile?.avatarUrl}
                  bio={candidate.profile?.bio}
                  role={candidate.role}
                />
              ))}
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">In evidenza</p>
              <Badge>{trendingPosts.length}</Badge>
            </div>
            <div className="space-y-3">
              {trendingPosts.length ? (
                trendingPosts.map((post) => (
                  <div key={post.id} className="rounded-[22px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-3">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {post.author.profile?.displayName ?? post.author.username}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{post.content || "Condivisione"}</p>
                    <div className="mt-2 flex gap-3 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                      <span>{post._count.likes} like</span>
                      <span>{post._count.comments} commenti</span>
                      <span>{post._count.shares} share</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">Nessun contenuto in evidenza per ora.</p>
              )}
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Invita</div>
            <p className="text-sm text-[var(--muted)]">Condividi un link personale o invia un invito email.</p>
            <a
              href="/invite"
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(255,120,102,0.18)] bg-[linear-gradient(180deg,#e1392f,#9f1714)] px-4 text-sm font-semibold text-[var(--accent-foreground)]"
            >
              Apri inviti
            </a>
          </Card>
        </>
      }
    >
      <PostComposer />

      {feed.length ? (
        feed.map((post) => (
          <PostCard
            key={post.id}
            post={{
              ...post,
              media: post.media.map((item) => ({ ...item, resourceType: item.resourceType })),
              shareOfPost: post.shareOfPost
                ? {
                    ...post.shareOfPost,
                    media: post.shareOfPost.media.map((item) => ({ ...item, resourceType: item.resourceType })),
                  }
                : null,
              likedByMe: Array.isArray(post.likes) && post.likes.length > 0,
            }}
            viewerUserId={user.id}
          />
        ))
      ) : (
        <Card className="p-6 text-sm text-[var(--muted)]">Il feed e vuoto. Pubblica il primo contenuto o segui nuove persone.</Card>
      )}
    </SiteShell>
  );
}
