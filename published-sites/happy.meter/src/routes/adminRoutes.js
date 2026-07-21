const express = require("express");
const bcrypt = require("bcrypt");

const { getDb } = require("../../db");
const adminOnly = require("../middleware/adminOnly");
const { stringifySafeJson } = require("../utils/safeJson");
const { normalizeText } = require("../utils/validators");

const router = express.Router();

function setFlash(req, type, text) {
  req.session.flash = { type, text };
}

function normalizeBanDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return duration;
}

router.get("/admin", (req, res) => {
  if (req.session.adminId) {
    return res.redirect("/admin/dashboard");
  }
  return res.redirect("/admin/login");
});

router.get("/admin/login", (req, res) => {
  res.render("admin-login", {
    layout: "layout-admin",
    pageTitle: "Admin login",
    errors: []
  });
});

router.post("/admin/login", async (req, res) => {
  const db = getDb();
  const admin = await db.get("SELECT * FROM admin_users WHERE username = ?", [normalizeText(req.body.username)]);
  if (!admin || !(await bcrypt.compare(req.body.password || "", admin.password_hash))) {
    return res.status(401).render("admin-login", {
      layout: "layout-admin",
      pageTitle: "Admin login",
      errors: ["Credenziali admin non valide"]
    });
  }
  req.session.adminId = admin.id;
  setFlash(req, "success", "Accesso admin effettuato.");
  return res.redirect("/admin/dashboard");
});

router.post("/admin/logout", (req, res) => {
  req.session.adminId = null;
  res.redirect("/admin/login");
});

router.use("/admin", adminOnly);

router.get("/admin/dashboard", async (req, res) => {
  const db = getDb();
  const [users, entries, activities, badges, gestures, visiblePosts, hiddenPosts, testResults, resets] = await Promise.all([
    db.get("SELECT COUNT(*) AS count FROM users", []),
    db.get("SELECT COUNT(*) AS count FROM daily_entries", []),
    db.get("SELECT COUNT(*) AS count FROM user_activities", []),
    db.get("SELECT COUNT(*) AS count FROM user_badges", []),
    db.get("SELECT COUNT(*) AS count FROM happy_gestures WHERE active = 1", []),
    db.get("SELECT COUNT(*) AS count FROM community_posts WHERE is_hidden = 0 AND is_demo = 0", []),
    db.get("SELECT COUNT(*) AS count FROM community_posts WHERE is_hidden = 1", []),
    db.get("SELECT COUNT(*) AS count FROM test_results", []),
    db.get("SELECT COUNT(*) AS count FROM password_reset_tokens WHERE used_at IS NULL", [])
  ]);
  const [latestUsers, latestEntries, latestPosts, latestResults] = await Promise.all([
    db.all(
      "SELECT id, name, email, preferred_language, points, current_streak, ban_status, created_at FROM users ORDER BY created_at DESC LIMIT 8",
      []
    ),
    db.all(
      `SELECT de.entry_date, de.happy_score, de.score_band, de.result_label, u.name, u.email
       FROM daily_entries de
       LEFT JOIN users u ON u.id = de.user_id
       ORDER BY de.created_at DESC
       LIMIT 8`,
      []
    ),
    db.all(
      `SELECT cp.id, cp.author_name, cp.content, cp.language, cp.is_hidden, cp.created_at, u.email
       FROM community_posts cp
       LEFT JOIN users u ON u.id = cp.user_id
       WHERE cp.is_demo = 0
       ORDER BY cp.created_at DESC
       LIMIT 8`,
      []
    ),
    db.all(
      `SELECT tr.test_code, tr.score, tr.date, tr.created_at, u.name, u.email
       FROM test_results tr
       LEFT JOIN users u ON u.id = tr.user_id
       ORDER BY tr.created_at DESC
       LIMIT 8`,
      []
    )
  ]);

  res.render("admin-dashboard", {
    layout: "layout-admin",
    pageTitle: "Admin dashboard",
    stats: { users, entries, activities, badges, gestures, visiblePosts, hiddenPosts, testResults, resets },
    latestUsers,
    latestEntries,
    latestPosts,
    latestResults,
    emailConfig: {
      host: process.env.SMTP_HOST || "",
      user: process.env.SMTP_USER || "",
      from: process.env.MAIL_FROM || "",
      hasPassword: Boolean(process.env.SMTP_PASS)
    }
  });
});

