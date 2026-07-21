import { ModerationAssignmentLevel, Role } from "@prisma/client";

import { ModerationTaskCard } from "@/components/cards/moderation-task-card";
import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ModerationInboxPage() {
  const user = await requireUser();
  const assignments = await prisma.moderationAssignment.findMany({
    where: {
      userId: user.id,
      level: { in: [ModerationAssignmentLevel.LEVEL1, ModerationAssignmentLevel.LEVEL2] },
    },
    include: {
      moderationCase: { include: { post: true } },
      vote: true,
    },
    orderBy: { selectedAt: "desc" },
  });

  return (
    <SiteShell sidebar={<><BrandPanel /><AppNav /></>} rightRail={<Card>Inbox semplice: una domanda, un voto, un solo invio.</Card>}>
      <Card>
        <h1 className="font-serif text-4xl font-semibold">Inbox giuria</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          I tuoi voti sono anonimi verso gli utenti esterni. Nessuno può rivotare.
        </p>
      </Card>
      {assignments
        .filter((item) => item.level === ModerationAssignmentLevel.LEVEL1 || user.role !== Role.USER)
        .map((item) => (
          <ModerationTaskCard
            key={item.id}
            assignmentId={item.id}
            title={item.level === "LEVEL1" ? "Secondo te questo post va rimosso?" : "Viola regole o legge e va rimosso?"}
            body={item.moderationCase.post.content}
            expiresAt={item.expiresAt}
            alreadyVoted={Boolean(item.vote)}
            endpoint="/api/moderation/assignments/:id/vote"
          />
        ))}
    </SiteShell>
  );
}
