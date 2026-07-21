import { notFound, redirect } from "next/navigation";

import { PostCard } from "@/components/cards/post-card";
import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getPostForUser } from "@/server/services/post-service";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const post = await getPostForUser(id, user?.id);

  if (!post && !user) {
    redirect("/login");
  }

  if (!post) {
    notFound();
  }

  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
      rightRail={
        <Card className="space-y-2">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Post</p>
          <p className="text-sm text-[var(--muted)]">Link diretto al contenuto con privacy e permessi rispettati.</p>
        </Card>
      }
    >
      <PostCard
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
        viewerUserId={user?.id}
      />
    </SiteShell>
  );
}
