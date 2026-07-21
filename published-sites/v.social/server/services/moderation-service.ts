import {
  AuditActorType,
  ModerationAssignmentLevel,
  ModerationAssignmentStatus,
  ModerationCaseStatus,
  NotificationType,
  PostStatus,
  Role,
  TeamDecisionOutcome,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { resolveTeamOutcome, summarizeVotes } from "@/server/moderation/rules";
import { type JuryCandidate, selectJurors } from "@/server/moderation/selection";
import { auditLog } from "@/server/services/audit-service";
import { getSystemConfig } from "@/server/services/config-service";
import { createNotification } from "@/server/services/notification-service";
import { feedbackSchema, reportSchema, teamDecisionSchema, voteSchema } from "@/server/services/schemas";

async function buildCandidatePool() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: {
      blockedUsers: true,
      blockedByUsers: true,
      assignedCases: {
        where: { status: ModerationAssignmentStatus.PENDING },
      },
    },
  });

  return users.map<JuryCandidate>((user) => ({
    id: user.id,
    role: user.role,
    createdAt: user.createdAt,
    isSuspended: user.isSuspended,
    juryEligibilityLocked: user.juryEligibilityLocked,
    blockedIds: user.blockedUsers.map((item) => item.blockedId),
    blockedByIds: user.blockedByUsers.map((item) => item.blockerId),
    pendingVotes: user.assignedCases.length,
    recentAssignments: 0,
  }));
}

async function assignLevel(caseId: string, level: ModerationAssignmentLevel) {
  const config = await getSystemConfig();
  const moderationCase = await prisma.moderationCase.findUniqueOrThrow({
    where: { id: caseId },
    include: { assignments: true },
  });
  const excludedIds = moderationCase.assignments.map((item) => item.userId);
  const count =
    level === ModerationAssignmentLevel.LEVEL1
      ? config.numJurorsLevel1
      : level === ModerationAssignmentLevel.LEVEL2
        ? config.numJurorsLevel2
        : config.numTeamReviewers;

  let selected: JuryCandidate[] = [];

  if (level === ModerationAssignmentLevel.TEAM) {
    const team = await prisma.user.findMany({
      where: {
        id: { notIn: excludedIds.concat([moderationCase.authorId, moderationCase.reporterId]) },
        role: { in: [Role.MODERATOR, Role.ADMIN, Role.SUPERADMIN] },
        isSuspended: false,
      },
      take: count,
      orderBy: { createdAt: "asc" },
    });

    selected = team.map((user) => ({
      id: user.id,
      role: user.role,
      createdAt: user.createdAt,
      isSuspended: user.isSuspended,
      juryEligibilityLocked: false,
      blockedIds: [],
      blockedByIds: [],
      pendingVotes: 0,
      recentAssignments: 0,
    }));
  } else {
    selected = selectJurors({
      candidates: await buildCandidatePool(),
      level,
      count,
      seed: moderationCase.lastSelectionSeed ?? randomUUID(),
      authorId: moderationCase.authorId,
      reporterId: moderationCase.reporterId,
      excludedIds,
      minimumAccountAgeHours: config.minAccountAgeHoursJury,
      minimumVerifiedAgeHours: config.minVerifiedAgeHours,
      maxPendingVotes: config.maxVotesPendingPerUser,
    });
  }

  const deadline = new Date(Date.now() + config.voteTimeoutMinutes * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    for (const user of selected) {
      await tx.moderationAssignment.upsert({
        where: {
          moderationCaseId_userId_level: {
            moderationCaseId: caseId,
            userId: user.id,
            level,
          },
        },
        create: {
          moderationCaseId: caseId,
          userId: user.id,
          level,
          expiresAt: deadline,
        },
        update: {},
      });

      await tx.notification.create({
        data: {
          recipientId: user.id,
          type: level === ModerationAssignmentLevel.TEAM ? NotificationType.TEAM_TASK : NotificationType.MODERATION_TASK,
          title: level === ModerationAssignmentLevel.TEAM ? "Caso interno da decidere" : "Nuovo task di giuria",
          body: "È disponibile una revisione di moderazione nella tua inbox.",
          link: level === ModerationAssignmentLevel.TEAM ? "/team" : "/moderation/inbox",
        },
      });
    }

    await tx.moderationCase.update({
      where: { id: caseId },
      data: {
        status:
          level === ModerationAssignmentLevel.LEVEL1
            ? ModerationCaseStatus.LEVEL1_PENDING
            : level === ModerationAssignmentLevel.LEVEL2
              ? ModerationCaseStatus.LEVEL2_PENDING
              : ModerationCaseStatus.TEAM_PENDING,
        level,
        lastSelectionSeed: randomUUID(),
        level1DeadlineAt: level === ModerationAssignmentLevel.LEVEL1 ? deadline : undefined,
        level2DeadlineAt: level === ModerationAssignmentLevel.LEVEL2 ? deadline : undefined,
        teamDeadlineAt: level === ModerationAssignmentLevel.TEAM ? deadline : undefined,
      },
    });
  });

  await auditLog({
    actorType: AuditActorType.SYSTEM,
    action: `assign_${level.toLowerCase()}`,
    entityType: "ModerationCase",
    entityId: caseId,
    moderationCaseId: caseId,
    metadata: { selectedUserIds: selected.map((item) => item.id) },
  });
}