router.get("/admin/users", async (req, res) => {
  const db = getDb();
  const users = await db.all(
    "SELECT id, name, email, preferred_language, points, level, current_streak, happy_gesture_streak, ban_status, ban_reason, banned_until, created_at FROM users ORDER BY created_at DESC",
    []
  );
  res.render("admin-users", {
    layout: "layout-admin",
    pageTitle: "Utenti",
    users
  });
});

router.get("/admin/activities", async (req, res) => {
  const db = getDb();
  const activities = await db.all("SELECT * FROM activities ORDER BY created_at DESC", []);
  res.render("admin-activities", {
    layout: "layout-admin",
    pageTitle: "Attività",
    activities
  });
});

router.post("/admin/activities", async (req, res) => {
  const db = getDb();
  await db.insert("activities", {
    name_it: normalizeText(req.body.name_it),
    name_en: normalizeText(req.body.name_en || req.body.name_it),
    name_de: normalizeText(req.body.name_de || req.body.name_it),
    name_es: normalizeText(req.body.name_es || req.body.name_it),
    description_it: normalizeText(req.body.description_it),
    description_en: normalizeText(req.body.description_en || req.body.description_it),
    description_de: normalizeText(req.body.description_de || req.body.description_it),
    description_es: normalizeText(req.body.description_es || req.body.description_it),
    category: normalizeText(req.body.category || "custom"),
    points: Number(req.body.points || 5),
    icon: normalizeText(req.body.icon || "✨"),
    active: req.body.active ? 1 : 0
  });
  setFlash(req, "success", "Nuova attività creata.");
  res.redirect("/admin/activities");
});

router.post("/admin/activities/:id/toggle", async (req, res) => {
  const db = getDb();
  await db.run("UPDATE activities SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Stato attività aggiornato.");
  res.redirect("/admin/activities");
});

router.get("/admin/gestures", async (req, res) => {
  const db = getDb();
  const gestures = await db.all("SELECT * FROM happy_gestures ORDER BY created_at DESC", []);
  res.render("admin-gestures", {
    layout: "layout-admin",
    pageTitle: "Gesti felici",
    gestures
  });
});

router.post("/admin/gestures", async (req, res) => {
  const db = getDb();
  await db.insert("happy_gestures", {
    text_it: normalizeText(req.body.text_it),
    text_en: normalizeText(req.body.text_en || req.body.text_it),
    text_de: normalizeText(req.body.text_de || req.body.text_it),
    text_es: normalizeText(req.body.text_es || req.body.text_it),
    points: Number(req.body.points || 15),
    active: req.body.active ? 1 : 0
  });
  setFlash(req, "success", "Nuovo gesto creato.");
  res.redirect("/admin/gestures");
});

router.post("/admin/gestures/:id/toggle", async (req, res) => {
  const db = getDb();
  await db.run("UPDATE happy_gestures SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Stato gesto aggiornato.");
  res.redirect("/admin/gestures");
});

router.get("/admin/badges", async (req, res) => {
  const db = getDb();
  const badges = await db.all("SELECT * FROM badges ORDER BY id ASC", []);
  res.render("admin-badges", {
    layout: "layout-admin",
    pageTitle: "Badge",
    badges
  });
});

