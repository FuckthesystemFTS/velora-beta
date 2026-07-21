const express = require("express");

const { getDb } = require("../../db");
const auth = require("../middleware/auth");
const { POINT_RULES, computeBadgeCodes, resolveLevel, streakBonus } = require("../services/gamificationService");
const { calculateHappyScore } = require("../services/happyScoreService");
const { buildInsights } = require("../services/insightsService");
const { normalizeLanguage } = require("../services/languageService");
const { addDays, dayDiff, todayIso } = require("../utils/dates");
const { normalizeText } = require("../utils/validators");

const router = express.Router();

function setFlash(req, type, text) {
  req.session.flash = { type, text };
}

function getLocalizedField(row, field, lang) {
  return row[`${field}_${lang}`] || row[`${field}_it`] || "";
}

function toNumericTen(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

function parseActivities(input) {
  if (!input) {
    return [];
  }
  return Array.isArray(input) ? input : [input];
}

async function addPoints(db, userId, delta) {
  const user = await db.get("SELECT points FROM users WHERE id = ?", [userId]);
  const nextPoints = Number(user?.points || 0) + Number(delta || 0);
  const nextLevel = resolveLevel(nextPoints);

  await db.update(
    "users",
    {
      points: nextPoints,
      level: nextLevel.level,
      updated_at: new Date().toISOString()
    },
    "id = ?",
    [userId]
  );

  return { points: nextPoints, level: nextLevel };
}

async function ensureTodayGesture(db, userId, lang) {
  const today = todayIso();
  const existing = await db.get(
    `SELECT uhg.*, hg.text_it, hg.text_en, hg.text_de, hg.text_es, hg.points
     FROM user_happy_gestures uhg
     JOIN happy_gestures hg ON hg.id = uhg.happy_gesture_id
     WHERE uhg.user_id = ? AND uhg.gesture_date = ?`,
    [userId, today]
  );

  if (existing) {
    return {
      ...existing,
      display_text: getLocalizedField(existing, "text", lang)
    };
  }

  const gestures = await db.all("SELECT * FROM happy_gestures WHERE active = 1 ORDER BY id ASC", []);
  if (!gestures.length) {
    return null;
  }

  const index = Math.abs(Number(today.replace(/-/g, ""))) % gestures.length;
  const chosen = gestures[index];

  await db.insert("user_happy_gestures", {
    user_id: userId,
    happy_gesture_id: chosen.id,
    gesture_date: today,
    completed: 0,
    points_awarded: 0
  });

  return {
    ...chosen,
    completed: 0,
    points_awarded: 0,
    display_text: getLocalizedField(chosen, "text", lang)
  };
}

async function recomputeStreaks(db, userId) {
  const entries = await db.all(
    "SELECT entry_date FROM daily_entries WHERE user_id = ? ORDER BY entry_date DESC",
    [userId]
  );
  const gestures = await db.all(
    "SELECT gesture_date FROM user_happy_gestures WHERE user_id = ? AND completed = 1 ORDER BY gesture_date DESC",
    [userId]
  );

  function calculateConsecutive(dates) {
    if (!dates.length) {
      return 0;
    }

    const normalized = dates.map((item) => String(item.entry_date || item.gesture_date).slice(0, 10));
    const diffFromToday = dayDiff(normalized[0], todayIso());
    if (diffFromToday > 1) {
      return 0;
    }

    let streak = 1;
    let cursor = normalized[0];

    for (let index = 1; index < normalized.length; index += 1) {
      const current = normalized[index];
      if (current === addDays(cursor, -1)) {
        streak += 1;
        cursor = current;
      } else if (current !== cursor) {
        break;
      }
    }

    return streak;
  }

  const currentStreak = calculateConsecutive(entries);
  const happyGestureStreak = calculateConsecutive(gestures);

  await db.update(
    "users",
    {
      current_streak: currentStreak,
      happy_gesture_streak: happyGestureStreak,
      updated_at: new Date().toISOString()
    },
    "id = ?",
    [userId]
  );

  return { currentStreak, happyGestureStreak };
}

async function unlockBadges(db, userId) {
  const stats = await Promise.all([
    db.get("SELECT COUNT(*) AS count FROM daily_entries WHERE user_id = ?", [userId]),
    db.get("SELECT COUNT(*) AS count FROM user_happy_gestures WHERE user_id = ? AND completed = 1", [userId]),
    db.get("SELECT COUNT(*) AS count FROM daily_entries WHERE user_id = ? AND note IS NOT NULL AND TRIM(note) <> ''", [userId]),
    db.get("SELECT COUNT(*) AS count FROM daily_entries WHERE user_id = ? AND gratitude >= 8", [userId]),
    db.get("SELECT COUNT(*) AS count FROM daily_entries WHERE user_id = ? AND physical_activity >= 8", [userId]),
    db.get("SELECT COUNT(*) AS count FROM user_activities WHERE user_id = ? AND note IS NOT NULL AND note LIKE ?", [userId, "%gent%"]),
    db.get("SELECT COUNT(*) AS count FROM daily_entries WHERE user_id = ? AND happy_score >= 80", [userId]),
    db.get("SELECT points, current_streak FROM users WHERE id = ?", [userId])
  ]);

  const desiredCodes = computeBadgeCodes({
    entriesCount: Number(stats[0]?.count || 0),
    gestureCount: Number(stats[1]?.count || 0),
    diaryCount: Number(stats[2]?.count || 0),
    gratitudeDays: Number(stats[3]?.count || 0),
    highMovementDays: Number(stats[4]?.count || 0),
    kindnessDays: Number(stats[5]?.count || 0),
    brightDays: Number(stats[6]?.count || 0),
    points: Number(stats[7]?.points || 0),
    streak: Number(stats[7]?.current_streak || 0)
  });

  const badges = await db.all("SELECT id, code FROM badges WHERE active = 1", []);
  const owned = await db.all("SELECT badge_id FROM user_badges WHERE user_id = ?", [userId]);
  const ownedIds = new Set(owned.map((row) => Number(row.badge_id)));

  for (const badge of badges) {
    if (desiredCodes.includes(badge.code) && !ownedIds.has(Number(badge.id))) {
      await db.insert("user_badges", {
        user_id: userId,
        badge_id: badge.id
      });
    }
  }
}

async function saveCompletedActivities(db, userId, selectedActivities, lang) {
  const allActivities = await db.all("SELECT * FROM activities WHERE active = 1", []);
  let totalPoints = 0;

  for (const activityKey of selectedActivities) {
    const found = allActivities.find((activity) => {
      const normalizedName = getLocalizedField(activity, "name", lang).toLowerCase();
      const fallbackName = String(activity.name_it || "").toLowerCase();
      return normalizedName === activityKey.toLowerCase() || fallbackName === activityKey.toLowerCase();
    });

    if (!found) {
      await db.insert("user_activities", {
        user_id: userId,
        custom_name: activityKey,
        completed_date: todayIso(),
        points_awarded: POINT_RULES.activityBase,
        note: "Attività dal test quotidiano"
      });
      totalPoints += POINT_RULES.activityBase;
      continue;
    }

    await db.insert("user_activities", {
      user_id: userId,
      activity_id: found.id,
      completed_date: todayIso(),
      points_awarded: found.points,
      note: "Attività dal test quotidiano"
    });
    totalPoints += Number(found.points || 0);
  }

  return totalPoints;
}

function buildDailyPayload(body, happyGestureCompleted) {
  const selectedActivities = parseActivities(body.activities);
  const input = {
    happiness: body.happiness,
    energy: body.energy,
    sleep: body.sleep,
    stress: body.stress,
    mood: body.mood,
    physicalActivity: body.physical_activity,
    socialRelations: body.social_relations,
    gratitude: body.gratitude,
    meaning: body.meaning,
    daySatisfaction: body.day_satisfaction,
    completedActivities: selectedActivities,
    gratitudeText: body.gratitude_text,
    happyGestureCompleted
  };

  return {
    selectedActivities,
    scoreData: calculateHappyScore(input),
    entryData: {
      happiness: toNumericTen(body.happiness),
      energy: toNumericTen(body.energy),
      sleep: toNumericTen(body.sleep),
      stress: toNumericTen(body.stress),
      mood: toNumericTen(body.mood),
      physical_activity: toNumericTen(body.physical_activity),
      nutrition: toNumericTen(body.nutrition),
      outdoor_time: toNumericTen(body.outdoor_time),
      rest_breaks: toNumericTen(body.rest_breaks),
      self_care: toNumericTen(body.self_care),
      social_relations: toNumericTen(body.social_relations),
      gratitude: toNumericTen(body.gratitude),
      meaning: toNumericTen(body.meaning),
      engagement: toNumericTen(body.engagement),
      day_satisfaction: toNumericTen(body.day_satisfaction),
      note: normalizeText(body.note),
      good_things_text: normalizeText(body.good_things_text),
      hard_things_text: normalizeText(body.hard_things_text),
      people_text: normalizeText(body.people_text),
      gratitude_text: normalizeText(body.gratitude_text),
      activities_text: selectedActivities.join(", ")
    }
  };
}

async function getTodayResult(db, userId) {
  return db.get("SELECT * FROM daily_entries WHERE user_id = ? AND entry_date = ?", [userId, todayIso()]);
}

function buildStoredResult(entry) {
  if (!entry) {
    return null;
  }

  const derived = calculateHappyScore({
    happiness: entry.happiness,
    energy: entry.energy,
    sleep: entry.sleep,
    stress: entry.stress,
    mood: entry.mood,
    physicalActivity: entry.physical_activity,
    socialRelations: entry.social_relations,
    gratitude: entry.gratitude,
    meaning: entry.meaning,
    daySatisfaction: entry.day_satisfaction,
    completedActivities: String(entry.activities_text || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    gratitudeText: entry.gratitude_text
  });

  return {
    score: Number(entry.happy_score || derived.score || 0),
    label: entry.result_label || derived.label,
    explanation: entry.result_explanation || derived.explanation,
    strengths: derived.strengths,
    watchAreas: derived.watchAreas
  };
}

async function getDashboardData(db, user, lang) {
  const [todayEntry, recentEntries, recentBadges, todayActivities, badgesCount] = await Promise.all([
    getTodayResult(db, user.id),
    db.all(
      "SELECT entry_date, happy_score FROM daily_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 7",
      [user.id]
    ),
    db.all(
      `SELECT b.*, ub.unlocked_at
       FROM user_badges ub
       JOIN badges b ON b.id = ub.badge_id
       WHERE ub.user_id = ?
       ORDER BY ub.unlocked_at DESC
       LIMIT 4`,
      [user.id]
    ),
    db.all(
      `SELECT ua.*, a.name_it, a.name_en, a.name_de, a.name_es, a.icon
       FROM user_activities ua
       LEFT JOIN activities a ON a.id = ua.activity_id
       WHERE ua.user_id = ? AND ua.completed_date = ?
       ORDER BY ua.created_at DESC`,
      [user.id, todayIso()]
    ),
    db.get("SELECT COUNT(*) AS count FROM user_badges WHERE user_id = ?", [user.id])
  ]);

  const gesture = await ensureTodayGesture(db, user.id, lang);
  const totalEntries = await db.get("SELECT COUNT(*) AS count FROM daily_entries WHERE user_id = ?", [user.id]);
  const averageScore = await db.get("SELECT ROUND(AVG(happy_score), 1) AS avg FROM daily_entries WHERE user_id = ?", [user.id]);

  return {
    todayEntry,
    todayActivities: todayActivities.map((item) => ({
      ...item,
      activity_name: item.custom_name || getLocalizedField(item, "name", lang)
    })),
    recentEntries: recentEntries.reverse(),
    recentBadges,
    badgesCount: Number(badgesCount?.count || 0),
    gesture,
    quickStats: {
      todayScore: Number(todayEntry?.happy_score || 0),
      totalEntries: Number(totalEntries?.count || 0),
      averageScore: Number(averageScore?.avg || 0)
    }
  };
}

router.use("/app", auth);

router.get("/app", async (req, res) => {
  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.session.userId]);
  const dashboard = await getDashboardData(db, user, res.locals.lang);

  res.render("app-dashboard", {
    layout: "layout-app",
    pageTitle: "Il tuo Feliciometro di oggi",
    dashboard
  });
});

