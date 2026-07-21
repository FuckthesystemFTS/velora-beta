import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { PostCard } from "@/components/cards/post-card";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function SavedPage() {
  const user = await requireUser();
  const saved = await prisma.savedPost.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      post: {
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
          likes: { where: { userId: user.id }, select: { id: true } },
        },
      },
    },
  });

  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
    >
      <Card className="space-y-2">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Salvati</h1>
        <p className="text-sm text-[var(--muted)]">I post che hai messo da parte.</p>
      </Card>

      {saved.length ? (
        saved.map(({ post }) => (
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
            viewerUserId={user.id}
          />
        ))
      ) : (
        <Card className="text-sm text-[var(--muted)]">Non hai ancora salvato nessun post.</Card>
      )}
    </SiteShell>
  );
}
