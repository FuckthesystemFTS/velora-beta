import { Role } from "@prisma/client";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function TeamPage() {
  const user = await requireUser();
  if (user.role !== Role.MODERATOR && user.role !== Role.ADMIN && user.role !== Role.SUPERADMIN) {
    redirect("/forbidden");
  }

  const assignments = await prisma.moderationAssignment.findMany({
    where: { userId: user.id, level: "TEAM" },
    include: {
      moderationCase: {
        include: {
          post: { include: { media: true } },
          author: { include: { profile: true } },
          votes: true,
          auditLogs: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      },
    },
    orderBy: { selectedAt: "desc" },
  });

  return (
    <SiteShell sidebar={<><BrandPanel /><AppNav /></>}>
      <Card className="hero-fire p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Team review</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold leading-none">Moderation dashboard</h1>
      </Card>

      {assignments.map((assignment) => (
        <Card key={assignment.id} className="space-y-5 overflow-hidden p-0">
          <div className="hero-fire p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[var(--foreground)]">Case {assignment.moderationCase.id.slice(0, 8)}</h2>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">@{assignment.moderationCase.author.username}</p>
              </div>
              <Badge>{assignment.moderationCase.status}</Badge>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <p className="max-w-3xl text-sm leading-8 text-[var(--foreground)]">{assignment.moderationCase.post.content}</p>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="stat-tile rounded-[22px] p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Level 1 remove</p>
                <p className="mt-2 text-3xl font-semibold">
                  {assignment.moderationCase.votes.filter((item) => item.level === "LEVEL1" && item.decision === "REMOVE").length}
                </p>
              </div>
              <div className="stat-tile rounded-[22px] p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Level 2 remove</p>
                <p className="mt-2 text-3xl font-semibold">
                  {assignment.moderationCase.votes.filter((item) => item.level === "LEVEL2" && item.decision === "REMOVE").length}
                </p>
              </div>
              <div className="stat-tile rounded-[22px] p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Audit trail</p>
                <p className="mt-2 text-3xl font-semibold">{assignment.moderationCase.auditLogs.length}</p>
              </div>
            </div>

            <form action={`/api/team/decisions?assignmentId=${assignment.id}`} method="post" className="flex flex-wrap gap-3">
              <Button name="outcome" value="CONFIRM_SUSPENSION">Confirm</Button>
              <Button name="outcome" value="REMOVE_FINAL" variant="danger">Remove</Button>
              <Button name="outcome" value="RESTORE_CONTENT" variant="secondary">Keep</Button>
            </form>
          </div>
        </Card>
      ))}
    </SiteShell>
  );
}