router.get("/app/today", async (req, res) => {
  const db = getDb();
  const entry = await getTodayResult(db, req.session.userId);
  const gesture = await ensureTodayGesture(db, req.session.userId, res.locals.lang);

  res.render("app-today", {
    layout: "layout-app",
    pageTitle: "Il tuo test quotidiano",
    entry,
    gesture,
    result: req.query.saved === "1" && entry ? buildStoredResult(entry) : null
  });
});

router.post("/app/today", async (req, res) => {
  const db = getDb();
  const gesture = await ensureTodayGesture(db, req.session.userId, res.locals.lang);
  const isGestureCompleted = Number(gesture?.completed || 0) === 1;
  const { selectedActivities, scoreData, entryData } = buildDailyPayload(req.body, isGestureCompleted);
  const existing = await getTodayResult(db, req.session.userId);

  const payload = {
    user_id: req.session.userId,
    entry_date: todayIso(),
    ...entryData,
    happy_score: scoreData.score,
    score_band: scoreData.band,
    result_label: scoreData.label,
    result_explanation: scoreData.explanation,
    components_json: JSON.stringify(scoreData.components),
    updated_at: new Date().toISOString()
  };

  if (existing) {
    await db.update("daily_entries", payload, "id = ?", [existing.id]);
  } else {
    await db.insert("daily_entries", payload);
  }

  const activityPoints = await saveCompletedActivities(db, req.session.userId, selectedActivities, res.locals.lang);
  if (!existing) {
    await addPoints(db, req.session.userId, POINT_RULES.dailyEntry + activityPoints);
  }

  const streaks = await recomputeStreaks(db, req.session.userId);
  const bonus = streakBonus(streaks.currentStreak);
  if (!existing && bonus) {
    await addPoints(db, req.session.userId, bonus);
  }

  await unlockBadges(db, req.session.userId);
  setFlash(req, "success", `Happy Score aggiornato a ${scoreData.score}/100`);
  return res.redirect("/app/today?saved=1");
});