export async function createReportCase(reporterId: string, input: unknown) {
  const config = await getSystemConfig();
  const parsed = reportSchema.parse(input);
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: parsed.postId },
    include: { author: true },
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const reportsToday = await prisma.report.count({
    where: { reporterId, createdAt: { gte: todayStart } },
  });
  if (reportsToday >= config.maxReportsPerDay) {
    throw new Error("Hai raggiunto il limite giornaliero di segnalazioni.");
  }

  const lastReport = await prisma.report.findFirst({
    where: { reporterId, postId: parsed.postId },
    orderBy: { createdAt: "desc" },
  });
  if (lastReport && Date.now() - lastReport.createdAt.getTime() < config.reportCooldownMinutes * 60 * 1000) {
    throw new Error("Attendi prima di segnalare di nuovo questo contenuto.");
  }

  const existingCase = await prisma.moderationCase.findFirst({
    where: {
      postId: parsed.postId,
      status: {
        in: [
          ModerationCaseStatus.OPEN,
          ModerationCaseStatus.LEVEL1_PENDING,
          ModerationCaseStatus.LEVEL2_PENDING,
          ModerationCaseStatus.TEAM_PENDING,
          ModerationCaseStatus.SUSPENDED_TEMP,
        ],
      },
    },
  });

  const moderationCase =
    existingCase ??
    (await prisma.moderationCase.create({
      data: {
        postId: parsed.postId,
        authorId: post.authorId,
        reporterId,
        status: ModerationCaseStatus.OPEN,
      },
    }));

  const report = await prisma.report.create({
    data: {
      reporterId,
      postId: parsed.postId,
      reason: parsed.reason,
      reasonText: parsed.reasonText ?? null,
      moderationCaseId: moderationCase.id,
    },
  });

  await auditLog({
    actorId: reporterId,
    actorType: AuditActorType.USER,
    action: "report_created",
    entityType: "Report",
    entityId: report.id,
    moderationCaseId: moderationCase.id,
    metadata: { postId: parsed.postId, reason: parsed.reason },
  });

  if (!existingCase) {
    await assignLevel(moderationCase.id, ModerationAssignmentLevel.LEVEL1);
  }

  return report;
}

async function expireAndReplaceAssignments(caseId: string, level: ModerationAssignmentLevel) {
  const config = await getSystemConfig();
  const assignments = await prisma.moderationAssignment.findMany({
    where: { moderationCaseId: caseId, level },
  });

  const expiredPending = assignments.filter(
    (assignment) => assignment.status === ModerationAssignmentStatus.PENDING && assignment.expiresAt.getTime() < Date.now(),
  );

  if (!expiredPending.length) return;

  await prisma.moderationAssignment.updateMany({
    where: { id: { in: expiredPending.map((item) => item.id) } },
    data: { status: ModerationAssignmentStatus.EXPIRED },
  });

  const targetCount =
    level === ModerationAssignmentLevel.LEVEL1
      ? config.numJurorsLevel1
      : level === ModerationAssignmentLevel.LEVEL2
        ? config.numJurorsLevel2
        : config.numTeamReviewers;
  const activeCount = await prisma.moderationAssignment.count({
    where: {
      moderationCaseId: caseId,
      level,
      status: { in: [ModerationAssignmentStatus.PENDING, ModerationAssignmentStatus.VOTED] },
    },
  });

  if (activeCount < targetCount) {
    await assignLevel(caseId, level);
  }
}

