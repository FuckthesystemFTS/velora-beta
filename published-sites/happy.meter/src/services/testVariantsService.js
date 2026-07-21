const { HAPPINESS_MISSIONS } = require("../data/happinessMissions");

function ensureAnonymousSessionId(req) {
  if (!req.session.anonymousSessionId) {
    req.session.anonymousSessionId = `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return req.session.anonymousSessionId;
}

function clampZeroTen(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(10, Math.round(parsed)));
}

function clampPositiveText(value, maxLength = 1000) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function deterministicShuffle(items, seedText) {
  const list = items.slice();
  let seed = hashString(seedText) || 1;

  for (let index = list.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }

  return list;
}

function normalizeMissionPoints(missions, maxPoints) {
  const totalWeight = missions.reduce((sum, mission) => sum + Number(mission.weight || 0), 0) || 1;
  let assigned = 0;

  const mapped = missions.map((mission) => {
    const normalizedPoints = Math.round((Number(mission.weight || 0) / totalWeight) * maxPoints);
    assigned += normalizedPoints;
    return {
      ...mission,
      normalized_points: normalizedPoints
    };
  });

  const diff = maxPoints - assigned;
  if (mapped.length) {
    mapped[mapped.length - 1].normalized_points += diff;
  }

  return mapped;
}

async function getOrCreateDailyMissions(db, options) {
  const {
    userId = null,
    anonymousSessionId = null,
    testCode,
    date,
    count,
    maxPoints
  } = options;

  const existing = await db.all(
    `SELECT dtm.*, hm.text, hm.weight
     FROM daily_test_missions dtm
     JOIN happiness_missions hm ON hm.id = dtm.mission_id
     WHERE dtm.test_code = ? AND dtm.date = ? AND
       ((dtm.user_id IS NOT NULL AND dtm.user_id = ?) OR (dtm.user_id IS NULL AND dtm.anonymous_session_id = ?))
     ORDER BY dtm.id ASC`,
    [testCode, date, userId, anonymousSessionId]
  );

  if (existing.length) {
    return existing.map((mission) => ({
      id: mission.mission_id,
      text: mission.text,
      weight: Number(mission.weight || 0),
      normalized_points: Number(mission.normalized_points || 0)
    }));
  }

  const allMissions = await db.all(
    "SELECT id, text, weight FROM happiness_missions WHERE status = 'active' ORDER BY id ASC",
    []
  );

  const source = allMissions.length
    ? allMissions
    : HAPPINESS_MISSIONS.map((mission, index) => ({ id: index + 1, text: mission.text, weight: mission.weight }));

  const seed = `${testCode}:${date}:${userId || anonymousSessionId || "public"}`;
  const selected = deterministicShuffle(source, seed).slice(0, count);
  const normalized = normalizeMissionPoints(selected, maxPoints);

  for (const mission of normalized) {
    await db.insert("daily_test_missions", {
      user_id: userId,
      anonymous_session_id: anonymousSessionId,
      test_code: testCode,
      date,
      mission_id: mission.id,
      normalized_points: mission.normalized_points
    });
  }

  return normalized;
}

function evaluateVariantBand(score) {
  if (score <= 30) {
    return {
      label: "Giornata lenta",
      message: "Oggi puo essere una giornata piu lenta, e va bene cosi. Anche un piccolo gesto conta"
    };
  }
  if (score <= 60) {
    return {
      label: "Piccoli passi positivi",
      message: "Hai gia raccolto alcuni momenti positivi. Continua con calma, senza pressione"
    };
  }
  if (score <= 85) {
    return {
      label: "Bella giornata di consapevolezza",
      message: "Bella giornata di consapevolezza. Hai dato spazio a gesti che fanno bene"
    };
  }
  return {
    label: "Giornata piena di segnali positivi",
    message: "Giornata piena di piccoli segnali positivi. Conserva quello che ti ha fatto stare bene"
  };
}

function calculateMissionCompletionScore(assignedMissions, completedIds, maxPoints) {
  const allowedIds = new Set(assignedMissions.map((mission) => Number(mission.id)));
  const cleanIds = Array.from(
    new Set(
      (Array.isArray(completedIds) ? completedIds : [completedIds])
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && allowedIds.has(item))
    )
  );

  const score = assignedMissions
    .filter((mission) => cleanIds.includes(Number(mission.id)))
    .reduce((sum, mission) => sum + Number(mission.normalized_points || 0), 0);

  return {
    completedIds: cleanIds,
    score: Math.max(0, Math.min(maxPoints, score))
  };
}

function calculateTestBResult(assignedMissions, completedIds, reflectionText) {
  const completed = calculateMissionCompletionScore(assignedMissions, completedIds, 95);
  const cleanReflection = clampPositiveText(reflectionText);
  const reflectionScore = cleanReflection.length >= 20 ? 5 : 0;
  const score = Math.max(0, Math.min(100, completed.score + reflectionScore));
  const band = evaluateVariantBand(score);

  return {
    score,
    missionsScore: completed.score,
    reflectionScore,
    reflectionText: cleanReflection,
    completedIds: completed.completedIds,
    label: band.label,
    message: band.message
  };
}

function calculateTestCResult(payload, assignedMissions, completedIds, reflectionText) {
  const values = {
    happiness: clampZeroTen(payload.happiness),
    energy: clampZeroTen(payload.energy),
    stress: clampZeroTen(payload.stress),
    socialRelations: clampZeroTen(payload.social_relations),
    gratitude: clampZeroTen(payload.gratitude)
  };

  const sliderScore = Math.max(
    0,
    Math.min(
      50,
      values.happiness +
        values.energy +
        (10 - values.stress) +
        values.socialRelations +
        values.gratitude
    )
  );

  const completed = calculateMissionCompletionScore(assignedMissions, completedIds, 40);
  const cleanReflection = clampPositiveText(reflectionText);
  const reflectionScore = cleanReflection.length >= 20 ? 10 : 0;
  const score = Math.max(0, Math.min(100, sliderScore + completed.score + reflectionScore));
  const band = evaluateVariantBand(score);

  return {
    score,
    sliderScore,
    missionsScore: completed.score,
    reflectionScore,
    reflectionText: cleanReflection,
    completedIds: completed.completedIds,
    answers: values,
    label: band.label,
    message: band.message
  };
}

module.exports = {
  calculateMissionCompletionScore,
  calculateTestBResult,
  calculateTestCResult,
  clampPositiveText,
  clampZeroTen,
  ensureAnonymousSessionId,
  evaluateVariantBand,
  getOrCreateDailyMissions
};
