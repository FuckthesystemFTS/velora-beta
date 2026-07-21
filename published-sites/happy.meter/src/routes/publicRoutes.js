const express = require("express");

const { getDb } = require("../../db");
const { TEST_VARIANTS } = require("../data/testVariants");
const { calculateHappyScore } = require("../services/happyScoreService");
const {
  calculateTestBResult,
  calculateTestCResult,
  ensureAnonymousSessionId,
  evaluateVariantBand,
  getOrCreateDailyMissions
} = require("../services/testVariantsService");
const { todayIso } = require("../utils/dates");
const { normalizeText } = require("../utils/validators");

const router = express.Router();

function setFlash(req, type, text) {
  req.session.flash = { type, text };
}

function pick(lang, it, en, de) {
  if (lang === "de") {
    return de || en || it;
  }
  if (lang === "en") {
    return en || it;
  }
  return it;
}

function buildSeo(lang, titleIt, titleEn, titleDe, descriptionIt, descriptionEn, descriptionDe, extra = {}) {
  return {
    title: pick(lang, titleIt, titleEn, titleDe),
    description: pick(lang, descriptionIt, descriptionEn, descriptionDe),
    ...extra
  };
}

function getPreviewImage(lang, baseName) {
  if (lang === "de") {
    return `/images/${baseName}-de.jpg`;
  }
  if (lang === "en") {
    return `/images/${baseName}-en.jpg`;
  }
  return `/images/${baseName}.jpg`;
}

function mapTestAPayload(body) {
  return {
    happiness: body.happiness,
    energy: body.energy,
    sleep: body.sleep,
    stress: body.stress,
    mood: body.day_satisfaction,
    physicalActivity: body.physical_activity,
    socialRelations: body.social_relations,
    gratitude: body.gratitude,
    meaning: body.meaning,
    daySatisfaction: body.day_satisfaction,
    completedActivities: [],
    gratitudeText: ""
  };
}

function resolveChatRedirectTarget(req) {
  const langQuery = req.session?.language && req.session.language !== "it" ? `&lang=${req.session.language}` : "";
  if (req.session.userId) {
    return `/app?chat=open${langQuery}`;
  }
  return `/?chat=open${langQuery}`;
}

async function loadCommunityPosts(db) {
  return db.all(
    `SELECT cp.*, COUNT(cpl.id) AS likes_count
     FROM community_posts cp
     LEFT JOIN community_post_likes cpl ON cpl.post_id = cp.id
     WHERE cp.is_hidden = 0 AND cp.is_demo = 0
     GROUP BY cp.id
     ORDER BY cp.created_at DESC`,
    []
  );
}

async function hasUserLikedTest(db, userId, testCode) {
  if (!userId) {
    return false;
  }
  const like = await db.get("SELECT id FROM test_likes WHERE user_id = ? AND test_code = ?", [userId, testCode]);
  return Boolean(like);
}

async function getTestLikeCounts(db) {
  const rows = await db.all(
    `SELECT test_code, COUNT(*) AS likes_count
     FROM test_likes
     GROUP BY test_code`,
    []
  );
  return rows.reduce((accumulator, row) => {
    accumulator[String(row.test_code || "").toUpperCase()] = Number(row.likes_count || 0);
    return accumulator;
  }, {});
}

async function saveTestResult(db, data) {
  const existing = await db.get(
    `SELECT id
     FROM test_results
     WHERE test_code = ? AND date = ? AND
       ((user_id IS NOT NULL AND user_id = ?) OR (user_id IS NULL AND anonymous_session_id = ?))`,
    [data.test_code, data.date, data.user_id, data.anonymous_session_id]
  );

  const payload = {
    ...data,
    updated_at: new Date().toISOString()
  };

  if (existing) {
    await db.update("test_results", payload, "id = ?", [existing.id]);
    return existing.id;
  }

  const inserted = await db.insert("test_results", payload);
  return inserted.id;
}

function buildTestAResult(lang, result) {
  const band = evaluateVariantBand(result.score);
  return {
    score: result.score,
    label: band.label,
    message: band.message,
    strengths: result.strengths,
    watchAreas: result.watchAreas,
    breakdown: [
      { label: pick(lang, "Punteggio classico", "Classic score", "Klassischer Score"), value: `${result.score} / 100` }
    ]
  };
}

