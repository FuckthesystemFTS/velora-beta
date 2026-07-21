const WEIGHTS = {
  happiness: 0.16,
  energy: 0.1,
  sleep: 0.1,
  stressInverted: 0.12,
  mood: 0.1,
  physicalActivity: 0.08,
  socialRelations: 0.1,
  gratitude: 0.08,
  meaning: 0.08,
  daySatisfaction: 0.08
};

function normalizeToTen(value, fallback = 5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

function toPercent(score) {
  return Math.round(((score - 1) / 9) * 100);
}

function getBand(score) {
  if (score <= 39) {
    return {
      band: "low",
      label: "Giornata pesante",
      explanation:
        "Oggi il tuo benessere percepito sembra basso. Non e un giudizio: e un segnale da ascoltare con gentilezza"
    };
  }
  if (score <= 59) {
    return {
      band: "fragile",
      label: "Giornata in equilibrio fragile",
      explanation:
        "Ci sono elementi positivi, ma anche alcune aree che potrebbero aver pesato sul tuo benessere"
    };
  }
  if (score <= 74) {
    return {
      band: "good",
      label: "Buona giornata",
      explanation:
        "Oggi diversi indicatori raccontano una giornata complessivamente positiva"
    };
  }
  if (score <= 89) {
    return {
      band: "very-good",
      label: "Giornata molto positiva",
      explanation:
        "Energia, umore o abitudini sembrano aver sostenuto bene il tuo benessere"
    };
  }
  return {
    band: "bright",
    label: "Giornata luminosa",
    explanation:
      "Oggi il tuo Feliciometro segna una giornata particolarmente positiva. Salva cosa ha funzionato"
  };
}

function buildStrengths(components) {
  return components
    .slice()
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map((item) => item.label);
}

function buildWatchAreas(components) {
  return components
    .slice()
    .sort((left, right) => left.value - right.value)
    .slice(0, 1)
    .map((item) => item.label);
}

function calculateHappyScore(input) {
  const normalized = {
    happiness: normalizeToTen(input.happiness),
    energy: normalizeToTen(input.energy),
    sleep: normalizeToTen(input.sleep),
    stress: normalizeToTen(input.stress),
    mood: normalizeToTen(input.mood),
    physicalActivity: normalizeToTen(input.physicalActivity),
    socialRelations: normalizeToTen(input.socialRelations),
    gratitude: normalizeToTen(input.gratitude),
    meaning: normalizeToTen(input.meaning),
    daySatisfaction: normalizeToTen(input.daySatisfaction)
  };

  const components = {
    happinessComponent: Math.round(toPercent(normalized.happiness) * WEIGHTS.happiness),
    energyComponent: Math.round(toPercent(normalized.energy) * WEIGHTS.energy),
    sleepComponent: Math.round(toPercent(normalized.sleep) * WEIGHTS.sleep),
    stressComponent: Math.round((100 - toPercent(normalized.stress)) * WEIGHTS.stressInverted),
    moodComponent: Math.round(toPercent(normalized.mood) * WEIGHTS.mood),
    activityComponent: Math.round(toPercent(normalized.physicalActivity) * WEIGHTS.physicalActivity),
    relationshipsComponent: Math.round(toPercent(normalized.socialRelations) * WEIGHTS.socialRelations),
    gratitudeComponent: Math.round(toPercent(normalized.gratitude) * WEIGHTS.gratitude),
    meaningComponent: Math.round(toPercent(normalized.meaning) * WEIGHTS.meaning),
    satisfactionComponent: Math.round(toPercent(normalized.daySatisfaction) * WEIGHTS.daySatisfaction)
  };

  const bonuses = {
    happyGestureCompleted: input.happyGestureCompleted ? 2 : 0,
    multipleActivities: Array.isArray(input.completedActivities) && input.completedActivities.length >= 2 ? 2 : 0,
    gratitudeNote: String(input.gratitudeText || "").trim() ? 1 : 0
  };

  const bonusTotal = Math.min(5, bonuses.happyGestureCompleted + bonuses.multipleActivities + bonuses.gratitudeNote);
  const rawScore =
    components.happinessComponent +
    components.energyComponent +
    components.sleepComponent +
    components.stressComponent +
    components.moodComponent +
    components.activityComponent +
    components.relationshipsComponent +
    components.gratitudeComponent +
    components.meaningComponent +
    components.satisfactionComponent +
    bonusTotal;

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const bandData = getBand(score);
  const componentList = [
    { key: "happinessComponent", label: "Felicita", value: components.happinessComponent },
    { key: "energyComponent", label: "Energia", value: components.energyComponent },
    { key: "sleepComponent", label: "Sonno", value: components.sleepComponent },
    { key: "stressComponent", label: "Stress gestito", value: components.stressComponent },
    { key: "moodComponent", label: "Umore generale", value: components.moodComponent },
    { key: "activityComponent", label: "Movimento", value: components.activityComponent },
    { key: "relationshipsComponent", label: "Relazioni", value: components.relationshipsComponent },
    { key: "gratitudeComponent", label: "Gratitudine", value: components.gratitudeComponent },
    { key: "meaningComponent", label: "Senso di utilita", value: components.meaningComponent },
    { key: "satisfactionComponent", label: "Soddisfazione della giornata", value: components.satisfactionComponent }
  ];

  return {
    score,
    band: bandData.band,
    label: bandData.label,
    explanation: bandData.explanation,
    strengths: buildStrengths(componentList),
    watchAreas: buildWatchAreas(componentList),
    components: {
      ...components,
      bonuses: {
        ...bonuses,
        total: bonusTotal
      }
    }
  };
}

module.exports = {
  WEIGHTS,
  calculateHappyScore
};