export async function submitModerationVote(userId: string, assignmentId: string, input: unknown) {
  const parsed = voteSchema.parse(input);
  const assignment = await prisma.moderationAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: { moderationCase: true },
  });

  if (assignment.userId !== userId) {
    throw new Error("Assegnazione non tua.");
  }
  if (assignment.status !== ModerationAssignmentStatus.PENDING) {
    throw new Error("Il task non è più votabile.");
  }
  if (assignment.expiresAt.getTime() < Date.now()) {
    await prisma.moderationAssignment.update({
      where: { id: assignment.id },
      data: { status: ModerationAssignmentStatus.EXPIRED },
    });
    throw new Error("Il task è scaduto.");
  }

  const vote = await prisma.$transaction(async (tx) => {
    const existing = await tx.moderationVote.findUnique({ where: { assignmentId } });
    if (existing) {
      throw new Error("Voto già registrato.");
    }

    const created = await tx.moderationVote.create({
      data: {
        moderationCaseId: assignment.moderationCaseId,
        assignmentId,
        voterId: userId,
        level: assignment.level,
        decision: parsed.decision,
        note: parsed.note ?? null,
      },
    });

    await tx.moderationAssignment.update({
      where: { id: assignmentId },
      data: { status: ModerationAssignmentStatus.VOTED, votedAt: new Date() },
    });

    return created;
  });

  await auditLog({
    actorId: userId,
    actorType: assignment.level === ModerationAssignmentLevel.TEAM ? AuditActorType.TEAM : AuditActorType.USER,
    action: `vote_${assignment.level.toLowerCase()}`,
    entityType: "ModerationVote",
    entityId: vote.id,
    moderationCaseId: assignment.moderationCaseId,
    metadata: { decision: parsed.decision },
  });

  await processModerationCase(assignment.moderationCaseId);
  return vote;
}

export async function submitTeamDecision(userId: string, input: unknown) {
  const parsed = teamDecisionSchema.parse(input);
  const assignment = await prisma.moderationAssignment.findFirstOrThrow({
    where: {
      moderationCaseId: parsed.caseId,
      userId,
      level: ModerationAssignmentLevel.TEAM,
    },
  });
  if (assignment.status !== ModerationAssignmentStatus.PENDING) {
    throw new Error("Decisione già inviata.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.teamDecision.create({
      data: {
        moderationCaseId: parsed.caseId,
        reviewerId: userId,
        outcome: parsed.outcome,
        note: parsed.note ?? null,
      },
    });

    await tx.moderationAssignment.update({
      where: { id: assignment.id },
      data: { status: ModerationAssignmentStatus.VOTED, votedAt: new Date() },
    });
  });

  await auditLog({
    actorId: userId,
    actorType: AuditActorType.TEAM,
    action: "team_decision_submitted",
    entityType: "ModerationCase",
    entityId: parsed.caseId,
    moderationCaseId: parsed.caseId,
    metadata: { outcome: parsed.outcome },
  });

  await processModerationCase(parsed.caseId);
}

export async function submitUserFeedback(userId: string, input: unknown) {
  const parsed = feedbackSchema.parse(input);
  return prisma.userFeedback.create({
    data: {
      userId,
      moderationCaseId: parsed.moderationCaseId ?? null,
      message: parsed.message,
    },
  });
}