function buildTestMissionResult(lang, result, options) {
  return {
    score: result.score,
    label: result.label,
    message: result.message,
    strengths: [],
    watchAreas: [],
    breakdown: options.breakdown
  };
}

function buildSelectionSeo(lang) {
  return buildSeo(
    lang,
    "HappyMeter | Scegli il tuo test",
    "HappyMeter | Choose your test",
    "HappyMeter | Waehle deinen Test",
    "Scopri tre percorsi HappyMeter per iniziare a osservare benessere, abitudini e Happy Score",
    "Discover three HappyMeter paths to start observing wellbeing, habits and your Happy Score",
    "Entdecke drei HappyMeter Wege, um Wohlbefinden, Gewohnheiten und deinen Happy Score zu beobachten"
  );
}

function buildMissionPointsSummary(missions) {
  return missions.reduce((sum, mission) => sum + Number(mission.normalized_points || 0), 0);
}

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "happymeter-feliciometro",
    version: "1.0.0"
  });
});

router.get("/welcome", (req, res) => {
  res.render("welcome-1", {
    layout: "layout-public",
    pageTitle: pick(res.locals.lang, "HappyMeter | Benvenuto", "HappyMeter | Welcome", "HappyMeter | Willkommen"),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Benvenuto",
      "HappyMeter | Welcome",
      "HappyMeter | Willkommen",
      "Scopri HappyMeter e il Feliciometro digitale per il benessere quotidiano",
      "Discover HappyMeter, the digital happiness journal for daily wellbeing",
      "Entdecke HappyMeter, das digitale Glueckstagebuch fuer dein taegliches Wohlbefinden",
      { robots: "noindex,nofollow" }
    )
  });
});

router.get("/welcome/2", (req, res) => {
  res.render("welcome-2", {
    layout: "layout-public",
    pageTitle: pick(res.locals.lang, "HappyMeter | Scopri l app", "HappyMeter | Discover the app", "HappyMeter | Entdecke die App"),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Scopri l app",
      "HappyMeter | Discover the app",
      "HappyMeter | Entdecke die App",
      "Panoramica di HappyMeter con test, diario, attivita felici e progressi personali",
      "Overview of HappyMeter with test, diary, happy activities and personal progress",
      "Ein Blick auf HappyMeter mit Test, Tagebuch, Gluecksaktivitaeten und persoenlichen Fortschritten",
      {
        robots: "noindex,nofollow",
        image: `${res.locals.siteUrl}${getPreviewImage(res.locals.lang, "prepagina-2")}`
      }
    )
  });
});

router.get("/", (req, res) => {
  res.render("index", {
    layout: "layout-public",
    pageTitle: pick(
      res.locals.lang,
      "HappyMeter | Feliciometro e Happy Score quotidiano",
      "HappyMeter | Daily happiness journal and Happy Score",
      "HappyMeter | Taegliches Glueckstagebuch und Happy Score"
    ),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Feliciometro e Happy Score quotidiano",
      "HappyMeter | Daily happiness journal and Happy Score",
      "HappyMeter | Taegliches Glueckstagebuch und Happy Score",
      "HappyMeter, anche cercato come Happy Meter, e il Feliciometro digitale per test della felicita, diario quotidiano, Happy Score, abitudini positive e insight personali",
      "HappyMeter, also searched as Happy Meter, is the digital happiness meter for happiness tests, daily journal, Happy Score, positive habits and personal insights",
      "HappyMeter, auch als Happy Meter gesucht, ist das digitale Gluecksmeter fuer Glueckstests, taegliches Tagebuch, Happy Score, positive Gewohnheiten und persoenliche Einblicke",
      { image: `${res.locals.siteUrl}${getPreviewImage(res.locals.lang, "dashboard-preview")}` }
    )
  });
});

