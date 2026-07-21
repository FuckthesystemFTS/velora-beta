import { notFound } from "next/navigation";

import { PostCard } from "@/components/cards/post-card";
import { FollowButton } from "@/components/forms/follow-button";
import { InviteReferralCard } from "@/components/forms/invite-referral-card";
import { ProfileEditor } from "@/components/forms/profile-editor";
import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getInviteSummaryForUser } from "@/server/services/invite-service";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const currentUser = await requireUser();
  const { username } = await params;
  const inviteSummary = await getInviteSummaryForUser(currentUser.id);
  const user = await prisma.user.findUnique({
    where: { username },
    include: {
      profile: true,
      posts: {
        where: { deletedAt: null },
        include: {
          author: { include: { profile: true } },
          media: true,
          shareOfPost: {
            include: {
              author: { include: { profile: true } },
              media: true,
              _count: { select: { likes: true, comments: true, shares: true } },
            },
          },
          _count: { select: { likes: true, comments: true, shares: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      followers: true,
      following: true,
    },
  });

  if (!user) notFound();
  const isOwner = user.id === currentUser.id;
  const mediaPosts = user.posts.filter((post) => post.media.length > 0);

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
          <InviteReferralCard
            appUrl={env.APP_URL}
            initialCode={inviteSummary.primaryInvite.code}
            initialPoints={inviteSummary.vPoints}
            initialAcceptedCount={inviteSummary.acceptedCount}
            compact={!isOwner}
          />
          {isOwner ? (
            <ProfileEditor
              displayName={user.profile?.displayName ?? user.username}
              bio={user.profile?.bio ?? null}
              location={user.profile?.location ?? null}
              website={user.profile?.website ?? null}
              avatarUrl={user.profile?.avatarUrl ?? null}
              avatarPublicId={user.profile?.avatarPublicId ?? null}
              coverUrl={user.profile?.coverUrl ?? null}
              coverPublicId={user.profile?.coverPublicId ?? null}
            />
          ) : null}
          <Card className="space-y-3 p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Media</div>
            <p className="text-sm text-[var(--muted)]">{mediaPosts.length} post con immagini o video.</p>
          </Card>
        </>
      }
    >
      <Card className="hero-fire space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={user.profile?.displayName ?? user.username} src={user.profile?.avatarUrl} size={84} />
          <div>
            <h1 className="font-serif text-5xl font-semibold leading-none">{user.profile?.displayName ?? user.username}</h1>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">@{user.username}</p>
          </div>
          {user.role !== "USER" ? (
            <Badge className="ml-auto border-[rgba(255,88,62,0.22)] text-[var(--foreground)]">{user.role.replaceAll("_", " ")}</Badge>
          ) : null}
          {!isOwner ? <FollowButton username={user.username} /> : null}
        </div>
        <p className="max-w-2xl text-sm leading-8 text-[var(--foreground)]">{user.profile?.bio ?? "Profilo senza biografia."}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="stat-tile p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Post</p>
            <p className="mt-2 text-4xl font-semibold">{user.posts.length}</p>
          </Card>
          <Card className="stat-tile p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Follower</p>
            <p className="mt-2 text-4xl font-semibold">{user.followers.length}</p>
          </Card>
          <Card className="stat-tile p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Seguiti</p>
            <p className="mt-2 text-4xl font-semibold">{user.following.length}</p>
          </Card>
        </div>
      </Card>
      {user.posts.map((post) => (
        <PostCard key={post.id} post={post as never} viewerUserId={currentUser.id} />
      ))}
    </SiteShell>
  );
}
