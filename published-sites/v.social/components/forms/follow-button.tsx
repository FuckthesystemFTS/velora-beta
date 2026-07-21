"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function FollowButton({ username, compact = false }: { username: string; compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    setLoading(true);
    setMessage(null);
    const response = await fetch(`/api/users/${username}/follow`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Errore");
      setLoading(false);
      return;
    }
    setMessage(data.following ? "Seguito" : "Non segui piu");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        onClick={() => void toggle()}
        disabled={loading}
        variant={compact ? "ghost" : "secondary"}
        className={compact ? "h-10 px-3" : undefined}
      >
        {loading ? "..." : "Segui"}
      </Button>
      {!compact && message ? <span className="text-xs text-[var(--muted)]">{message}</span> : null}
    </div>
  );
}