router.get("/splash", (req, res) => {
  res.render("splash", {
    layout: "layout-public",
    pageTitle: pick(res.locals.lang, "HappyMeter | Introduzione", "HappyMeter | Intro", "HappyMeter | Einstieg"),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Introduzione",
      "HappyMeter | Intro",
      "HappyMeter | Einstieg",
      "Introduzione a HappyMeter e al test quotidiano del Feliciometro",
      "Introduction to HappyMeter and its daily happiness check",
      "Einleitung zu HappyMeter und dem taeglichen Happiness Check",
      { robots: "noindex,nofollow" }
    )
  });
});

router.get("/test", async (req, res) => {
  const db = getDb();
  const tests = await db.all("SELECT code, title, description FROM happy_tests WHERE status = 'active' ORDER BY sort_order ASC", []);
  const likeCounts = await getTestLikeCounts(db);

  res.render("test-selection", {
    layout: "layout-public",
    pageTitle: pick(res.locals.lang, "Scegli il tuo HappyMeter", "Choose your HappyMeter", "Waehle dein HappyMeter"),
    seo: buildSelectionSeo(res.locals.lang),
    tests: (tests.length ? tests : TEST_VARIANTS).map((test) => ({
      ...test,
      likesCount: likeCounts[String(test.code || "").toUpperCase()] || 0
    })),
    script: '<script src="/js/test-variants.js"></script>'
  });
});

router.get("/test/a", async (req, res) => {
  const db = getDb();
  const likeCounts = await getTestLikeCounts(db);
  res.render("test-a", {
    layout: "layout-public",
    pageTitle: "Test A - HappyMeter Classico",
    seo: buildSelectionSeo(res.locals.lang),
    result: null,
    values: {},
    liked: await hasUserLikedTest(db, req.session.userId, "A"),
    likeCount: likeCounts.A || 0,
    testCode: "A",
    script: '<script src="/js/test-variants.js"></script>'
  });
});

router.post("/test/a/submit", async (req, res, next) => {
  try {
    const db = getDb();
    const result = calculateHappyScore(mapTestAPayload(req.body));
    const values = { ...req.body };
    const lang = res.locals.lang;
    const anonymousSessionId = ensureAnonymousSessionId(req);
    const likeCounts = await getTestLikeCounts(db);

    await saveTestResult(db, {
      user_id: req.session.userId || null,
      anonymous_session_id: req.session.userId ? null : anonymousSessionId,
      test_code: "A",
      score: result.score,
      slider_score: result.score,
      missions_score: 0,
      reflection_score: normalizeText(req.body.summary_note).length >= 20 ? 5 : 0,
      reflection_text: normalizeText(req.body.summary_note).slice(0, 1000),
      answers_json: JSON.stringify(values),
      completed_missions_json: JSON.stringify([]),
      date: todayIso()
    });

    if (req.session.userId && req.body.saveResult === "1") {
      const existing = await db.get(
        "SELECT id FROM daily_entries WHERE user_id = ? AND entry_date = ?",
        [req.session.userId, todayIso()]
      );

      const payload = {
        user_id: req.session.userId,
        entry_date: todayIso(),
        happiness: Number(req.body.happiness || 5),
        energy: Number(req.body.energy || 5),
        sleep: Number(req.body.sleep || 5),
        stress: Number(req.body.stress || 5),
        mood: Number(req.body.day_satisfaction || 5),
        physical_activity: 5,
        nutrition: 5,
        outdoor_time: 5,
        rest_breaks: 5,
        self_care: 5,
        social_relations: Number(req.body.social_relations || 5),
        gratitude: Number(req.body.gratitude || 5),
        meaning: Number(req.body.meaning || 5),
        engagement: Number(req.body.meaning || 5),
        day_satisfaction: Number(req.body.day_satisfaction || 5),
        happy_score: result.score,
        score_band: result.band,
        result_label: result.label,
        result_explanation: result.explanation,
        components_json: JSON.stringify(result.components),
        note: normalizeText(req.body.summary_note),
        people_text: "",
        good_things_text: "",
        hard_things_text: "",
        gratitude_text: "",
        activities_text: "",
        is_public_preview: 1,
        updated_at: new Date().toISOString()
      };

      if (existing) {
        await db.update("daily_entries", payload, "id = ?", [existing.id]);
      } else {
        await db.insert("daily_entries", payload);
      }
    }

    res.render("test-a", {
      layout: "layout-public",
      pageTitle: "Test A - HappyMeter Classico",
      seo: buildSelectionSeo(lang),
      result: buildTestAResult(lang, result),
      values,
      liked: await hasUserLikedTest(db, req.session.userId, "A"),
      likeCount: likeCounts.A || 0,
      testCode: "A",
      script: '<script src="/js/test-variants.js"></script>'
    });
  } catch (error) {
    next(error);
  }
});

