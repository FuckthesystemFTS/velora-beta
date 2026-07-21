"use client";

import Link from "next/link";
import { Copy, Gift, Sparkles, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function InviteReferralCard({
  appUrl,
  initialCode,
  initialPoints,
  initialAcceptedCount,
  compact = false,
}: {
  appUrl: string;
  initialCode: string;
  initialPoints: number;
  initialAcceptedCount: number;
  compact?: boolean;
}) {
  const [code, setCode] = useState(initialCode);
  const [points, setPoints] = useState(initialPoints);
  const [acceptedCount] = useState(initialAcceptedCount);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const link = useMemo(() => `${appUrl}/register?invite=${code}`, [appUrl, code]);

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    setMessage("Link invito copiato.");
    setError(null);
  }

  async function refreshLink() {
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceNew: true }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Link invito non disponibile.");
        return;
      }

      setCode(data.invite.code);
      setPoints(data.summary?.vPoints ?? points);
      setMessage("Link invito pronto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Invita un amico</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--foreground)]">Link referral personale</h3>
        </div>
        <span className="inline-flex items-center rounded-full border border-[rgba(255,255,255,0.08)] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
          <Gift size={12} className="mr-2 text-[var(--accent)]" />
          {points} V point{points === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-sm leading-7 text-[var(--muted)]">
        Ogni iscrizione completata con il tuo link ti assegna 1 V point. I V points potranno essere convertiti in premi riscattabili sulla piattaforma.
      </p>

      {!compact ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[20px] border border-[var(--border)] bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Iscrizioni riuscite</div>
            <div className="mt-2 text-3xl font-semibold text-[var(--foreground)]">{acceptedCount}</div>
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">V points</div>
            <div className="mt-2 flex items-center text-3xl font-semibold text-[var(--foreground)]">
              <Sparkles size={18} className="mr-2 text-[var(--accent)]" />
              {points}
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-[20px] border border-[var(--border)] bg-black/20 p-4">
        <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Il tuo link</div>
        <p className="mt-2 break-all text-sm leading-7 text-[var(--foreground)]">{link}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={() => void copyLink()} disabled={loading}>
          <Copy size={14} className="mr-2" />
          Copia link
        </Button>
        <Button type="button" variant="secondary" onClick={() => void refreshLink()} disabled={loading}>
          <UserPlus size={14} className="mr-2" />
          {loading ? "Preparo..." : "Rigenera"}
        </Button>
        <Link
          href="/invite"
          className="inline-flex items-center rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:border-[rgba(255,120,102,0.24)] hover:text-[var(--foreground)]"
        >
          Apri inviti
        </Link>
      </div>

      {message ? <p className="text-sm text-[var(--gold)]">{message}</p> : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </Card>
  );
}
