import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

export default async function SettingsPrivacyPage() {
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
        <h1 className="font-serif text-4xl font-semibold">Privacy</h1>
        <p className="text-sm leading-7 text-[var(--muted)]">
          Dati minimi, cookie essenziali e policy chiare. I voti di moderazione restano anonimi verso l&apos;esterno ma
          auditabili internamente.
        </p>
      </Card>
    </SiteShell>
  );
}