router.get("/test/b", async (req, res) => {
  const db = getDb();
  const anonymousSessionId = ensureAnonymousSessionId(req);
  const likeCounts = await getTestLikeCounts(db);
  const missions = await getOrCreateDailyMissions(db, {
    userId: req.session.userId || null,
    anonymousSessionId: req.session.userId ? null : anonymousSessionId,
    testCode: "B",
    date: todayIso(),
    count: 20,
    maxPoints: 95
  });

  res.render("test-b", {
    layout: "layout-public",
    pageTitle: "Test B - Missioni Felici",
    seo: buildSelectionSeo(res.locals.lang),
    missions,
    maxMissionPoints: buildMissionPointsSummary(missions),
    result: null,
    values: {},
    liked: await hasUserLikedTest(db, req.session.userId, "B"),
    likeCount: likeCounts.B || 0,
    testCode: "B",
    script: '<script src="/js/test-variants.js"></script>'
  });
});

router.post("/test/b/save", async (req, res, next) => {
  try {
    const db = getDb();
    const anonymousSessionId = ensureAnonymousSessionId(req);
    const likeCounts = await getTestLikeCounts(db);
    const missions = await getOrCreateDailyMissions(db, {
      userId: req.session.userId || null,
      anonymousSessionId: req.session.userId ? null : anonymousSessionId,
      testCode: "B",
      date: todayIso(),
      count: 20,
      maxPoints: 95
    });

    const result = calculateTestBResult(missions, req.body.missions, req.body.reflection_text);

    await saveTestResult(db, {
      user_id: req.session.userId || null,
      anonymous_session_id: req.session.userId ? null : anonymousSessionId,
      test_code: "B",
      score: result.score,
      slider_score: null,
      missions_score: result.missionsScore,
      reflection_score: result.reflectionScore,
      reflection_text: result.reflectionText,
      answers_json: JSON.stringify({ type: "missions-only" }),
      completed_missions_json: JSON.stringify(result.completedIds),
      date: todayIso()
    });

    res.render("test-b", {
      layout: "layout-public",
      pageTitle: "Test B - Missioni Felici",
      seo: buildSelectionSeo(res.locals.lang),
      missions,
      maxMissionPoints: buildMissionPointsSummary(missions),
      result: buildTestMissionResult(res.locals.lang, result, {
        breakdown: [
          { label: pick(res.locals.lang, "Punti missioni", "Mission points", "Missionspunkte"), value: `${result.missionsScore} / 95` },
          { label: pick(res.locals.lang, "Pensiero positivo", "Positive reflection", "Positiver Gedanke"), value: `${result.reflectionScore} / 5` },
          { label: pick(res.locals.lang, "Totale", "Total", "Gesamt"), value: `${result.score} / 100` }
        ]
      }),
      values: {
        missions: result.completedIds.map(String),
        reflection_text: result.reflectionText
      },
      liked: await hasUserLikedTest(db, req.session.userId, "B"),
      likeCount: likeCounts.B || 0,
      testCode: "B",
      script: '<script src="/js/test-variants.js"></script>'
    });
  } catch (error) {
    next(error);
  }
});

router.get("/test/c", async (req, res) => {
  const db = getDb();
  const anonymousSessionId = ensureAnonymousSessionId(req);
  const likeCounts = await getTestLikeCounts(db);
  const missions = await getOrCreateDailyMissions(db, {
    userId: req.session.userId || null,
    anonymousSessionId: req.session.userId ? null : anonymousSessionId,
    testCode: "C",
    date: todayIso(),
    count: 10,
    maxPoints: 40
  });

  res.render("test-c", {
    layout: "layout-public",
    pageTitle: "Test C - Ibrido",
    seo: buildSelectionSeo(res.locals.lang),
    missions,
    maxMissionPoints: buildMissionPointsSummary(missions),
    result: null,
    values: {},
    liked: await hasUserLikedTest(db, req.session.userId, "C"),
    likeCount: likeCounts.C || 0,
    testCode: "C",
    script: '<script src="/js/test-variants.js"></script>'
  });
});

