"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/utils";

export function ModerationTaskCard({
  assignmentId,
  title,
  body,
  expiresAt,
  alreadyVoted,
  endpoint,
}: {
  assignmentId: string;
  title: string;
  body: string;
  expiresAt: Date;
  alreadyVoted: boolean;
  endpoint: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(decision: string) {
    const response = await fetch(endpoint.replace(":id", assignmentId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Vote failed");
      return;
    }
    router.refresh();
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="hero-fire p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="max-w-xl text-2xl font-semibold leading-tight text-[var(--foreground)]">{title}</h3>
          <Badge>{relativeTime(expiresAt)}</Badge>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <p className="max-w-3xl text-sm leading-8 text-[var(--foreground)]">{body}</p>
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note"
          className="border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]"
        />
        <div className="flex gap-3">
          <Button disabled={alreadyVoted} onClick={() => void send("REMOVE")}>
            Remove it
          </Button>
          <Button disabled={alreadyVoted} variant="secondary" onClick={() => void send("KEEP")}>
            Keep it
          </Button>
        </div>
        {alreadyVoted ? <p className="text-sm text-[var(--gold)]">Vote locked.</p> : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </div>
    </Card>
  );
}
