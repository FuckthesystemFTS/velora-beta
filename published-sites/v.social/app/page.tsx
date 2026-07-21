import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";

export default async function LandingPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/feed");
  }

  return (
    <main className="mx-auto max-w-[1320px] overflow-x-clip px-3 py-4 lg:px-6">
      <div className="grid min-h-[calc(100vh-32px)] gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="glass flex flex-col justify-between rounded-[30px] p-6 md:p-10">
          <div className="space-y-6">
            <div className="font-serif text-6xl font-semibold leading-none text-[var(--accent)] md:text-8xl">V</div>
            <div className="space-y-4">
              <h1 className="font-serif text-4xl font-semibold leading-[0.94] text-[var(--foreground)] md:text-7xl">
                V per Verita
              </h1>
              <p className="max-w-xl text-base leading-8 text-[var(--muted)]">
                Ogni voce lascia un segno. Entra, pubblica, segui chi conta davvero per te.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/login">
                <Button className="px-6 py-3 text-base">Accedi</Button>
              </Link>
              <Link href="/register">
                <Button variant="secondary" className="px-6 py-3 text-base">
                  Registrati
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid gap-3 pt-8 sm:grid-cols-3">
            {[
              ["Feed", "Subito al centro"],
              ["Live", "Persone reali, adesso"],
              ["Inviti", "Porta dentro chi vuoi"],
            ].map(([label, note]) => (
              <Card key={label} className="bg-black/20 p-4">
                <div className="text-sm font-semibold text-[var(--foreground)]">{label}</div>
                <p className="mt-2 text-sm text-[var(--muted)]">{note}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid gap-4">
          <Card className="overflow-hidden p-0">
            <div className="grid min-h-[420px] place-items-center bg-[radial-gradient(circle_at_top,rgba(213,49,39,0.22),transparent_35%),linear-gradient(180deg,rgba(17,17,24,0.9),rgba(9,9,13,0.98))] p-4 sm:p-6">
              <div className="w-full max-w-[420px] rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[rgba(9,10,13,0.86)] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)] sm:p-5">
                <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                  <div className="font-serif text-xl font-semibold text-[var(--foreground)]">V</div>
                  <div className="rounded-full bg-[rgba(255,255,255,0.06)] px-4 py-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                    Feed
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-[20px] border border-[var(--border)] bg-black/25 px-4 py-3 text-sm text-[var(--muted)]">
                    A cosa stai pensando?
                  </div>
                  <div className="rounded-[24px] border border-[var(--border)] bg-black/20 p-4">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="h-11 w-11 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(213,49,39,0.2))]" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--foreground)]">Luna Ferri</div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">@lunaferri</div>
                      </div>
                    </div>
                    <div className="h-56 rounded-[20px] bg-[radial-gradient(circle_at_50%_35%,rgba(213,49,39,0.35),transparent_0_22%),linear-gradient(180deg,#1d1e24,#0b0c10)]" />
                    <p className="mt-4 text-sm leading-7 text-[var(--foreground)]">Le storie che contano meritano spazio.</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
