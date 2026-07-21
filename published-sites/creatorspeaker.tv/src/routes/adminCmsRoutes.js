const express = require("express");
const multer = require("multer");

const db = require("../db");
const { requireAdmin, requirePermission } = require("../middleware/adminOnly");
const { verifyCsrfAfterUpload } = require("../middleware/formSecurity");
const { requiredText } = require("../utils/validators");
const { getSiteSettings, renderAdminPage } = require("../utils/viewHelpers");
const mediaService = require("../services/mediaService");
const cmsService = require("../services/cmsService");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(Number(process.env.MAX_VIDEO_UPLOAD_MB || 200), 25) * 1024 * 1024
  }
});

async function adminCmsBase(extra = {}) {
  return {
    ...(await getSiteSettings()),
    cloudinary: mediaService.getCloudinaryStatus(),
    mediaOptions: await cmsService.getMediaOptions(),
    ...extra
  };
}

async function audit(req, action, entityType, entityId, details = "") {
  await mediaService.logAdmin(req.session.adminId, action, entityType, entityId, details);
}

function handleUpload(middleware, fallbackPath) {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (!error) {
        return next();
      }
      req.session.flash = { type: "error", message: error.message || "Upload non riuscito" };
      return res.redirect(fallbackPath);
    });
  };
}

router.use("/admin/media", requirePermission("media"));
router.use("/admin/home", requirePermission("cms_sections"));
router.use("/admin/site", requirePermission("cms_sections"));
router.use("/admin/sections", requirePermission("cms_sections"));
router.use("/admin/cms-packages", requirePermission("cms_packages"));
router.use("/admin/creators", requirePermission("creators"));
router.use("/admin/speakers", requirePermission("speakers"));
router.use("/admin/brands", requirePermission("brands"));
router.use("/admin/smart-tv", requirePermission("smart_tv"));
router.use("/admin/requests", requirePermission("requests"));
router.use("/admin/logs", requirePermission("logs"));

router.get("/admin/media", requireAdmin, async (req, res) => {
  const type = requiredText(req.query.type);
  const q = requiredText(req.query.q);
  return renderAdminPage(res, "Media Library", "admin-media", await adminCmsBase({
    media: await mediaService.listMediaAssets({ type, q }),
    filters: { type, q }
  }));
});

