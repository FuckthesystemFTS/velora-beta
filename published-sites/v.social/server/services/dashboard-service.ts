import { ModerationAssignmentLevel, ModerationCaseStatus, ModerationAssignmentStatus, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function getPlatformOverview() {
  const [
    users,
    posts,
    cases,
    notifications,
    openCases,
    verifiedUsers,
    moderators,
    pendingAssignments,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.post.count(),
    prisma.moderationCase.count(),
    prisma.notification.count(),
    prisma.moderationCase.count({
      where: { status: { in: [ModerationCaseStatus.LEVEL1_PENDING, ModerationCaseStatus.LEVEL2_PENDING, ModerationCaseStatus.TEAM_PENDING] } },
    }),
    prisma.user.count({ where: { role: Role.VERIFIED_USER } }),
    prisma.user.count({ where: { role: { in: [Role.MODERATOR, Role.ADMIN, Role.SUPERADMIN] } } }),
    prisma.moderationAssignment.count({ where: { status: ModerationAssignmentStatus.PENDING } }),
  ]);

  return { users, posts, cases, notifications, openCases, verifiedUsers, moderators, pendingAssignments };
}

export async function getModerationCasesForDashboard() {
  const cases = await prisma.moderationCase.findMany({
    orderBy: { updatedAt: "desc" },
    take: 25,
    include: {
      post: true,
      author: { include: { profile: true } },
      reporter: { include: { profile: true } },
      votes: true,
      teamDecisions: true,
    },
  });

  return cases.map((item) => ({
    id: item.id,
    status: item.status,
    level: item.level,
    postId: item.postId,
    postContent: item.post.content,
    reporterUsername: item.reporter.username,
    authorUsername: item.author.username,
    level1RemoveVotes: item.votes.filter(
      (vote) => vote.level === ModerationAssignmentLevel.LEVEL1 && vote.decision === "REMOVE",
    ).length,
    level2RemoveVotes: item.votes.filter(
      (vote) => vote.level === ModerationAssignmentLevel.LEVEL2 && vote.decision === "REMOVE",
    ).length,
    teamRemoveVotes: item.teamDecisions.filter((decision) => decision.outcome === "REMOVE_FINAL").length,
  }));
}
