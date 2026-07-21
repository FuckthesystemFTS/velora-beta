/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Heart, Pencil, Radio, ShieldQuestion, Trash2 } from "lucide-react";

import { PostComments } from "@/components/comments/post-comments";
import { PostMoreMenu } from "@/components/cards/post-more-menu";
import { PostShareMenu } from "@/components/cards/post-share-menu";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/utils";
import type { FeedPost } from "@/types/app";

function SharedPostPreview({ post }: { post: NonNullable<FeedPost["shareOfPost"]> }) {
  const leadMedia = post.media[0];

  return (
    <div className="rounded-[24px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-4">
      <div className="flex items-center gap-3">
        <Avatar name={post.author.profile?.displayName ?? post.author.username} src={post.author.profile?.avatarUrl} size={38} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">
            {post.author.profile?.displayName ?? post.author.username}
          </p>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">@{post.author.username}</p>
        </div>
      </div>

      {leadMedia ? (
        <div className="mt-3 overflow-hidden rounded-[20px] border border-[rgba(255,255,255,0.05)]">
          {leadMedia.resourceType === "IMAGE" ? (
            <img src={leadMedia.secureUrl} alt="" className="h-44 w-full object-cover md:h-56" loading="lazy" />
          ) : (
            <video src={leadMedia.secureUrl} controls className="h-44 w-full object-cover md:h-56" />
          )}
        </div>
      ) : null}

      <div className="prose-v mt-3 text-sm leading-7 text-[var(--foreground)]" dangerouslySetInnerHTML={{ __html: post.sanitizedContent }} />
    </div>
  );
}

