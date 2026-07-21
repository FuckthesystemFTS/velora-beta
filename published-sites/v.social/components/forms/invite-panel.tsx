"use client";

import { useMemo, useState } from "react";
import { Copy, Mail, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type InviteItem = {
  id: string;
  code: string;
  email: string | null;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  createdAt: string | Date;
};

export function InvitePanel({
  appUrl,
  initialInvites,
  initialPoints,
  initialAcceptedCount,
}: {
  appUrl: string;
  initialInvites: InviteItem[];
  initialPoints: number;
  initialAcceptedCount: number;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [invites, setInvites] = useState(initialInvites);
  const [points, setPoints] = useState(initialPoints);

  const latestLink = useMemo(() => {
    const invite = invites[0];
    return invite ? `${appUrl}/register?invite=${invite.code}` : `${appUrl}/register`;
  }, [appUrl, invites]);

  async function createInvite(sendEmail = false) {
    setLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendEmail ? { email } : { forceNew: true }),
    });
    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Invito non creato");
      return;
    }

    setInvites((current) => [data.invite, ...current]);
    setPoints(data.summary?.vPoints ?? points);
    setMessage(sendEmail ? "Invito inviato." : "Link invito creato.");
    if (sendEmail) {
      setEmail("");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Invita persone</h2>
            <p className="text-sm text-[var(--muted)]">Copia un link personale o invia un invito email. Ogni iscrizione completata ti assegna 1 V point.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[20px] border border-[var(--border)] bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">V points</p>
            <p className="mt-2 text-3xl font-semibold text-[var(--foreground)]">{points}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">Potranno essere convertiti in premi riscattabili sulla piattaforma.</p>
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Iscrizioni confermate</p>
            <p className="mt-2 text-3xl font-semibold text-[var(--foreground)]">{initialAcceptedCount}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">Ogni nuova registrazione valida aggiunge 1 V point.</p>
          </div>
        </div>

        <div className="rounded-[20px] border border-[var(--border)] bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Link personale</p>
          <p className="mt-2 break-all text-sm text-[var(--foreground)]">{latestLink}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={async () => {
                if (!invites.length) {
                  await createInvite(false);
                  return;
                }
                await navigator.clipboard.writeText(latestLink);
                setMessage("Link copiato.");
              }}
            >
              <Copy size={14} className="mr-2" />
              Copia link
            </Button>
            <Button type="button" variant="secondary" onClick={() => void createInvite(false)} disabled={loading}>
              Genera nuovo link
            </Button>
          </div>
        </div>

        <div className="rounded-[20px] border border-[var(--border)] bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Invio email</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email@example.com"
              className="h-11 flex-1 rounded-2xl border border-[var(--border)] bg-black/30 px-4 text-sm text-[var(--foreground)] outline-none"
            />
            <Button type="button" variant="secondary" onClick={() => void createInvite(true)} disabled={loading || !email}>
              <Mail size={14} className="mr-2" />
              Invia invito
            </Button>
          </div>
        </div>

        {message ? <p className="text-sm text-[var(--gold)]">{message}</p> : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--foreground)]">Storico inviti</h3>
          <span className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">{invites.length}</span>
        </div>
        <div className="space-y-3">
          {invites.length ? (
            invites.map((invite) => (
              <div key={invite.id} className="rounded-[20px] border border-[var(--border)] bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">{invite.email ?? "Invito via link"}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">{invite.code}</p>
                  </div>
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    {invite.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${appUrl}/register?invite=${invite.code}`);
                      setMessage("Link copiato.");
                    }}
                  >
                    <Copy size={14} className="mr-2" />
                    Copia link
                  </Button>
                  <a
                    href={`mailto:?subject=Invito a V per Verita&body=${encodeURIComponent(`${appUrl}/register?invite=${invite.code}`)}`}
                    className="inline-flex items-center rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:border-[rgba(255,120,102,0.24)] hover:text-[var(--foreground)]"
                  >
                    <Send size={14} className="mr-2" />
                    Email
                  </a>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--muted)]">Nessun invito creato per ora.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