router.post("/app/gesture/complete", async (req, res) => {
  const db = getDb();
  const gesture = await ensureTodayGesture(db, req.session.userId, res.locals.lang);

  if (!gesture) {
    setFlash(req, "error", "Nessun gesto felice disponibile oggi");
    return res.redirect("/app");
  }

  if (Number(gesture.completed || 0) === 1) {
    setFlash(req, "success", "Il gesto felice di oggi e gia segnato");
    return res.redirect("/app");
  }

  await db.run(
    "UPDATE user_happy_gestures SET completed = 1, note = ?, points_awarded = ? WHERE user_id = ? AND gesture_date = ?",
    [normalizeText(req.body.note), Number(gesture.points || POINT_RULES.happyGesture), req.session.userId, todayIso()]
  );

  await addPoints(db, req.session.userId, Number(gesture.points || POINT_RULES.happyGesture));
  await recomputeStreaks(db, req.session.userId);
  await unlockBadges(db, req.session.userId);
  setFlash(req, "success", "Gesto felice completato");
  return res.redirect("/app");
});

router.get("/app/diary", async (req, res) => {
  const db = getDb();
  const entries = await db.all(
    "SELECT * FROM daily_entries WHERE user_id = ? ORDER BY entry_date DESC",
    [req.session.userId]
  );
  const activities = await db.all(
    `SELECT ua.*, a.name_it, a.name_en, a.name_de, a.name_es, a.icon
     FROM user_activities ua
     LEFT JOIN activities a ON a.id = ua.activity_id
     WHERE ua.user_id = ?
     ORDER BY ua.completed_date DESC`,
    [req.session.userId]
  );
  const gestures = await db.all(
    `SELECT uhg.*, hg.text_it, hg.text_en, hg.text_de, hg.text_es
     FROM user_happy_gestures uhg
     JOIN happy_gestures hg ON hg.id = uhg.happy_gesture_id
     WHERE uhg.user_id = ? AND uhg.completed = 1
     ORDER BY uhg.gesture_date DESC`,
    [req.session.userId]
  );

  res.render("app-diary", {
    layout: "layout-app",
    pageTitle: "Diario della felicità",
    entries,
    activities,
    gestures,
    filter: "month",
    search: "",
    getLocalizedField
  });
});

