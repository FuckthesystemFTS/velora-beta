export const policyVersion = "2026-04-20";

export const defaultSystemConfig = {
  numJurorsLevel1: 10,
  numJurorsLevel2: 5,
  numTeamReviewers: 3,
  level1Threshold: 6,
  level2Threshold: 3,
  teamThreshold: 2,
  voteTimeoutMinutes: 24 * 60,
  reminderTimeoutMinutes: 12 * 60,
  tempSuspensionEnabled: true,
  reportCooldownMinutes: 30,
  maxReportsPerDay: 10,
  maxVotesPendingPerUser: 5,
  minAccountAgeHoursJury: 72,
  minVerifiedAgeHours: 168,
  allowSingleSuperadminDecision: false,
} as const;

export const appCopy = {
  name: "V per Verita",
  tagline: "V per Verita",
  themeReference: "Dark social, nero profondo, rosso intenso, bianco caldo.",
};
