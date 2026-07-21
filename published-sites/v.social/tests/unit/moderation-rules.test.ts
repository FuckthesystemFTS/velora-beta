import { TeamDecisionOutcome, VoteDecision } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { resolveTeamOutcome, summarizeVotes } from "@/server/moderation/rules";

describe("moderation rules", () => {
  it("calcola correttamente remove vs keep", () => {
    const summary = summarizeVotes([VoteDecision.REMOVE, VoteDecision.KEEP, VoteDecision.CONFIRM_REMOVE]);
    expect(summary).toEqual({ remove: 2, keep: 1 });
  });

  it("sceglie la decisione finale del team in base alla soglia", () => {
    const outcome = resolveTeamOutcome(
      [TeamDecisionOutcome.REMOVE_FINAL, TeamDecisionOutcome.REMOVE_FINAL, TeamDecisionOutcome.RESTORE_CONTENT],
      2,
    );
    expect(outcome).toBe(TeamDecisionOutcome.REMOVE_FINAL);
  });

  it("non chiude il case se nessuna decisione raggiunge la soglia", () => {
    const outcome = resolveTeamOutcome(
      [TeamDecisionOutcome.REMOVE_FINAL, TeamDecisionOutcome.RESTORE_CONTENT, TeamDecisionOutcome.CONFIRM_SUSPENSION],
      2,
    );
    expect(outcome).toBeNull();
  });
});
