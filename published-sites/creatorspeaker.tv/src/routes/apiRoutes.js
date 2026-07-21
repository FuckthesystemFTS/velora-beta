const express = require("express");

const db = require("../db");
const { requirePermission } = require("../middleware/adminOnly");
const schedulerService = require("../services/schedulerService");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "creatorspeaker-tv",
    version: "1.0.0"
  });
});

router.get("/api/status", async (req, res) => {
  res.json({
    ok: true,
    service: "creatorspeaker-tv",
    version: "1.0.0"
  });
});

router.get("/api/offers/latest", async (req, res) => {
  const offers = await db.all(
    "SELECT * FROM offers WHERE status IN ('approved', 'published_telegram', 'published_facebook') ORDER BY created_at DESC LIMIT 12"
  );
  res.json({
    ok: true,
    offers
  });
});

router.post("/api/admin/run-offer-search", requirePermission("offers"), async (req, res) => {
  const result = await schedulerService.runOfferSearchNow();
  res.json({
    ok: true,
    result
  });
});

router.post("/api/admin/run-daily-offer", requirePermission("offers"), async (req, res) => {
  const result = await schedulerService.runDailyOfferNow();
  res.json({
    ok: true,
    result
  });
});

module.exports = router;
