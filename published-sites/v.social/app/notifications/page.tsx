import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { relativeTime } from "@/lib/utils";

export default async function NotificationsPage() {
  const user = await requireUser();
  const notifications = await prisma.notification.findMany({
    where: { recipientId: user.id },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
      rightRail={
        <Card className="space-y-2">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Notifiche</div>
          <p className="text-sm text-[var(--muted)]">Like, commenti, follow, inviti e aggiornamenti moderazione.</p>
        </Card>
      }
    >
      <Card>
        <h1 className="mb-4 font-serif text-4xl font-semibold">Notifiche</h1>
        <div className="space-y-3">
          {notifications.map((item) => (
            <div key={item.id} className="rounded-3xl border border-[var(--border)] bg-black/20 p-4">
              <p className="font-medium">{item.title}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">{item.body}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">{relativeTime(item.createdAt)}</p>
            </div>
          ))}
        </div>
      </Card>
    </SiteShell>
  );
}