router.post("/test/c/save", async (req, res, next) => {
  try {
    const db = getDb();
    const anonymousSessionId = ensureAnonymousSessionId(req);
    const likeCounts = await getTestLikeCounts(db);
    const missions = await getOrCreateDailyMissions(db, {
      userId: req.session.userId || null,
      anonymousSessionId: req.session.userId ? null : anonymousSessionId,
      testCode: "C",
      date: todayIso(),
      count: 10,
      maxPoints: 40
    });

    const result = calculateTestCResult(req.body, missions, req.body.missions, req.body.reflection_text);

    await saveTestResult(db, {
      user_id: req.session.userId || null,
      anonymous_session_id: req.session.userId ? null : anonymousSessionId,
      test_code: "C",
      score: result.score,
      slider_score: result.sliderScore,
      missions_score: result.missionsScore,
      reflection_score: result.reflectionScore,
      reflection_text: result.reflectionText,
      answers_json: JSON.stringify(result.answers),
      completed_missions_json: JSON.stringify(result.completedIds),
      date: todayIso()
    });

    res.render("test-c", {
      layout: "layout-public",
      pageTitle: "Test C - Ibrido",
      seo: buildSelectionSeo(res.locals.lang),
      missions,
      maxMissionPoints: buildMissionPointsSummary(missions),
      result: buildTestMissionResult(res.locals.lang, result, {
        breakdown: [
          { label: pick(res.locals.lang, "Punti risposte", "Slider points", "Antwortpunkte"), value: `${result.sliderScore} / 50` },
          { label: pick(res.locals.lang, "Punti missioni", "Mission points", "Missionspunkte"), value: `${result.missionsScore} / 40` },
          { label: pick(res.locals.lang, "Pensiero positivo", "Positive reflection", "Positiver Gedanke"), value: `${result.reflectionScore} / 10` },
          { label: pick(res.locals.lang, "Totale", "Total", "Gesamt"), value: `${result.score} / 100` }
        ]
      }),
      values: {
        ...req.body,
        missions: result.completedIds.map(String),
        reflection_text: result.reflectionText
      },
      liked: await hasUserLikedTest(db, req.session.userId, "C"),
      likeCount: likeCounts.C || 0,
      testCode: "C",
      script: '<script src="/js/test-variants.js"></script>'
    });
  } catch (error) {
    next(error);
  }
});

router.post("/test/:code/like", async (req, res) => {
  const testCode = String(req.params.code || "").toUpperCase();
  if (!["A", "B", "C"].includes(testCode)) {
    return res.status(404).json({ ok: false, message: "Test non trovato" });
  }

  if (!req.session.userId) {
    return res.status(401).json({
      ok: false,
      authRequired: true,
      message: "Accedi per votare il tuo test preferito"
    });
  }

  const db = getDb();
  const existing = await db.get("SELECT id FROM test_likes WHERE user_id = ? AND test_code = ?", [req.session.userId, testCode]);

  if (existing) {
    return res.json({
      ok: true,
      alreadyLiked: true,
      message: "Hai gia lasciato il tuo mi piace per questo test"
    });
  }

  await db.insert("test_likes", {
    user_id: req.session.userId,
    test_code: testCode
  });

  return res.json({
    ok: true,
    alreadyLiked: false,
    message: "Grazie, il tuo voto e stato salvato"
  });
});

router.get("/daily-test", (req, res) => {
  req.session.redirectTo = "/app/today";
  if (!req.session.userId) {
    setFlash(
      req,
      "error",
      pick(
        res.locals.lang,
        "Accedi o registrati per salvare il tuo test quotidiano",
        "Log in or sign up to save your daily test",
        "Melde dich an oder registriere dich, um deinen taeglichen Test zu speichern"
      )
    );
    return res.redirect("/login?redirect=/app/today");
  }
  return res.redirect("/app/today");
});

router.get("/community", async (req, res) => {
  return res.redirect(resolveChatRedirectTarget(req));
});

