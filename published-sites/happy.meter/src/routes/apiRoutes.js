const express = require("express");

const { getDb } = require("../../db");
const { todayIso } = require("../utils/dates");
const { normalizeText } = require("../utils/validators");

const router = express.Router();

function authRequiredResponse(message) {
  return {
    ok: false,
    error: "auth-required",
    authRequired: true,
    message
  };
}

async function getChatMessages(db, currentUserId) {
  return db.all(
    `SELECT cp.id,
            cp.author_name,
            cp.content,
            cp.language,
            cp.created_at,
            COUNT(cpl.id) AS likes_count,
            MAX(CASE WHEN cpl.user_id = ? THEN 1 ELSE 0 END) AS liked_by_me
     FROM community_posts cp
     LEFT JOIN community_post_likes cpl ON cpl.post_id = cp.id
     WHERE cp.is_hidden = 0 AND cp.is_demo = 0
     GROUP BY cp.id
     ORDER BY cp.created_at DESC
     LIMIT 60`,
    [currentUserId || 0]
  );
}

router.get("/api/summary", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json(authRequiredResponse("Accedi per vedere il riepilogo"));
  }
  const db = getDb();
  const entries = await db.all(
    "SELECT entry_date, happy_score, sleep, stress, physical_activity FROM daily_entries WHERE user_id = ? ORDER BY entry_date ASC",
    [req.session.userId]
  );
  return res.json({
    ok: true,
    entries
  });
});

router.get("/api/chat/messages", async (req, res) => {
  const db = getDb();
  const messages = await getChatMessages(db, req.session.userId);

  return res.json({
    ok: true,
    canPost: Boolean(req.session.userId),
    messages: messages.reverse().map((message) => ({
      id: message.id,
      authorName: message.author_name,
      content: message.content,
      language: message.language,
      createdAt: message.created_at,
      likesCount: Number(message.likes_count || 0),
      likedByMe: Number(message.liked_by_me || 0) === 1
    }))
  });
});

router.post("/api/chat/messages", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json(authRequiredResponse("Devi accedere per scrivere nella chat"));
  }

  const db = getDb();
  const user = await db.get("SELECT id, name, preferred_language FROM users WHERE id = ?", [req.session.userId]);
  const content = normalizeText(req.body.content).slice(0, 500);

  if (!content) {
    return res.status(422).json({ ok: false, error: "content-required" });
  }

  await db.insert("community_posts", {
    user_id: user.id,
    author_name: user.name,
    content,
    language: user.preferred_language || "it",
    is_demo: 0,
    is_hidden: 0
  });

  const messages = await getChatMessages(db, req.session.userId);
  return res.status(201).json({
    ok: true,
    messages: messages.reverse().map((message) => ({
      id: message.id,
      authorName: message.author_name,
      content: message.content,
      language: message.language,
      createdAt: message.created_at,
      likesCount: Number(message.likes_count || 0),
      likedByMe: Number(message.liked_by_me || 0) === 1
    }))
  });
});

router.post("/api/chat/messages/:id/like", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json(authRequiredResponse("Devi accedere per lasciare una reazione"));
  }

  const db = getDb();
  const post = await db.get("SELECT id FROM community_posts WHERE id = ? AND is_hidden = 0 AND is_demo = 0", [req.params.id]);
  if (!post) {
    return res.status(404).json({ ok: false, error: "message-not-found" });
  }

  const existing = await db.get(
    "SELECT id FROM community_post_likes WHERE user_id = ? AND post_id = ?",
    [req.session.userId, req.params.id]
  );

  if (existing) {
    await db.run("DELETE FROM community_post_likes WHERE id = ?", [existing.id]);
  } else {
    await db.insert("community_post_likes", {
      user_id: req.session.userId,
      post_id: Number(req.params.id)
    });
  }

  const updated = await db.get(
    `SELECT COUNT(*) AS likes_count,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS liked_by_me
     FROM community_post_likes
     WHERE post_id = ?`,
    [req.session.userId, req.params.id]
  );

  return res.json({
    ok: true,
    likesCount: Number(updated?.likes_count || 0),
    likedByMe: Number(updated?.liked_by_me || 0) === 1
  });
});

router.get("/api/test/:code/daily-missions", async (req, res) => {
  const testCode = String(req.params.code || "").toUpperCase();
  if (!["B", "C"].includes(testCode)) {
    return res.status(404).json({ ok: false, error: "test-not-found" });
  }

  const db = getDb();
  const sessionId = req.session.anonymousSessionId || req.sessionID || null;
  const rows = await db.all(
    `SELECT dtm.id,
            dtm.test_code,
            dtm.date,
            dtm.mission_id,
            dtm.normalized_points,
            hm.text
     FROM daily_test_missions dtm
     JOIN happiness_missions hm ON hm.id = dtm.mission_id
     WHERE dtm.test_code = ? AND dtm.date = ?
       AND ((dtm.user_id IS NOT NULL AND dtm.user_id = ?) OR (dtm.user_id IS NULL AND dtm.anonymous_session_id = ?))
     ORDER BY dtm.id ASC`,
    [testCode, todayIso(), req.session.userId || 0, req.session.userId ? null : sessionId]
  );

  return res.json({
    ok: true,
    testCode,
    missions: rows.map((row) => ({
      id: row.mission_id,
      text: row.text,
      points: Number(row.normalized_points || 0),
      date: row.date
    }))
  });
});

module.exports = router;