router.get("/app/insights", async (req, res) => {
  const db = getDb();
  const entries = await db.all(
    "SELECT * FROM daily_entries WHERE user_id = ? ORDER BY entry_date ASC",
    [req.session.userId]
  );
  const activities = await db.all(
    `SELECT ua.*, a.name_it, a.name_en, a.name_de, a.name_es
     FROM user_activities ua
     LEFT JOIN activities a ON a.id = ua.activity_id
     WHERE ua.user_id = ?
     ORDER BY ua.completed_date ASC`,
    [req.session.userId]
  );
  const localizedActivities = activities.map((row) => ({
    ...row,
    activity_name: row.custom_name || getLocalizedField(row, "name", res.locals.lang)
  }));

  const insights = buildInsights(entries, localizedActivities);
  res.render("app-insights", {
    layout: "layout-app",
    pageTitle: "Cosa mi rende felice?",
    insights
  });
});

router.get("/app/activities", async (req, res) => {
  const db = getDb();
  const activities = await db.all("SELECT * FROM activities WHERE active = 1 ORDER BY id ASC", []);
  const completedToday = await db.all(
    `SELECT ua.*, a.name_it, a.name_en, a.name_de, a.name_es, a.icon
     FROM user_activities ua
     LEFT JOIN activities a ON a.id = ua.activity_id
     WHERE ua.user_id = ? AND ua.completed_date = ?
     ORDER BY ua.created_at DESC`,
    [req.session.userId, todayIso()]
  );

  res.render("app-activities", {
    layout: "layout-app",
    pageTitle: "Attività felici",
    activities,
    completedToday,
    getLocalizedField
  });
});

