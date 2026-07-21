const LEVELS = [
  { level: 1, name: "Primi sorrisi", minPoints: 0 },
  { level: 2, name: "Esploratore felice", minPoints: 80 },
  { level: 3, name: "Coltivatore di benessere", minPoints: 220 },
  { level: 4, name: "Campione di gentilezza", minPoints: 420 },
  { level: 5, name: "Cuore d'Oro", minPoints: 700 }
];

const POINT_RULES = {
  dailyEntry: 10,
  happyGesture: 15,
  activityBase: 7,
  streak3: 20,
  streak7: 50,
  streak30: 200
};

function resolveLevel(points) {
  return LEVELS.slice().reverse().find((item) => points >= item.minPoints) || LEVELS[0];
}

function streakBonus(streak) {
  if (streak === 30) {
    return POINT_RULES.streak30;
  }
  if (streak === 7) {
    return POINT_RULES.streak7;
  }
  if (streak === 3) {
    return POINT_RULES.streak3;
  }
  return 0;
}

function computeBadgeCodes(context) {
  const badgeCodes = [];

  if (context.entriesCount >= 1) badgeCodes.push("primo-test");
  if (context.streak >= 3) badgeCodes.push("tre-giorni-di-consapevolezza");
  if (context.streak >= 7) badgeCodes.push("una-settimana-di-feliciometro");
  if (context.gestureCount >= 1) badgeCodes.push("primo-gesto-felice");
  if (context.diaryCount >= 1) badgeCodes.push("diario-aperto");
  if (context.gratitudeDays >= 5) badgeCodes.push("gratitudine-crescente");
  if (context.highMovementDays >= 3) badgeCodes.push("energia-in-movimento");
  if (context.kindnessDays >= 3) badgeCodes.push("campione-di-gentilezza");
  if (context.points >= 700) badgeCodes.push("cuore-d-oro");
  if (context.brightDays >= 5) badgeCodes.push("sorriso-del-mese");

  return badgeCodes;
}

module.exports = {
  LEVELS,
  POINT_RULES,
  computeBadgeCodes,
  resolveLevel,
  streakBonus
};
