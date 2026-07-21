import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

export default async function SettingsSecurityPage() {
  await requireUser();

  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
    >
      <Card className="space-y-4">
        <h1 className="font-serif text-4xl font-semibold">Sicurezza</h1>
        <ul className="space-y-3 text-sm leading-7 text-[var(--muted)]">
          <li>Password hash robuste e sessioni invalidate lato server.</li>
          <li>CSRF token sulle route mutative e cookie `HttpOnly` per la sessione.</li>
          <li>Header di sicurezza, CSP e validazione Zod sugli input critici.</li>
        </ul>
      </Card>
    </SiteShell>
  );
}