router.post("/app/activities/complete", async (req, res) => {
  const db = getDb();
  const activity = await db.get("SELECT * FROM activities WHERE id = ? AND active = 1", [req.body.activity_id]);
  if (!activity) {
    setFlash(req, "error", "Attività non trovata");
    return res.redirect("/app/activities");
  }

  await db.insert("user_activities", {
    user_id: req.session.userId,
    activity_id: activity.id,
    completed_date: todayIso(),
    points_awarded: activity.points,
    note: normalizeText(req.body.note)
  });

  await addPoints(db, req.session.userId, Number(activity.points || 0));
  await unlockBadges(db, req.session.userId);
  setFlash(req, "success", `${getLocalizedField(activity, "name", res.locals.lang)} registrata`);
  return res.redirect("/app/activities");
});

router.post("/app/activities/custom", async (req, res) => {
  const db = getDb();
  const customName = normalizeText(req.body.custom_name);
  if (!customName) {
    setFlash(req, "error", "Scrivi il nome della tua attività");
    return res.redirect("/app/activities");
  }

  await db.insert("user_activities", {
    user_id: req.session.userId,
    custom_name: customName,
    completed_date: todayIso(),
    points_awarded: POINT_RULES.activityBase,
    note: normalizeText(req.body.note)
  });

  await addPoints(db, req.session.userId, POINT_RULES.activityBase);
  setFlash(req, "success", "Attività personalizzata aggiunta");
  return res.redirect("/app/activities");
});

router.get("/app/badges", async (req, res) => {
  const db = getDb();
  const badges = await db.all(
    `SELECT b.*, ub.unlocked_at
     FROM badges b
     LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ?
     WHERE b.active = 1
     ORDER BY b.id ASC`,
    [req.session.userId]
  );

  res.render("app-badges", {
    layout: "layout-app",
    pageTitle: "Premi e medaglie",
    badges
  });
});

router.get("/app/community", async (req, res) => {
  return res.redirect("/app?chat=open");
});

router.post("/app/community/:id/like", async (req, res) => {
  const db = getDb();
  const existing = await db.get(
    "SELECT id FROM community_post_likes WHERE user_id = ? AND post_id = ?",
    [req.session.userId, req.params.id]
  );

  if (!existing) {
    await db.insert("community_post_likes", {
      user_id: req.session.userId,
      post_id: Number(req.params.id)
    });
  }

  setFlash(
    req,
    "success",
    res.locals.lang === "en" ? "You left a positive reaction" : "Hai lasciato una reazione positiva"
  );
  return res.redirect("/app?chat=open");
});

router.get("/app/profile", async (req, res) => {
  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.session.userId]);
  res.render("app-profile", {
    layout: "layout-app",
    pageTitle: "Profilo",
    profileUser: user
  });
});

router.post("/app/profile/language", async (req, res) => {
  const db = getDb();
  const preferredLanguage = normalizeLanguage(req.body.preferred_language);
  await db.update(
    "users",
    {
      preferred_language: preferredLanguage,
      updated_at: new Date().toISOString()
    },
    "id = ?",
    [req.session.userId]
  );
  req.session.language = preferredLanguage;
  setFlash(req, "success", "Lingua aggiornata");
  return res.redirect("/app/profile");
});

router.get("/app/premium", (req, res) => {
  res.render("app-premium", {
    layout: "layout-app",
    pageTitle: "Premium"
  });
});

module.exports = router;
