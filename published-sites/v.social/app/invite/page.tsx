import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { InvitePanel } from "@/components/forms/invite-panel";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { getInviteSummaryForUser } from "@/server/services/invite-service";

export default async function InvitePage() {
  const user = await requireUser();
  const summary = await getInviteSummaryForUser(user.id);

  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
      rightRail={
        <Card className="space-y-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Inviti</p>
          <p className="text-sm text-[var(--muted)]">Crea link personali, accumula V points e usa gli inviti email se SMTP e configurato.</p>
        </Card>
      }
    >
      <InvitePanel
        appUrl={env.APP_URL}
        initialInvites={summary.invites}
        initialPoints={summary.vPoints}
        initialAcceptedCount={summary.acceptedCount}
      />
    </SiteShell>
  );
}
