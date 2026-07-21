import { PersonRow } from "@/components/cards/person-row";
import { PostCard } from "@/components/cards/post-card";
import { InviteReferralCard } from "@/components/forms/invite-referral-card";
import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getInviteSummaryForUser } from "@/server/services/invite-service";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const currentUser = await requireUser();
  const query = (await searchParams).q?.trim() ?? "";
  const inviteSummary = await getInviteSummaryForUser(currentUser.id);

  const [people, posts] = query
    ? await Promise.all([
        prisma.user.findMany({
          where: {
            deletedAt: null,
            OR: [
              { username: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { profile: { is: { displayName: { contains: query, mode: "insensitive" } } } },
            ],
          },
          include: { profile: true },
          orderBy: [{ role: "desc" }, { createdAt: "desc" }],
          take: 20,
        }),
        prisma.post.findMany({
          where: {
            deletedAt: null,
            OR: [{ content: { contains: query, mode: "insensitive" } }, { hashtags: { has: `#${query.toLowerCase()}` } }],
          },
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
            likes: { where: { userId: currentUser.id }, select: { id: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      ])
    : [[], []];

  return (
    <SiteShell
      sidebar={<><BrandPanel /><AppNav /></>}
      rightRail={
        <InviteReferralCard
          appUrl={env.APP_URL}
          initialCode={inviteSummary.primaryInvite.code}
          initialPoints={inviteSummary.vPoints}
          initialAcceptedCount={inviteSummary.acceptedCount}
          compact
        />
      }
    >
      <Card className="space-y-4 p-5">
        <div>
          <h1 className="font-serif text-4xl font-semibold text-[var(--foreground)]">Ricerca</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Trova persone, username, hashtag e post.</p>
        </div>
        <form>
          <Input name="q" defaultValue={query} placeholder="Cerca persone o contenuti" />
        </form>
      </Card>

      {query ? (
        <>
          <Card className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-3xl font-semibold text-[var(--foreground)]">Persone</h2>
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">{people.length} risultati</span>
            </div>
            <div className="space-y-3">
              {people.length ? (
                people.map((person) => (
                  <PersonRow
                    key={person.id}
                    username={person.username}
                    displayName={person.profile?.displayName ?? person.username}
                    avatarUrl={person.profile?.avatarUrl}
                    bio={person.profile?.bio}
                    role={person.role}
                    showFollow={person.id !== currentUser.id}
                  />
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">Nessun profilo trovato.</p>
              )}
            </div>
          </Card>

          <div className="space-y-4">
            {posts.length ? (
              posts.map((post) => (
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
                    likedByMe: post.likes.length > 0,
                  }}
                  viewerUserId={currentUser.id}
                />
              ))
            ) : (
              <Card className="p-5 text-sm text-[var(--muted)]">Nessun post trovato per questa ricerca.</Card>
            )}
          </div>
        </>
      ) : (
        <Card className="p-5 text-sm text-[var(--muted)]">Inserisci un nome, uno username o un hashtag.</Card>
      )}
    </SiteShell>
  );
}