router.post(
  "/admin/media/upload",
  requireAdmin,
  handleUpload(upload.single("file"), "/admin/media"),
  verifyCsrfAfterUpload("/admin/media"),
  async (req, res) => {
  try {
    const id = await mediaService.createMediaAsset({
      file: req.file,
      body: req.body,
      adminId: req.session.adminId
    });
    await audit(req, "upload_media", "media_assets", id, requiredText(req.body.title || req.file.originalname));
    req.session.flash = { type: "success", message: "Media caricato su Cloudinary." };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  return res.redirect("/admin/media");
});

router.post("/admin/media/:id", requireAdmin, async (req, res) => {
  await db.run(
    "UPDATE media_assets SET title = ?, alt_text = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [requiredText(req.body.title), requiredText(req.body.alt_text), requiredText(req.body.description), req.params.id]
  );
  await audit(req, "update_media", "media_assets", req.params.id, requiredText(req.body.title));
  req.session.flash = { type: "success", message: "Media aggiornato." };
  return res.redirect("/admin/media");
});

router.post("/admin/media/:id/delete", requireAdmin, async (req, res) => {
  const media = await db.get("SELECT * FROM media_assets WHERE id = ?", [req.params.id]);
  if (!media) {
    req.session.flash = { type: "error", message: "Media non trovato." };
    return res.redirect("/admin/media");
  }
  try {
    const result = await mediaService.deleteFromCloudinary(media.cloudinary_public_id, media.resource_type);
    await db.run("UPDATE media_assets SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [media.id]);
    await audit(req, "delete_media", "media_assets", media.id, result.ok ? media.title : `${media.title} - Cloudinary non confermato`);
    req.session.flash = { type: result.ok ? "success" : "warning", message: result.ok ? "Media eliminato." : "Media archiviato. Verifica Cloudinary non completata." };
  } catch (error) {
    req.session.flash = { type: "error", message: "Eliminazione Cloudinary non riuscita. Il record non e stato eliminato." };
  }
  return res.redirect("/admin/media");
});

router.get("/admin/home", requireAdmin, async (req, res) => {
  return renderAdminPage(res, "Home Page", "admin-cms-sections", await adminCmsBase({
    pageKey: "home",
    sections: await cmsService.getSections("home")
  }));
});

router.get("/admin/site", requireAdmin, async (req, res) => {
  const pageKey = requiredText(req.query.page) || "home";
  return renderAdminPage(res, "Home, pagine e offerte", "admin-cms-sections", await adminCmsBase({
    pageKey,
    siteHub: true,
    sections: await cmsService.getSections(pageKey)
  }));
});

router.get("/admin/sections", requireAdmin, async (req, res) => {
  const pageKey = requiredText(req.query.page);
  return renderAdminPage(res, "Pagine e sezioni", "admin-cms-sections", await adminCmsBase({
    pageKey,
    sections: await cmsService.getSections(pageKey)
  }));
});

router.post("/admin/sections", requireAdmin, async (req, res) => {
  const id = await cmsService.upsertSection(req.body, requiredText(req.body.id) || null);
  await audit(req, req.body.id ? "update_section" : "create_section", "content_sections", id, requiredText(req.body.title));
  req.session.flash = { type: "success", message: "Sezione salvata." };
  return res.redirect(req.body.redirect_to || "/admin/sections");
});

router.post("/admin/sections/:id/delete", requireAdmin, async (req, res) => {
  await db.run("UPDATE content_sections SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  await audit(req, "hide_section", "content_sections", req.params.id, "Sezione nascosta");
  req.session.flash = { type: "success", message: "Sezione nascosta." };
  return res.redirect(req.body.redirect_to || "/admin/sections");
});

router.get("/admin/cms-packages", requireAdmin, async (req, res) => {
  return renderAdminPage(res, "Pacchetti CMS", "admin-cms-packages", await adminCmsBase({
    packages: await cmsService.listServicePackages()
  }));
});

router.post("/admin/cms-packages", requireAdmin, async (req, res) => {
  const id = await cmsService.upsertServicePackage(req.body, requiredText(req.body.id) || null);
  await audit(req, req.body.id ? "update_package" : "create_package", "service_packages", id, requiredText(req.body.title));
  req.session.flash = { type: "success", message: "Pacchetto salvato." };
  return res.redirect("/admin/cms-packages");
});

router.post("/admin/cms-packages/:id/delete", requireAdmin, async (req, res) => {
  await db.run("UPDATE service_packages SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  await audit(req, "delete_package", "service_packages", req.params.id, "Pacchetto eliminato");
  req.session.flash = { type: "success", message: "Pacchetto eliminato." };
  return res.redirect("/admin/cms-packages");
});

async function renderProfiles(res, type) {
  const title = type === "speaker" ? "Speaker Network" : "Creator Network";
  return renderAdminPage(res, title, "admin-cms-profiles", await adminCmsBase({
    profileType: type,
    profiles: await cmsService.listProfiles(type)
  }));
}

router.get("/admin/creators", requireAdmin, async (req, res) => renderProfiles(res, "creator"));
router.get("/admin/speakers", requireAdmin, async (req, res) => renderProfiles(res, "speaker"));

router.post("/admin/creators", requireAdmin, async (req, res) => {
  const id = await cmsService.upsertProfile("creator", req.body, requiredText(req.body.id) || null);
  await audit(req, req.body.id ? "update_creator" : "create_creator", "creator_profiles", id, requiredText(req.body.name));
  req.session.flash = { type: "success", message: "Creator salvato." };
  return res.redirect("/admin/creators");
});

router.post("/admin/speakers", requireAdmin, async (req, res) => {
  const id = await cmsService.upsertProfile("speaker", req.body, requiredText(req.body.id) || null);
  await audit(req, req.body.id ? "update_speaker" : "create_speaker", "speaker_profiles", id, requiredText(req.body.name));
  req.session.flash = { type: "success", message: "Speaker salvato." };
  return res.redirect("/admin/speakers");
});

router.get("/admin/brands", requireAdmin, async (req, res) => {
  return renderAdminPage(res, "Aziende e Brand", "admin-cms-brands", await adminCmsBase({
    services: await cmsService.listBrandServices(false)
  }));
});

router.post("/admin/brands", requireAdmin, async (req, res) => {
  const id = await cmsService.upsertBrandService(req.body, requiredText(req.body.id) || null);
  await audit(req, req.body.id ? "update_brand_service" : "create_brand_service", "brand_services", id, requiredText(req.body.title));
  req.session.flash = { type: "success", message: "Servizio aziende salvato." };
  return res.redirect("/admin/brands");
});

router.get("/admin/smart-tv", requireAdmin, async (req, res) => {
  return renderAdminPage(res, "Smart TV", "admin-cms-sections", await adminCmsBase({
    pageKey: "smart-tv",
    sections: await cmsService.getSections("smart-tv")
  }));
});

router.get("/admin/requests", requireAdmin, async (req, res) => {
  const requests = await db.all("SELECT * FROM notifications_log WHERE type IN ('contact_request', 'activation_request', 'subscription_request_created') ORDER BY created_at DESC LIMIT 150");
  return renderAdminPage(res, "Richieste utenti", "admin-cms-requests", await adminCmsBase({ requests }));
});

router.post("/admin/requests/:id/status", requireAdmin, async (req, res) => {
  await db.run("UPDATE notifications_log SET status = ? WHERE id = ?", [requiredText(req.body.status || "in valutazione"), req.params.id]);
  await audit(req, "change_request_status", "notifications_log", req.params.id, requiredText(req.body.status));
  req.session.flash = { type: "success", message: "Richiesta aggiornata." };
  return res.redirect("/admin/requests");
});

router.get("/admin/activations", requireAdmin, async (req, res) => res.redirect("/admin/orders"));

router.get("/admin/logs", requireAdmin, async (req, res) => {
  const logs = await db.all(
    `SELECT admin_audit_logs.*, admins.username
     FROM admin_audit_logs
     LEFT JOIN admins ON admins.id = admin_audit_logs.admin_id
     ORDER BY admin_audit_logs.created_at DESC, admin_audit_logs.id DESC LIMIT 200`
  );
  return renderAdminPage(res, "Log attivita", "admin-cms-logs", await adminCmsBase({ logs }));
});

router.post("/admin/cms-settings", requireAdmin, async (req, res) => {
  await cmsService.setSiteSettings(req.body);
  await audit(req, "update_settings", "site_settings", null, "Impostazioni CMS aggiornate");
  req.session.flash = { type: "success", message: "Impostazioni CMS salvate." };
  return res.redirect("/admin/settings");
});

module.exports = router;