router.post("/admin/badges", async (req, res) => {
  const db = getDb();
  await db.insert("badges", {
    code: normalizeText(req.body.code).toLowerCase(),
    name_it: normalizeText(req.body.name_it),
    name_en: normalizeText(req.body.name_en || req.body.name_it),
    name_de: normalizeText(req.body.name_de || req.body.name_it),
    name_es: normalizeText(req.body.name_es || req.body.name_it),
    description_it: normalizeText(req.body.description_it),
    description_en: normalizeText(req.body.description_en || req.body.description_it),
    description_de: normalizeText(req.body.description_de || req.body.description_it),
    description_es: normalizeText(req.body.description_es || req.body.description_it),
    icon: normalizeText(req.body.icon || "🏆"),
    rule_json: stringifySafeJson({ manual: true }),
    active: req.body.active ? 1 : 0
  });
  setFlash(req, "success", "Nuovo badge creato.");
  res.redirect("/admin/badges");
});

router.post("/admin/badges/:id/toggle", async (req, res) => {
  const db = getDb();
  await db.run("UPDATE badges SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Stato badge aggiornato.");
  res.redirect("/admin/badges");
});

router.get("/admin/community", async (req, res) => {
  const db = getDb();
  const posts = await db.all(
    `SELECT cp.*, u.email
     FROM community_posts cp
     LEFT JOIN users u ON u.id = cp.user_id
     ORDER BY cp.created_at DESC`,
    []
  );
  res.render("admin-community", {
    layout: "layout-admin",
    pageTitle: "Community",
    posts
  });
});

router.post("/admin/users/:id/ban", async (req, res) => {
  const db = getDb();
  const mode = normalizeText(req.body.mode || "temporary").toLowerCase();
  const reason = normalizeText(req.body.reason || "Moderazione community");
  const payload = {
    ban_status: mode === "permanent" ? "permanent" : "temporary",
    ban_reason: reason,
    banned_at: new Date().toISOString(),
    banned_by_admin_id: req.session.adminId,
    updated_at: new Date().toISOString()
  };

  if (payload.ban_status === "temporary") {
    const days = normalizeBanDuration(req.body.days) || 7;
    payload.banned_until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  } else {
    payload.banned_until = null;
  }

  await db.update("users", payload, "id = ?", [req.params.id]);
  setFlash(req, "success", "Utente sospeso con successo");
  return res.redirect("/admin/users");
});

router.post("/admin/users/:id/unban", async (req, res) => {
  const db = getDb();
  await db.update(
    "users",
    {
      ban_status: "active",
      ban_reason: null,
      banned_until: null,
      banned_at: null,
      banned_by_admin_id: null,
      updated_at: new Date().toISOString()
    },
    "id = ?",
    [req.params.id]
  );
  setFlash(req, "success", "Utente riattivato");
  return res.redirect("/admin/users");
});

router.post("/admin/community/:id/hide", async (req, res) => {
  const db = getDb();
  await db.update(
    "community_posts",
    {
      is_hidden: 1,
      hidden_reason: normalizeText(req.body.reason || "Contenuto moderato"),
      hidden_at: new Date().toISOString(),
      hidden_by_admin_id: req.session.adminId
    },
    "id = ?",
    [req.params.id]
  );
  setFlash(req, "success", "Messaggio nascosto dalla chat globale");
  return res.redirect("/admin/community");
});

router.post("/admin/community/:id/unhide", async (req, res) => {
  const db = getDb();
  await db.update(
    "community_posts",
    {
      is_hidden: 0,
      hidden_reason: null,
      hidden_at: null,
      hidden_by_admin_id: null
    },
    "id = ?",
    [req.params.id]
  );
  setFlash(req, "success", "Messaggio ripristinato");
  return res.redirect("/admin/community");
});

