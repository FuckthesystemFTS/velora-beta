import { Role } from "@prisma/client";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitTeamDecision } from "@/server/services/moderation-service";

export async function POST(request: Request) {
  const user = await requireUser();
  if (user.role !== Role.MODERATOR && user.role !== Role.ADMIN && user.role !== Role.SUPERADMIN) {
    redirect("/forbidden");
  }

  const url = new URL(request.url);
  const assignmentId = url.searchParams.get("assignmentId");
  const formData = await request.formData();
  const outcome = String(formData.get("outcome"));

  if (!assignmentId) {
    redirect("/team?error=missing-assignment");
  }

  const assignment = await prisma.moderationAssignment.findUnique({ where: { id: assignmentId } });

  if (!assignment) {
    redirect("/team?error=not-found");
  }

  await submitTeamDecision(user.id, {
    caseId: assignment.moderationCaseId,
    outcome,
  });

  redirect("/team?success=1");
}
