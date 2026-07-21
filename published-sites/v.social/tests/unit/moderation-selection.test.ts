import { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { selectJurors, type JuryCandidate } from "@/server/moderation/selection";

function candidate(id: string, role: Role, hoursOld = 500): JuryCandidate {
  return {
    id,
    role,
    createdAt: new Date(Date.now() - hoursOld * 60 * 60 * 1000),
    isSuspended: false,
    juryEligibilityLocked: false,
    blockedIds: [],
    blockedByIds: [],
    pendingVotes: 0,
    recentAssignments: 0,
  };
}

describe("selectJurors", () => {
  it("esclude autore, reporter, sospesi e bloccati", () => {
    const pool = [
      candidate("author", Role.USER),
      candidate("reporter", Role.USER),
      { ...candidate("blocked", Role.USER), blockedIds: ["author"] },
      { ...candidate("suspended", Role.USER), isSuspended: true },
      candidate("safe-1", Role.USER),
      candidate("safe-2", Role.USER),
    ];

    const selected = selectJurors({
      candidates: pool,
      level: "LEVEL1",
      count: 2,
      seed: "seed-a",
      authorId: "author",
      reporterId: "reporter",
      minimumAccountAgeHours: 24,
      minimumVerifiedAgeHours: 24,
      maxPendingVotes: 3,
    });

    expect(selected.map((item) => item.id)).toEqual(["safe-1", "safe-2"]);
  });

  it("in livello 2 seleziona solo utenti verificati o superiori", () => {
    const pool = [candidate("user-a", Role.USER), candidate("verified-a", Role.VERIFIED_USER), candidate("mod-a", Role.MODERATOR)];
    const selected = selectJurors({
      candidates: pool,
      level: "LEVEL2",
      count: 5,
      seed: "seed-b",
      authorId: "author",
      reporterId: "reporter",
      minimumAccountAgeHours: 24,
      minimumVerifiedAgeHours: 24,
      maxPendingVotes: 3,
    });

    expect(selected.every((item) => item.role !== Role.USER)).toBe(true);
  });

  it("evita di sovraccaricare chi ha già molti voti pendenti", () => {
    const pool = [
      { ...candidate("heavy", Role.USER), pendingVotes: 4 },
      candidate("light-a", Role.USER),
      candidate("light-b", Role.USER),
    ];

    const selected = selectJurors({
      candidates: pool,
      level: "LEVEL1",
      count: 2,
      seed: "seed-c",
      authorId: "author",
      reporterId: "reporter",
      minimumAccountAgeHours: 24,
      minimumVerifiedAgeHours: 24,
      maxPendingVotes: 3,
    });

    expect(selected.map((item) => item.id)).toEqual(expect.arrayContaining(["light-a", "light-b"]));
    expect(selected.map((item) => item.id)).not.toContain("heavy");
  });
});
