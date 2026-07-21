"use client";

import { useMemo, useState } from "react";
import { Copy, Send, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PostShareMenu({
  postId,
  onRepost,
}: {
  postId: string;
  onRepost: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return `/post/${postId}`;
    }

    return `${window.location.origin}/post/${postId}`;
  }, [postId]);

  const encodedUrl = encodeURIComponent(shareUrl);

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    setMessage("Link copiato.");
  }

  async function webShare() {
    if (navigator.share) {
      await navigator.share({
        title: "V per Verita",
        url: shareUrl,
      });
      return;
    }

    await copyLink();
  }

  return (
    <div className="relative min-w-0">
      <Button type="button" variant="ghost" onClick={() => setOpen((current) => !current)} className="w-full min-w-0 justify-center px-3 sm:w-auto">
        <Share2 size={15} className="sm:mr-2" />
        <span className="hidden sm:inline">Condividi</span>
      </Button>

      {open ? (
        <div className="absolute right-0 top-12 z-30 w-[280px] max-w-[calc(100vw-2rem)] rounded-[24px] border border-[var(--border)] bg-[rgba(12,12,15,0.96)] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
          <div className="space-y-2">
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => void onRepost()}>
              <Send size={15} className="mr-2" />
              Repost interno
            </Button>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => void copyLink()}>
              <Copy size={15} className="mr-2" />
              Copia link
            </Button>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => void webShare()}>
              <Share2 size={15} className="mr-2" />
              Share rapido
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <a href={`https://wa.me/?text=${encodedUrl}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-[var(--border)] px-3 py-2 text-center text-[var(--muted)] hover:text-[var(--foreground)]">
              WhatsApp
            </a>
            <a href={`https://t.me/share/url?url=${encodedUrl}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-[var(--border)] px-3 py-2 text-center text-[var(--muted)] hover:text-[var(--foreground)]">
              Telegram
            </a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-[var(--border)] px-3 py-2 text-center text-[var(--muted)] hover:text-[var(--foreground)]">
              Facebook
            </a>
            <a href={`https://twitter.com/intent/tweet?url=${encodedUrl}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-[var(--border)] px-3 py-2 text-center text-[var(--muted)] hover:text-[var(--foreground)]">
              X
            </a>
            <a href={`mailto:?subject=V per Verita&body=${encodedUrl}`} className="rounded-2xl border border-[var(--border)] px-3 py-2 text-center text-[var(--muted)] hover:text-[var(--foreground)]">
              Email
            </a>
            <a href={`/post/${postId}`} className="rounded-2xl border border-[var(--border)] px-3 py-2 text-center text-[var(--muted)] hover:text-[var(--foreground)]">
              Apri post
            </a>
          </div>

          {message ? <p className="mt-3 text-sm text-[var(--gold)]">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
