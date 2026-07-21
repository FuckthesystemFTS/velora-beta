const express = require("express");

const db = require("../db");
const { requireAdmin, requirePermission } = require("../middleware/adminOnly");
const { requiredText, toInt } = require("../utils/validators");
const { renderAdminPage } = require("../utils/viewHelpers");
const outreach = require("../services/outreachService");

const router = express.Router();

function can(req, permission) {
  if (resRoleAdmin(req)) {
    return true;
  }
  return req.res && req.res.locals.canPanelPermission(permission);
}

function resRoleAdmin(req) {
  return req.res && req.res.locals.currentAdmin && req.res.locals.currentAdmin.role === "admin";
}

function requireOutreach(permission) {
  return [requireAdmin, requirePermission(permission)];
}

function jsonError(res, error, status = 400) {
  return res.status(status).json({ ok: false, message: error.message || "Errore richiesta" });
}

async function pageData(extra = {}) {
  const [summary, searches, contacts, lists, templates, campaigns, queue, suppression, logs, dns] = await Promise.all([
    outreach.dashboard(),
    db.all("SELECT * FROM outreach_searches ORDER BY created_at DESC LIMIT 30"),
    db.all(
      `SELECT outreach_contacts.*, outreach_businesses.business_name, outreach_businesses.website_url
       FROM outreach_contacts
       LEFT JOIN outreach_businesses ON outreach_businesses.id = outreach_contacts.business_id
       ORDER BY outreach_contacts.created_at DESC LIMIT 80`
    ),
    db.all("SELECT * FROM outreach_lists ORDER BY created_at DESC LIMIT 50"),
    db.all("SELECT * FROM outreach_email_templates WHERE status != 'archived' ORDER BY is_default DESC, created_at DESC"),
    db.all("SELECT * FROM outreach_campaigns ORDER BY created_at DESC LIMIT 50"),
    db.all("SELECT * FROM outreach_campaign_recipients ORDER BY created_at DESC LIMIT 50"),
    db.all("SELECT * FROM outreach_suppression_list ORDER BY created_at DESC LIMIT 80"),
    db.all("SELECT * FROM outreach_audit_logs ORDER BY created_at DESC LIMIT 80"),
    outreach.dnsStatus()
  ]);
  return {
    summary,
    searches,
    contacts,
    lists,
    templates,
    campaigns,
    queue,
    suppression,
    logs,
    dns,
    config: outreach.outreachConfig(),
    masked: {
      googleCseKey: outreach.maskSecret(process.env.GOOGLE_CSE_API_KEY),
      googleCseId: outreach.maskSecret(process.env.GOOGLE_CSE_ID),
      placesKey: outreach.maskSecret(process.env.GOOGLE_PLACES_API_KEY),
      smtpPass: process.env.OUTREACH_SMTP_PASS ? "••••••••••••" : ""
    },
    ...extra
  };
}

async function renderOutreach(req, res, section = "overview", extra = {}) {
  return renderAdminPage(res, "Ricerca contatti e Outreach", "admin-outreach", await pageData({ section, ...extra }));
}

router.get("/admin/outreach", requireOutreach("outreach.view"), async (req, res) => renderOutreach(req, res));
router.get("/admin/outreach/search", requireOutreach("outreach.search"), async (req, res) => renderOutreach(req, res, "search"));
router.get("/admin/outreach/searches", requireOutreach("outreach.search"), async (req, res) => renderOutreach(req, res, "searches"));
router.get("/admin/outreach/lists", requireOutreach("outreach.lists.manage"), async (req, res) => renderOutreach(req, res, "lists"));
router.get("/admin/outreach/contacts", requireOutreach("outreach.contacts.manage"), async (req, res) => renderOutreach(req, res, "contacts"));
router.get("/admin/outreach/templates", requireOutreach("outreach.templates.manage"), async (req, res) => renderOutreach(req, res, "templates"));
router.get("/admin/outreach/campaigns", requireOutreach("outreach.campaigns.create"), async (req, res) => renderOutreach(req, res, "campaigns"));
router.get("/admin/outreach/queue", requireOutreach("outreach.campaigns.send"), async (req, res) => renderOutreach(req, res, "queue"));
router.get("/admin/outreach/suppression", requireOutreach("outreach.settings.manage"), async (req, res) => renderOutreach(req, res, "suppression"));
router.get("/admin/outreach/settings", requireOutreach("outreach.settings.manage"), async (req, res) => renderOutreach(req, res, "settings"));
router.get("/admin/outreach/logs", requireOutreach("outreach.logs.view"), async (req, res) => renderOutreach(req, res, "logs"));