export async function processModerationCase(caseId: string) {
  const config = await getSystemConfig();
  const moderationCase = await prisma.moderationCase.findUniqueOrThrow({
    where: { id: caseId },
    include: {
      post: true,
      assignments: true,
      votes: true,
      teamDecisions: true,
    },
  });

  await expireAndReplaceAssignments(caseId, moderationCase.level);

  const activeAssignments = moderationCase.assignments.filter(
    (assignment) => assignment.level === moderationCase.level && assignment.status !== ModerationAssignmentStatus.REPLACED,
  );
  const votedAssignments = activeAssignments.filter((assignment) => assignment.status === ModerationAssignmentStatus.VOTED);
  const votes = moderationCase.votes.filter((vote) => vote.level === moderationCase.level);
  const allDone = activeAssignments.length > 0 && votedAssignments.length >= activeAssignments.length;
  const deadlineReached = activeAssignments.some((assignment) => assignment.expiresAt.getTime() < Date.now());

  if (!allDone && !deadlineReached) return moderationCase;

  if (moderationCase.level === ModerationAssignmentLevel.LEVEL1) {
    const removeVotes = summarizeVotes(votes.map((vote) => vote.decision)).remove;
    if (removeVotes >= config.level1Threshold) {
      await assignLevel(caseId, ModerationAssignmentLevel.LEVEL2);
    } else {
      await prisma.moderationCase.update({
        where: { id: caseId },
        data: { status: ModerationCaseStatus.LEVEL1_CLOSED_KEEP, closedAt: new Date() },
      });
    }
  }

  if (moderationCase.level === ModerationAssignmentLevel.LEVEL2) {
    const removeVotes = summarizeVotes(votes.map((vote) => vote.decision)).remove;
    if (removeVotes >= config.level2Threshold) {
      await prisma.$transaction(async (tx) => {
        await tx.moderationCase.update({
          where: { id: caseId },
          data: {
            status: config.tempSuspensionEnabled ? ModerationCaseStatus.SUSPENDED_TEMP : ModerationCaseStatus.TEAM_PENDING,
            tempSuspendedAt: config.tempSuspensionEnabled ? new Date() : null,
          },
        });
        if (config.tempSuspensionEnabled) {
          await tx.post.update({
            where: { id: moderationCase.postId },
            data: { status: PostStatus.TEMP_SUSPENDED },
          });
        }
      });
      await assignLevel(caseId, ModerationAssignmentLevel.TEAM);
    } else {
      await prisma.moderationCase.update({
        where: { id: caseId },
        data: { status: ModerationCaseStatus.LEVEL2_CLOSED_KEEP, closedAt: new Date() },
      });
    }
  }

  if (moderationCase.level === ModerationAssignmentLevel.TEAM) {
    const outcome = resolveTeamOutcome(
      moderationCase.teamDecisions.map((decision) => decision.outcome),
      config.teamThreshold,
    );
    if (!outcome) return moderationCase;

    if (outcome === TeamDecisionOutcome.REMOVE_FINAL || outcome === TeamDecisionOutcome.CONFIRM_SUSPENSION) {
      await prisma.$transaction(async (tx) => {
        await tx.moderationCase.update({
          where: { id: caseId },
          data: {
            status:
              outcome === TeamDecisionOutcome.REMOVE_FINAL
                ? ModerationCaseStatus.REMOVED_FINAL
                : ModerationCaseStatus.SUSPENDED_TEMP,
            closedAt: outcome === TeamDecisionOutcome.REMOVE_FINAL ? new Date() : null,
            finalReason: outcome,
          },
        });
        await tx.post.update({
          where: { id: moderationCase.postId },
          data: { status: outcome === TeamDecisionOutcome.REMOVE_FINAL ? PostStatus.REMOVED : PostStatus.TEMP_SUSPENDED },
        });
      });
    }

    if (outcome === TeamDecisionOutcome.RESTORE_CONTENT) {
      await prisma.$transaction(async (tx) => {
        await tx.moderationCase.update({
          where: { id: caseId },
          data: {
            status: ModerationCaseStatus.RESTORED,
            closedAt: new Date(),
            finalReason: outcome,
          },
        });
        await tx.post.update({
          where: { id: moderationCase.postId },
          data: { status: PostStatus.ACTIVE },
        });
      });
    }

    await createNotification({
      recipientId: moderationCase.authorId,
      type: NotificationType.REPORT_OUTCOME,
      title: "Esito revisione distribuita",
      body:
        outcome === TeamDecisionOutcome.RESTORE_CONTENT
          ? "Il contenuto è stato ripristinato dopo il controllo distribuito."
          : "Il contenuto resta sospeso o rimosso dopo il controllo distribuito.",
      link: `/home?post=${moderationCase.postId}`,
    });
  }

  return prisma.moderationCase.findUniqueOrThrow({ where: { id: caseId } });
}

export async function processPendingCases() {
  const cases = await prisma.moderationCase.findMany({
    where: {
      status: {
        in: [
          ModerationCaseStatus.LEVEL1_PENDING,
          ModerationCaseStatus.LEVEL2_PENDING,
          ModerationCaseStatus.TEAM_PENDING,
          ModerationCaseStatus.SUSPENDED_TEMP,
        ],
      },
    },
    select: { id: true },
  });

  for (const item of cases) {
    await processModerationCase(item.id);
  }
}