router.post("/community", async (req, res) => {
  if (!req.session.userId) {
    req.session.redirectTo = "/community";
    setFlash(
      req,
      "error",
      pick(
        res.locals.lang,
        "Accedi o registrati per scrivere nella chat globale",
        "Log in or sign up to write in the global chat",
        "Melde dich an oder registriere dich, um im globalen Chat zu schreiben"
      )
    );
    return res.redirect("/login?redirect=/app?chat=open");
  }

  const db = getDb();
  const user = await db.get("SELECT id, name, preferred_language FROM users WHERE id = ?", [req.session.userId]);
  const content = normalizeText(req.body.content);

  if (!content) {
    setFlash(
      req,
      "error",
      pick(
        res.locals.lang,
        "Scrivi un messaggio prima di inviare",
        "Write a message before sending",
        "Schreibe eine Nachricht, bevor du sie sendest"
      )
    );
    return res.redirect(resolveChatRedirectTarget(req));
  }

  await db.insert("community_posts", {
    user_id: user.id,
    author_name: user.name,
    content: content.slice(0, 500),
    language: user.preferred_language || res.locals.lang,
    is_demo: 0,
    is_hidden: 0
  });

  setFlash(
    req,
    "success",
    pick(
      res.locals.lang,
      "Messaggio pubblicato nella chat globale",
      "Message published in the global chat",
      "Nachricht im globalen Chat veroefentlicht"
    )
  );
  return res.redirect(resolveChatRedirectTarget(req));
});

router.post("/community/:id/like", async (req, res) => {
  if (!req.session.userId) {
    req.session.redirectTo = "/community";
    setFlash(
      req,
      "error",
      pick(
        res.locals.lang,
        "Accedi o registrati per lasciare una reazione",
        "Log in or sign up to leave a reaction",
        "Melde dich an oder registriere dich, um zu reagieren"
      )
    );
    return res.redirect("/login?redirect=/app?chat=open");
  }

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
    pick(
      res.locals.lang,
      "Hai lasciato una reazione positiva",
      "You left a positive reaction",
      "Du hast eine positive Reaktion hinterlassen"
    )
  );
  return res.redirect(resolveChatRedirectTarget(req));
});

router.get("/privacy", (req, res) => {
  res.render("privacy", {
    layout: "layout-public",
    pageTitle: pick(res.locals.lang, "Privacy Policy", "Privacy Policy", "Datenschutz"),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Privacy Policy",
      "HappyMeter | Privacy Policy",
      "HappyMeter | Datenschutz",
      "Informativa privacy di HappyMeter sul trattamento di account, diario, test quotidiano e preferenze",
      "HappyMeter privacy policy covering account data, diary entries, daily test inputs and preferences",
      "Datenschutzhinweise von HappyMeter zu Konto, Tagebuch, taeglichem Test und Einstellungen"
    )
  });
});

router.get("/cookie", (req, res) => {
  res.render("cookie", {
    layout: "layout-public",
    pageTitle: pick(res.locals.lang, "Cookie Policy", "Cookie Policy", "Cookie Richtlinie"),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Cookie Policy",
      "HappyMeter | Cookie Policy",
      "HappyMeter | Cookie Richtlinie",
      "Cookie policy di HappyMeter su sessione, lingua e preferenze essenziali",
      "HappyMeter cookie policy for session, language and essential preferences",
      "Cookie Hinweise von HappyMeter fuer Sitzung, Sprache und wesentliche Einstellungen"
    )
  });
});

router.get("/terms", (req, res) => {
  res.render("terms", {
    layout: "layout-public",
    pageTitle: pick(res.locals.lang, "Termini e condizioni", "Terms and conditions", "Nutzungsbedingungen"),
    seo: buildSeo(
      res.locals.lang,
      "HappyMeter | Termini e condizioni",
      "HappyMeter | Terms and conditions",
      "HappyMeter | Nutzungsbedingungen",
      "Termini e condizioni di HappyMeter per uso del diario digitale e del test quotidiano",
      "HappyMeter terms and conditions for using the digital journal and daily test",
      "Nutzungsbedingungen von HappyMeter fuer das digitale Tagebuch und den taeglichen Test"
    )
  });
});

module.exports = router;
