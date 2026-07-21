"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquareReply, Send } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/utils";

type CommentItem = {
  id: string;
  content: string;
  sanitizedContent: string;
  createdAt: string | Date;
  parentCommentId: string | null;
  author: {
    username: string;
    profile: {
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
};

function CommentNode({
  comment,
  replies,
  onReply,
}: {
  comment: CommentItem;
  replies: CommentItem[];
  onReply: (parentCommentId: string, content: string) => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");

  return (
    <div className="space-y-3 rounded-[22px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] p-4">
      <div className="flex items-center gap-3">
        <Avatar
          name={comment.author.profile?.displayName ?? comment.author.username}
          src={comment.author.profile?.avatarUrl}
          size={36}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">
            {comment.author.profile?.displayName ?? comment.author.username}
          </p>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            @{comment.author.username} · {relativeTime(comment.createdAt)}
          </p>
        </div>
      </div>

      <div
        className="prose-v text-sm leading-7 text-[var(--foreground)]"
        dangerouslySetInnerHTML={{ __html: comment.sanitizedContent }}
      />

      <button
        type="button"
        className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)] transition hover:text-[var(--foreground)]"
        onClick={() => setReplying((current) => !current)}
      >
        <MessageSquareReply size={14} />
        Rispondi
      </button>

      {replying ? (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reply.trim()) return;
            await onReply(comment.id, reply);
            setReply("");
            setReplying(false);
          }}
        >
          <Textarea value={reply} onChange={(event) => setReply(event.target.value)} className="min-h-24" placeholder="Scrivi una risposta..." />
          <Button type="submit" variant="secondary">
            <Send size={14} className="mr-2" />
            Invia
          </Button>
        </form>
      ) : null}

      {replies.length ? (
        <div className="space-y-3 border-l border-[rgba(255,255,255,0.06)] pl-4">
          {replies.map((replyItem) => (
            <div key={replyItem.id} className="space-y-2 rounded-[18px] bg-black/20 p-3">
              <div className="flex items-center gap-3">
                <Avatar
                  name={replyItem.author.profile?.displayName ?? replyItem.author.username}
                  src={replyItem.author.profile?.avatarUrl}
                  size={28}
                />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--foreground)]">
                    {replyItem.author.profile?.displayName ?? replyItem.author.username}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    @{replyItem.author.username} · {relativeTime(replyItem.createdAt)}
                  </p>
                </div>
              </div>
              <div
                className="prose-v text-sm leading-6 text-[var(--foreground)]"
                dangerouslySetInnerHTML={{ __html: replyItem.sanitizedContent }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PostComments({ postId, initialCount }: { postId: string; initialCount: number }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open || comments.length || loading) return;

    void (async () => {
      setLoading(true);
      const response = await fetch(`/api/posts/${postId}/comments`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Commenti non disponibili");
        setLoading(false);
        return;
      }

      setComments(data.comments);
      setLoading(false);
    })();
  }, [comments.length, loading, open, postId]);

  const grouped = useMemo(() => {
    const roots = comments.filter((comment) => !comment.parentCommentId);
    const replies = new Map<string, CommentItem[]>();

    comments
      .filter((comment) => comment.parentCommentId)
      .forEach((comment) => {
        const key = comment.parentCommentId as string;
        replies.set(key, [...(replies.get(key) ?? []), comment]);
      });

    return { roots, replies };
  }, [comments]);

  async function submitComment(parentCommentId: string | null, text: string) {
    const response = await fetch(`/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: text,
        parentCommentId,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Commento non salvato");
      return;
    }

    setComments((current) => [...current, data.comment]);
    setError(null);
  }

  return (
    <div className="border-t border-[rgba(255,255,255,0.05)] px-4 py-4">
      <button
        type="button"
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
        onClick={() => setOpen((current) => !current)}
      >
        <MessageSquareReply size={16} />
        Commenti ({comments.length || initialCount})
      </button>

      {open ? (
        <div className="mt-4 space-y-4">
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!content.trim()) return;
              await submitComment(null, content);
              setContent("");
            }}
          >
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-24"
              placeholder="Scrivi un commento..."
            />
            <Button type="submit" variant="secondary">
              <Send size={14} className="mr-2" />
              Commenta
            </Button>
          </form>

          {loading ? <p className="text-sm text-[var(--muted)]">Caricamento commenti...</p> : null}
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

          <div className="space-y-4">
            {grouped.roots.map((comment) => (
              <CommentNode
                key={comment.id}
                comment={comment}
                replies={grouped.replies.get(comment.id) ?? []}
                onReply={(parentCommentId, text) => submitComment(parentCommentId, text)}
              />
            ))}
            {!loading && !grouped.roots.length ? <p className="text-sm text-[var(--muted)]">Nessun commento per ora.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
