import { Role } from "@prisma/client";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getModerationCasesForDashboard, getPlatformOverview } from "@/server/services/dashboard-service";

export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== Role.ADMIN && user.role !== Role.SUPERADMIN) {
    redirect("/forbidden");
  }

  const [overview, cases, users] = await Promise.all([
    getPlatformOverview(),
    getModerationCasesForDashboard(),
    prisma.user.findMany({ take: 20, orderBy: { createdAt: "desc" }, include: { profile: true } }),
  ]);

  return (
    <SiteShell sidebar={<><BrandPanel /><AppNav /></>}>
      <Card className="hero-fire p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Admin</p>
            <h1 className="mt-3 font-serif text-5xl font-semibold leading-none">Control room</h1>
          </div>
          <form action="/api/admin/process-cases" method="post">
            <Button type="submit">Run queue</Button>
          </form>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {Object.entries(overview).map(([key, value]) => (
          <Card key={key} className="stat-tile p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{key}</p>
            <p className="mt-3 text-4xl font-semibold text-[var(--foreground)]">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">Recent cases</h2>
        {cases.map((item) => (
          <div key={item.id} className="rounded-[22px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-[var(--foreground)]">{item.authorUsername} - {item.postContent.slice(0, 80)}</p>
              <Badge>{item.status}</Badge>
            </div>
            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              L1 {item.level1RemoveVotes} - L2 {item.level2RemoveVotes} - Team {item.teamRemoveVotes}
            </p>
          </div>
        ))}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">Recent users</h2>
        {users.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-[22px] border border-[rgba(255,255,255,0.05)] p-4">
            <div>
              <p className="font-medium text-[var(--foreground)]">{item.profile?.displayName ?? item.username}</p>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">@{item.username}</p>
            </div>
            <Badge>{item.role}</Badge>
          </div>
        ))}
      </Card>
    </SiteShell>
  );
}