router.post("/admin/outreach/lists", requireOutreach("outreach.lists.manage"), async (req, res) => {
  await db.insert("outreach_lists", {
    name: requiredText(req.body.name) || "Nuova lista",
    description: requiredText(req.body.description),
    created_by_user_id: req.session.adminId,
    contact_count: 0,
    status: "active"
  });
  req.session.flash = { type: "success", message: "Lista creata" };
  return res.redirect("/admin/outreach/lists");
});

router.post("/admin/outreach/search", requireOutreach("outreach.search"), async (req, res) => {
  try {
    const id = await outreach.createSearch(req.body, req.session.adminId);
    const result = await outreach.startSearch(id, req.session.adminId);
    req.session.flash = {
      type: result.status === "completed" ? "success" : "error",
      message: result.status === "completed" ? "Ricerca completata" : result.error_message || "Ricerca non completata"
    };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  return res.redirect("/admin/outreach/searches");
});

router.post("/admin/outreach/templates", requireOutreach("outreach.templates.manage"), async (req, res) => {
  await db.insert("outreach_email_templates", {
    name: requiredText(req.body.name) || "Nuovo modello",
    subject: requiredText(req.body.subject),
    html_body: outreach.sanitizeTemplateHtml(req.body.html_body),
    text_body: requiredText(req.body.text_body),
    sender_name: requiredText(req.body.sender_name || "CreatorSpeaker TV"),
    reply_to: requiredText(req.body.reply_to || "service@creatorspeakertv.it"),
    category: requiredText(req.body.category || "presentazione"),
    is_default: req.body.is_default ? 1 : 0,
    status: requiredText(req.body.status || "active"),
    created_by_user_id: req.session.adminId,
    updated_by_user_id: req.session.adminId
  });
  req.session.flash = { type: "success", message: "Modello salvato" };
  return res.redirect("/admin/outreach/templates");
});

router.post("/admin/outreach/import", requireOutreach("outreach.contacts.manage"), async (req, res) => {
  const emails = String(req.body.emails || "")
    .split(/[\s,;]+/)
    .map(outreach.normalizeEmail)
    .filter(Boolean)
    .slice(0, 100);
  let imported = 0;
  for (const email of emails) {
    const result = await outreach.insertContact({
      email,
      sourceUrl: requiredText(req.body.source_url || "manual_import"),
      sourceTitle: "Importazione manuale",
      context: requiredText(req.body.authorization_note)
    });
    if (result.inserted) {
      imported += 1;
    }
  }
  req.session.flash = { type: "success", message: `Importati ${imported} contatti nuovi` };
  return res.redirect("/admin/outreach/contacts");
});

router.post("/admin/outreach/contacts/:id/approve", requireOutreach("outreach.contacts.manage"), async (req, res) => {
  try {
    await outreach.approveContact(req.params.id, req.session.adminId, req.body);
    req.session.flash = { type: "success", message: "Contatto approvato" };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  return res.redirect("/admin/outreach/contacts");
});

router.post("/admin/outreach/contacts/:id/reject", requireOutreach("outreach.contacts.manage"), async (req, res) => {
  await outreach.rejectContact(req.params.id, req.session.adminId, req.body.reason);
  req.session.flash = { type: "success", message: "Contatto rifiutato" };
  return res.redirect("/admin/outreach/contacts");
});

router.post("/admin/outreach/campaigns", requireOutreach("outreach.campaigns.create"), async (req, res) => {
  try {
    await outreach.createCampaign(req.body, req.session.adminId);
    req.session.flash = { type: "success", message: "Campagna creata" };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  return res.redirect("/admin/outreach/campaigns");
});

router.post("/admin/outreach/campaigns/:id/start", requireOutreach("outreach.campaigns.send"), async (req, res) => {
  try {
    await outreach.queueCampaign(req.params.id, req.session.adminId);
    req.session.flash = { type: "success", message: "Campagna messa in coda" };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  return res.redirect("/admin/outreach/campaigns");
});

router.post("/admin/outreach/suppression", requireOutreach("outreach.settings.manage"), async (req, res) => {
  const email = outreach.normalizeEmail(req.body.email);
  if (email) {
    const existing = await db.get("SELECT id FROM outreach_suppression_list WHERE normalized_email = ?", [email]);
    if (!existing) {
      await db.insert("outreach_suppression_list", {
        email,
        normalized_email: email,
        reason: requiredText(req.body.reason || "manual"),
        source: "admin",
        created_by_user_id: req.session.adminId
      });
    }
  }
  req.session.flash = { type: "success", message: "Esclusione salvata" };
  return res.redirect("/admin/outreach/suppression");
});

router.post("/api/outreach/searches", requireOutreach("outreach.search"), async (req, res) => {
  try {
    const id = await outreach.createSearch(req.body, req.session.adminId);
    return res.json({ ok: true, id });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.get("/api/outreach/searches/:id", requireOutreach("outreach.search"), async (req, res) => {
  const row = await db.get("SELECT * FROM outreach_searches WHERE id = ?", [req.params.id]);
  return row ? res.json({ ok: true, search: row }) : res.status(404).json({ ok: false });
});

router.post("/api/outreach/searches/:id/start", requireOutreach("outreach.search"), async (req, res) => {
  try {
    const result = await outreach.startSearch(req.params.id, req.session.adminId);
    return res.json({ ok: true, search: result });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.post("/api/outreach/searches/:id/cancel", requireOutreach("outreach.search"), async (req, res) => {
  await db.run("UPDATE outreach_searches SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    req.params.id
  ]);
  return res.json({ ok: true });
});

router.post("/api/outreach/contacts/:id/approve", requireOutreach("outreach.contacts.manage"), async (req, res) => {
  try {
    await outreach.approveContact(req.params.id, req.session.adminId, req.body);
    return res.json({ ok: true });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.post("/api/outreach/contacts/:id/reject", requireOutreach("outreach.contacts.manage"), async (req, res) => {
  await outreach.rejectContact(req.params.id, req.session.adminId, req.body.reason);
  return res.json({ ok: true });
});

router.post("/api/outreach/campaigns", requireOutreach("outreach.campaigns.create"), async (req, res) => {
  try {
    const id = await outreach.createCampaign(req.body, req.session.adminId);
    return res.json({ ok: true, id });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.post("/api/outreach/campaigns/:id/preview", requireOutreach("outreach.campaigns.create"), async (req, res) => {
  const campaign = await db.get("SELECT * FROM outreach_campaigns WHERE id = ?", [req.params.id]);
  return res.json({ ok: Boolean(campaign), campaign });
});

router.post("/api/outreach/campaigns/:id/test-send", requireOutreach("outreach.campaigns.send"), async (req, res) => {
  try {
    await outreach.verifySmtpAndSendTest(req.body.to_email);
    return res.json({ ok: true });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.post("/api/outreach/campaigns/:id/start", requireOutreach("outreach.campaigns.send"), async (req, res) => {
  try {
    await outreach.queueCampaign(req.params.id, req.session.adminId);
    return res.json({ ok: true });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.post("/api/outreach/campaigns/:id/pause", requireOutreach("outreach.campaigns.send"), async (req, res) => {
  await db.run("UPDATE outreach_campaigns SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  return res.json({ ok: true });
});
router.post("/api/outreach/campaigns/:id/resume", requireOutreach("outreach.campaigns.send"), async (req, res) => {
  await db.run("UPDATE outreach_campaigns SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  return res.json({ ok: true });
});
router.post("/api/outreach/campaigns/:id/cancel", requireOutreach("outreach.campaigns.send"), async (req, res) => {
  await db.run("UPDATE outreach_campaigns SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  return res.json({ ok: true });
});

router.post("/admin/outreach/smtp-test", requireOutreach("outreach.settings.manage"), async (req, res) => {
  try {
    await outreach.verifySmtpAndSendTest(req.body.to_email);
    req.session.flash = { type: "success", message: "Test SMTP outreach inviato" };
  } catch (error) {
    req.session.flash = { type: "error", message: `Test SMTP non riuscito: ${error.message}` };
  }
  return res.redirect("/admin/outreach/settings");
});

router.get("/outreach/unsubscribe/:token", async (req, res) => {
  await outreach.unsubscribe(req.params.token);
  return res.render("layout-public", {
    title: "Disiscrizione confermata",
    bodyTemplate: "outreach-unsubscribe",
    page: {},
    data: {}
  });
});

module.exports = router;
