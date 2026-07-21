"use client";

import { MoreHorizontal, Copy, Bookmark, Flag } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

export function PostMoreMenu({
  postId,
  canReport,
  onSave,
  onReport,
}: {
  postId: string;
  canReport: boolean;
  onSave: () => Promise<void>;
  onReport: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const currentUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/post/${postId}`;
  }, [postId]);

  return (
    <div className="relative">
      <Button type="button" variant="ghost" onClick={() => setOpen((current) => !current)} className="px-3">
        <MoreHorizontal size={16} />
      </Button>
      {open ? (
        <div className="absolute right-0 top-12 z-30 w-[220px] max-w-[calc(100vw-2rem)] rounded-[22px] border border-[var(--border)] bg-[rgba(12,12,15,0.96)] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={async () => {
              await onSave();
              setOpen(false);
            }}
          >
            <Bookmark size={15} className="mr-2" />
            Salva
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={async () => {
              await navigator.clipboard.writeText(currentUrl);
              setMessage("Link copiato.");
            }}
          >
            <Copy size={15} className="mr-2" />
            Copia link
          </Button>
          {canReport ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              onClick={async () => {
                await onReport();
                setOpen(false);
              }}
            >
              <Flag size={15} className="mr-2" />
              Segnala
            </Button>
          ) : null}
          {message ? <p className="px-3 py-2 text-sm text-[var(--gold)]">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