router.get("/admin/tests", async (req, res) => {
  const db = getDb();
  const [tests, latestResults, missionCatalog, missionResults] = await Promise.all([
    db.all(
      `SELECT ht.code,
              ht.title,
              ht.description,
              COUNT(DISTINCT tr.id) AS completions,
              COALESCE(ROUND(AVG(tr.score)), 0) AS average_score,
              COUNT(DISTINCT tl.id) AS likes_count
       FROM happy_tests ht
       LEFT JOIN test_results tr ON tr.test_code = ht.code
       LEFT JOIN test_likes tl ON tl.test_code = ht.code
       GROUP BY ht.code, ht.title, ht.description
       ORDER BY ht.sort_order ASC`,
      []
    ),
    db.all(
      `SELECT tr.test_code, tr.score, tr.date, tr.created_at, u.name
       FROM test_results tr
       LEFT JOIN users u ON u.id = tr.user_id
       ORDER BY tr.created_at DESC
       LIMIT 18`,
      []
    ),
    db.all("SELECT id, text FROM happiness_missions ORDER BY id ASC", []),
    db.all("SELECT completed_missions_json FROM test_results WHERE completed_missions_json IS NOT NULL", [])
  ]);

  const missionMap = new Map(missionCatalog.map((mission) => [Number(mission.id), mission.text]));
  const missionCounters = new Map();

  for (const row of missionResults) {
    let ids = [];
    try {
      ids = JSON.parse(row.completed_missions_json || "[]");
    } catch (error) {
      ids = [];
    }
    ids.forEach((id) => {
      const numericId = Number(id);
      if (!Number.isFinite(numericId) || !missionMap.has(numericId)) {
        return;
      }
      missionCounters.set(numericId, (missionCounters.get(numericId) || 0) + 1);
    });
  }

  const topMissions = Array.from(missionCounters.entries())
    .map(([id, completedCount]) => ({
      text: missionMap.get(id),
      completedCount
    }))
    .sort((left, right) => right.completedCount - left.completedCount)
    .slice(0, 12);

  res.render("admin-tests", {
    layout: "layout-admin",
    pageTitle: "Test HappyMeter",
    tests,
    latestResults,
    topMissions
  });
});

router.get("/admin/settings", async (req, res) => {
  const db = getDb();
  const settings = await db.all("SELECT * FROM settings ORDER BY key ASC", []);
  res.render("admin-settings", {
    layout: "layout-admin",
    pageTitle: "Settings",
    settings,
    emailConfig: {
      host: process.env.SMTP_HOST || "",
      port: process.env.SMTP_PORT || "",
      secure: process.env.SMTP_SECURE || "",
      user: process.env.SMTP_USER || "",
      from: process.env.MAIL_FROM || "",
      replyTo: process.env.MAIL_REPLY_TO || "",
      hasPassword: Boolean(process.env.SMTP_PASS)
    }
  });
});

router.post("/admin/settings", async (req, res) => {
  const db = getDb();
  const record = await db.get("SELECT key FROM settings WHERE key = ?", ["base"]);
  const payload = stringifySafeJson({
    siteName: normalizeText(req.body.siteName || "HappyMeter"),
    premiumStatus: normalizeText(req.body.premiumStatus || "coming-soon"),
    supportEmail: normalizeText(req.body.supportEmail || "info@happymeter.it")
  });

  if (record) {
    await db.run("UPDATE settings SET value_json = ?, updated_at = ? WHERE key = ?", [
      payload,
      new Date().toISOString(),
      "base"
    ]);
  } else {
    await db.insert("settings", {
      key: "base",
      value_json: payload
    });
  }
  setFlash(req, "success", "Impostazioni aggiornate.");
  res.redirect("/admin/settings");
});

router.post("/admin/password", async (req, res) => {
  const db = getDb();
  if ((req.body.password || "").length < 8) {
    setFlash(req, "error", "La password admin deve avere almeno 8 caratteri.");
    return res.redirect("/admin/settings");
  }
  const hash = await bcrypt.hash(req.body.password, 10);
  await db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", [hash, req.session.adminId]);
  setFlash(req, "success", "Password admin aggiornata.");
  return res.redirect("/admin/settings");
});

module.exports = router;