export function PostCard({
  post,
  canReport = true,
  viewerUserId,
}: {
  post: FeedPost;
  canReport?: boolean;
  viewerUserId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editVisibility, setEditVisibility] = useState(post.visibility);
  const isOwner = viewerUserId === post.author.id;
  const leadMedia = post.media[0];

  async function like() {
    const response = await fetch(`/api/posts/${post.id}/like`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Like failed");
      return;
    }
    setMessage(null);
    router.refresh();
  }

  async function report() {
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId: post.id,
        reason: "HARASSMENT",
        reasonText: "Segnalazione dal feed.",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Report failed");
      return;
    }
    setMessage("Segnalazione registrata.");
  }

  async function savePost() {
    const response = await fetch(`/api/posts/${post.id}/save`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Save failed");
      return;
    }
    setMessage(data.saved ? "Post salvato" : "Post rimosso dai salvati");
  }

  async function shareInternal() {
    const response = await fetch(`/api/posts/${post.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Share failed");
      return;
    }
    setMessage("Post condiviso nel tuo feed");
    router.refresh();
  }

  async function saveEdit() {
    const response = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: editContent,
        visibility: editVisibility,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Update failed");
      return;
    }
    setEditing(false);
    setMessage("Post aggiornato");
    router.refresh();
  }

  async function removePost() {
    if (!confirm("Eliminare questo post?")) return;

    const response = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Delete failed");
      return;
    }

    setMessage("Post eliminato");
    router.refresh();
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <Avatar name={post.author.profile?.displayName ?? post.author.username} src={post.author.profile?.avatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link href={`/profile/${post.author.username}`} className="truncate text-[15px] font-semibold text-[var(--foreground)]">
                {post.author.profile?.displayName ?? post.author.username}
              </Link>
              {post.author.role !== "USER" ? (
                <Badge className="border-[rgba(255,88,62,0.18)] text-[var(--foreground)]">{post.author.role.replaceAll("_", " ")}</Badge>
              ) : null}
            </div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
              @{post.author.username} · {relativeTime(post.createdAt)}
            </p>
          </div>

          {isOwner ? (
            <div className="hidden items-center gap-2 md:flex">
              <Button type="button" variant="ghost" onClick={() => setEditing((current) => !current)} className="px-3">
                <Pencil size={14} className="mr-2" /> Modifica
              </Button>
              <Button type="button" variant="ghost" onClick={() => void removePost()} className="px-3 text-[var(--danger)]">
                <Trash2 size={14} className="mr-2" /> Elimina
              </Button>
            </div>
          ) : null}

          <PostMoreMenu postId={post.id} canReport={canReport && !isOwner} onSave={savePost} onReport={report} />
        </div>

        {post.status !== "ACTIVE" ? (
          <div className="mt-3">
            <Badge>
              <ShieldQuestion size={12} className="mr-2" /> {post.status}
            </Badge>
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-3 border-t border-[rgba(255,255,255,0.05)] px-4 py-4">
          <Textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} className="min-h-28" />
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={editVisibility}
              onChange={(event) => setEditVisibility(event.target.value as FeedPost["visibility"])}
              className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-2.5 text-sm"
            >
              <option value="PUBLIC">Pubblico</option>
              <option value="FOLLOWERS_ONLY">Solo follower</option>
              <option value="PRIVATE">Privato</option>
            </select>
            <Button type="button" onClick={() => void saveEdit()}>
              Salva
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Annulla
            </Button>
          </div>
        </div>
      ) : null}

      {leadMedia ? (
        <div className="overflow-hidden border-y border-[rgba(255,255,255,0.05)]">
          {leadMedia.resourceType === "IMAGE" ? (
            <img src={leadMedia.secureUrl} alt="" className="h-[240px] w-full object-cover md:h-[420px]" loading="lazy" />
          ) : (
            <video src={leadMedia.secureUrl} controls className="h-[240px] w-full bg-black object-cover md:h-[420px]" />
          )}
        </div>
      ) : null}

      <div className="space-y-4 px-4 py-4">
        {post.liveBroadcast ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[rgba(255,88,62,0.18)] bg-[rgba(213,49,39,0.08)] px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <Radio size={14} className="text-[var(--accent)]" />
                {post.liveBroadcast.status === "ACTIVE" ? "Diretta in corso" : "Diretta registrata"}
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {post.liveBroadcast.status === "ACTIVE"
                  ? "Visibile anche nella sezione Live."
                  : "Disponibile per 7 giorni dalla chiusura."}
              </p>
            </div>
            <Link
              href={`/post/${post.id}`}
              className="inline-flex rounded-2xl border border-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]"
            >
              Apri live
            </Link>
          </div>
        ) : null}

        {post.sanitizedContent ? (
          <div className="prose-v text-[15px] leading-8 text-[var(--foreground)]" dangerouslySetInnerHTML={{ __html: post.sanitizedContent }} />
        ) : null}

        {post.shareOfPost ? <SharedPostPreview post={post.shareOfPost} /> : null}

        {post.media.length > 1 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {post.media.slice(1).map((item) =>
              item.resourceType === "IMAGE" ? (
                <img key={item.id} src={item.secureUrl} alt="" className="h-32 w-full rounded-[20px] object-cover" loading="lazy" />
              ) : (
                <video key={item.id} src={item.secureUrl} controls className="h-32 w-full rounded-[20px] bg-black object-cover" />
              ),
            )}
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 border-t border-[rgba(255,255,255,0.05)] px-4 py-3 text-sm text-[var(--muted)] sm:flex sm:flex-wrap sm:items-center">
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button type="button" variant="ghost" onClick={() => void like()} className="min-w-0 justify-start px-3">
            <Heart size={15} className="mr-2" /> {post._count.likes}
          </Button>
          <div className="min-w-0 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5 text-sm font-semibold text-[var(--muted)]">
            {post._count.comments} commenti
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 items-center gap-2 sm:ml-auto sm:flex sm:min-w-fit sm:items-center">
          <PostShareMenu postId={post.id} onRepost={shareInternal} />
          <Link
            href={`/post/${post.id}`}
            className="inline-flex min-w-0 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--foreground)] sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:text-xs sm:tracking-[0.14em]"
          >
            Apri post
          </Link>
        </div>
      </div>

      <PostComments postId={post.id} initialCount={post._count.comments} />

      {message ? <p className="px-4 pb-4 text-sm text-[var(--gold)]">{message}</p> : null}
      {error ? <p className="px-4 pb-4 text-sm text-[var(--danger)]">{error}</p> : null}
    </Card>
  );
}
