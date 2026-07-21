import Link from "next/link";

import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function SettingsPage() {
  const user = await requireUser();
  const sessions = await prisma.session.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });

  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
    >
      <Card className="space-y-6">
        <h1 className="font-serif text-4xl font-semibold">Impostazioni account</h1>
        <div className="grid gap-4 md:grid-cols-3">
          <Link href="/settings/privacy">
            <Card className="h-full bg-black/20">Privacy</Card>
          </Link>
          <Link href="/settings/security">
            <Card className="h-full bg-black/20">Sicurezza</Card>
          </Link>
          <Link href="/install-app">
            <Card className="h-full bg-black/20">Installa app</Card>
          </Link>
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Sessioni attive</h2>
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center justify-between rounded-3xl border border-[var(--border)] p-4">
              <div>
                <p className="font-medium">{session.userAgent ?? "Browser"}</p>
                <p className="text-xs text-[var(--muted)]">{session.ipAddress ?? "IP sconosciuto"}</p>
              </div>
              <Badge>Scade {session.expiresAt.toLocaleDateString("it-IT")}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </SiteShell>
  );
}
