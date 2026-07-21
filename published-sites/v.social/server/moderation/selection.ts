import type { ModerationAssignmentLevel, Role } from "@prisma/client";

import { isVerifiedRole } from "@/lib/permissions";

export type JuryCandidate = {
  id: string;
  role: Role;
  createdAt: Date;
  isSuspended: boolean;
  juryEligibilityLocked: boolean;
  blockedIds: string[];
  blockedByIds: string[];
  pendingVotes: number;
  recentAssignments: number;
};

export type SelectionInput = {
  candidates: JuryCandidate[];
  level: ModerationAssignmentLevel;
  count: number;
  seed: string;
  authorId: string;
  reporterId: string;
  excludedIds?: string[];
  minimumAccountAgeHours: number;
  minimumVerifiedAgeHours: number;
  maxPendingVotes: number;
};

function seededHash(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function scoreCandidate(candidate: JuryCandidate, seed: string) {
  return seededHash(`${seed}:${candidate.id}`) + candidate.pendingVotes * 1_000 + candidate.recentAssignments * 100;
}

export function selectJurors(input: SelectionInput) {
  const now = Date.now();
  const excluded = new Set([input.authorId, input.reporterId, ...(input.excludedIds ?? [])]);

  return input.candidates
    .filter((candidate) => !excluded.has(candidate.id))
    .filter((candidate) => !candidate.isSuspended && !candidate.juryEligibilityLocked)
    .filter((candidate) => !candidate.blockedIds.includes(input.authorId) && !candidate.blockedByIds.includes(input.authorId))
    .filter((candidate) => !candidate.blockedIds.includes(input.reporterId) && !candidate.blockedByIds.includes(input.reporterId))
    .filter((candidate) => candidate.pendingVotes < input.maxPendingVotes)
    .filter((candidate) => {
      const ageHours = (now - candidate.createdAt.getTime()) / (1000 * 60 * 60);
      if (input.level === "LEVEL2") {
        return isVerifiedRole(candidate.role) && ageHours >= input.minimumVerifiedAgeHours;
      }
      return ageHours >= input.minimumAccountAgeHours;
    })
    .sort((left, right) => scoreCandidate(left, input.seed) - scoreCandidate(right, input.seed))
    .slice(0, input.count);
}
