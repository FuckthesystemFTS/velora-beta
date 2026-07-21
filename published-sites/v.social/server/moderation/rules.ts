import { TeamDecisionOutcome, VoteDecision } from "@prisma/client";

export function summarizeVotes(decisions: VoteDecision[]) {
  return {
    remove: decisions.filter((decision) => decision === VoteDecision.REMOVE || decision === VoteDecision.CONFIRM_REMOVE).length,
    keep: decisions.filter((decision) => decision === VoteDecision.KEEP || decision === VoteDecision.RESTORE).length,
  };
}

export function resolveTeamOutcome(outcomes: TeamDecisionOutcome[], threshold: number) {
  const removeFinal = outcomes.filter((outcome) => outcome === TeamDecisionOutcome.REMOVE_FINAL).length;
  const restore = outcomes.filter((outcome) => outcome === TeamDecisionOutcome.RESTORE_CONTENT).length;
  const confirm = outcomes.filter((outcome) => outcome === TeamDecisionOutcome.CONFIRM_SUSPENSION).length;

  if (removeFinal >= threshold) return TeamDecisionOutcome.REMOVE_FINAL;
  if (restore >= threshold) return TeamDecisionOutcome.RESTORE_CONTENT;
  if (confirm >= threshold) return TeamDecisionOutcome.CONFIRM_SUSPENSION;
  return null;
}
