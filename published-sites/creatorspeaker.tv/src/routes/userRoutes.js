const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const multer = require("multer");

const db = require("../db");
const { requireUser } = require("../middleware/auth");
const { verifyCsrfAfterUpload } = require("../middleware/formSecurity");
const { requiredText } = require("../utils/validators");
const { getSiteSettings, renderUserPage } = require("../utils/viewHelpers");
const { createVideoJob, getCreditCosts, listRenderProfiles } = require("../services/videoService");
const { createStoredFileFromUpload, sendStoredFile } = require("../services/fileStorageService");

const router = express.Router();

const uploadsRoot = path.join(os.tmpdir(), "creatorspeaker-tv-upload-cache");
fs.mkdirSync(uploadsRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsRoot,
  filename: (req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "-");
    cb(null, `${Date.now()}-${sanitized}`);
  }
});

const allowedUploadMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_USER_UPLOAD_MB || 250) * 1024 * 1024,
    files: 12
  },
  fileFilter: (req, file, cb) => {
    if (!allowedUploadMimeTypes.has(String(file.mimetype || "").toLowerCase())) {
      return cb(new Error("Tipo file non consentito"));
    }
    return cb(null, true);
  }
});

function handleUpload(middleware, fallbackPath) {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (!error) {
        return next();
      }
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? `File troppo grande. Limite massimo ${process.env.MAX_USER_UPLOAD_MB || 250} MB`
          : error.code === "LIMIT_FILE_COUNT"
            ? "Hai selezionato troppi file. Per il video studio usa massimo 10 immagini e 1 audio"
            : error.message || "Upload non riuscito";
      req.session.flash = { type: "error", message };
      return res.redirect(fallbackPath);
    });
  };
}

function humanUploadStatus(status) {
  return {
    uploaded: "Caricato",
    under_review: "In revisione",
    scheduled: "Programmato",
    published: "Pubblicato",
    rejected: "Da correggere"
  }[status] || status;
}

function humanVideoStatus(status) {
  return {
    draft: "Bozza",
    processing: "In elaborazione",
    completed: "Completato",
    failed: "Errore",
    refunded: "Rimborsato"
  }[status] || status;
}

function enrichUpload(item) {
  return {
    ...item,
    status_label: humanUploadStatus(item.status),
    file_url: item.file_id ? `/dashboard/files/${item.file_id}` : `/${item.file_path}`,
    file_label: item.original_filename || path.basename(item.file_path || item.title || "file")
  };
}

function enrichVideoJob(item) {
  return {
    ...item,
    status_label: humanVideoStatus(item.status),
    progress_percent: Number(item.progress_percent || (item.status === "completed" ? 100 : 0)),
    status_detail: item.status_detail || "",
    output_url: item.output_file_id ? `/dashboard/videos/${item.id}/download` : item.output_secure_url || item.output_path || "",
    download_url: item.output_file_id ? `/dashboard/videos/${item.id}/download` : item.output_secure_url || item.output_path || "",
    profile_label: item.profile_name || item.style || "Video"
  };
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

async function dashboardData(userId) {
  const user = await db.get("SELECT id, name, email, status, credits, created_at FROM users WHERE id = ?", [userId]);
  const orders = await db.all("SELECT * FROM orders WHERE user_id = ? OR customer_email = ? ORDER BY created_at DESC", [
    userId,
    user.email
  ]);
  const subscriptions = await db.all(
    "SELECT subscriptions.*, packages.name AS package_name FROM subscriptions LEFT JOIN packages ON packages.id = subscriptions.package_id WHERE subscriptions.user_id = ? ORDER BY subscriptions.created_at DESC",
    [userId]
  );
  const uploads = await db.all(
    "SELECT * FROM content_uploads WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    [userId]
  );
  const videoJobs = await db.all("SELECT * FROM video_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", [
    userId
  ]);
  const extras = await db.all("SELECT * FROM packages WHERE area IN ('extra', 'caricamenti') ORDER BY sort_order ASC");

  return {
    user,
    orders: orders.map((item) => ({
      ...item,
      payment_method_label:
        {
          bank_transfer: "Bonifico",
          paypal: "PayPal",
          stripe: "Stripe"
        }[item.payment_method] || item.payment_method || "Bonifico"
    })),
    subscriptions,
    uploads: uploads.map(enrichUpload),
    videoJobs: videoJobs.map(enrichVideoJob),
    extras
  };
}

router.get("/dashboard", requireUser, async (req, res) => {
  const shell = await getSiteSettings();
  return renderUserPage(res, "Dashboard utente", "user-dashboard", {
    ...shell,
    ...(await dashboardData(req.session.userId))
  });
});

router.get("/dashboard/orders", requireUser, async (req, res) => {
  const shell = await getSiteSettings();
  return renderUserPage(res, "Ordini utente", "user-dashboard", {
    ...shell,
    ...(await dashboardData(req.session.userId)),
    activeTab: "orders"
  });
});

router.get("/dashboard/subscriptions", requireUser, async (req, res) => {
  const shell = await getSiteSettings();
  return renderUserPage(res, "Abbonamenti", "user-dashboard", {
    ...shell,
    ...(await dashboardData(req.session.userId)),
    activeTab: "subscriptions"
  });
});

router.get("/dashboard/credits", requireUser, async (req, res) => {
  const shell = await getSiteSettings();
  return renderUserPage(res, "Crediti", "user-dashboard", {
    ...shell,
    ...(await dashboardData(req.session.userId)),
    activeTab: "credits"
  });
});

router.get("/dashboard/upload", requireUser, async (req, res) => {
  const shell = await getSiteSettings();
  return renderUserPage(res, "Carica contenuto", "user-upload", {
    ...shell,
    ...(await dashboardData(req.session.userId))
  });
});

router.post(
  "/dashboard/upload",
  requireUser,
  handleUpload(upload.single("file"), "/dashboard/upload"),
  verifyCsrfAfterUpload("/dashboard/upload"),
  async (req, res) => {
  if (!req.file) {
    req.session.flash = { type: "error", message: "Seleziona un file da caricare." };
    return res.redirect("/dashboard/upload");
  }

  const storedFile = await createStoredFileFromUpload(req.file, {
    ownerUserId: req.session.userId,
    purpose: "content_upload"
  });

  await db.insert("content_uploads", {
    user_id: req.session.userId,
    title: requiredText(req.body.title) || req.file.originalname,
    type: requiredText(req.body.type) || "document",
    file_path: "",
    file_id: storedFile.id,
    original_filename: storedFile.original_name,
    mime_type: storedFile.mime_type,
    file_size: storedFile.size_bytes,
    description: requiredText(req.body.description),
    publication_date: requiredText(req.body.publication_date) || null,
    status: "uploaded",
    progress_percent: 100,
    admin_notes: ""
  });

  req.session.flash = { type: "success", message: "Contenuto caricato correttamente." };
  return res.redirect("/dashboard");
});

router.get("/dashboard/video-studio", requireUser, async (req, res) => {
  const shell = await getSiteSettings();
  const profiles = await listRenderProfiles();
  return renderUserPage(res, "Video studio", "user-video-studio", {
    ...shell,
    ...(await dashboardData(req.session.userId)),
    creditCosts: await getCreditCosts(),
    renderProfiles: profiles
  });
});

router.post(
  "/dashboard/video-studio/create",
  requireUser,
  handleUpload(
    upload.fields([
      { name: "images", maxCount: 10 },
      { name: "audio", maxCount: 1 }
    ]),
    "/dashboard/video-studio"
  ),
  verifyCsrfAfterUpload("/dashboard/video-studio"),
  async (req, res) => {
    const images = req.files.images || [];
    const audio = req.files.audio || [];
    if (!images.length || !audio.length) {
      req.session.flash = { type: "error", message: "Carica almeno un'immagine e un audio." };
      return res.redirect("/dashboard/video-studio");
    }

    try {
      const imageFileIds = [];
      for (const image of images) {
        const storedImage = await createStoredFileFromUpload(image, {
          ownerUserId: req.session.userId,
          purpose: "video_source_image"
        });
        imageFileIds.push(storedImage.id);
      }
      const storedAudio = await createStoredFileFromUpload(audio[0], {
        ownerUserId: req.session.userId,
        purpose: "video_source_audio"
      });

      const job = await createVideoJob({
        userId: req.session.userId,
        title: requiredText(req.body.title) || "Nuovo video",
        imageFileIds,
        audioFileId: storedAudio.id,
        style: requiredText(req.body.style || req.body.render_profile_slug) || "semplice",
        profileSlug: requiredText(req.body.render_profile_slug || req.body.style) || "semplice",
        format: requiredText(req.body.format) || "16:9",
        imageDurations: asArray(req.body.image_duration_seconds),
        imageCaptions: asArray(req.body.image_caption),
        imageTransitions: asArray(req.body.image_transition),
        audioStartSeconds: req.body.audio_start_seconds,
        audioEndSeconds: req.body.audio_end_seconds,
        audioMode: requiredText(req.body.audio_mode || "fit_video"),
        audioVolume: req.body.audio_volume,
        audioFadeIn: req.body.audio_fade_in,
        audioFadeOut: req.body.audio_fade_out
      });

      req.session.flash = {
        type: "success",
        message: `Elaborazione video avviata. Stato attuale: ${job.status}.`
      };
      return res.redirect(`/dashboard/video-jobs/${job.id}`);
    } catch (error) {
      req.session.flash = { type: "error", message: error.message };
      return res.redirect("/dashboard/video-studio");
    }
  }
);

router.get("/dashboard/video-jobs/:id", requireUser, async (req, res) => {
  return res.redirect(`/dashboard/videos/${req.params.id}`);
});

router.get("/dashboard/videos", requireUser, async (req, res) => {
  const shell = await getSiteSettings();
  const jobs = await db.all(
    `SELECT video_jobs.*, video_render_profiles.name AS profile_name
     FROM video_jobs
     LEFT JOIN video_render_profiles ON video_render_profiles.id = video_jobs.render_profile_id
     WHERE video_jobs.user_id = ?
     ORDER BY video_jobs.created_at DESC, video_jobs.id DESC`,
    [req.session.userId]
  );
  return renderUserPage(res, "I miei video", "user-videos", {
    ...shell,
    ...(await dashboardData(req.session.userId)),
    jobs: jobs.map(enrichVideoJob)
  });
});

router.get("/dashboard/videos/:id", requireUser, async (req, res) => {
  const shell = await getSiteSettings();
  const job = await db.get(
    `SELECT video_jobs.*, video_render_profiles.name AS profile_name
     FROM video_jobs
     LEFT JOIN video_render_profiles ON video_render_profiles.id = video_jobs.render_profile_id
     WHERE video_jobs.id = ? AND video_jobs.user_id = ?`,
    [
    req.params.id,
    req.session.userId
    ]
  );

  if (!job) {
    return res.redirect("/dashboard/video-studio");
  }
  const timeline = await db.all(
    `SELECT video_job_images.*, stored_files.original_name
     FROM video_job_images
     LEFT JOIN stored_files ON stored_files.id = video_job_images.file_id
     WHERE video_job_images.video_job_id = ?
     ORDER BY video_job_images.sort_order ASC, video_job_images.id ASC`,
    [job.id]
  );

  return renderUserPage(res, "Dettaglio video", "user-video-detail", {
    ...shell,
    ...(await dashboardData(req.session.userId)),
    selectedJob: enrichVideoJob(job),
    timeline
  });
});

router.get("/dashboard/video-jobs/:id/status", requireUser, async (req, res) => {
  const job = await db.get("SELECT * FROM video_jobs WHERE id = ? AND user_id = ?", [
    req.params.id,
    req.session.userId
  ]);
  if (!job) {
    return res.status(404).json({ ok: false });
  }

  const payload = enrichVideoJob(job);
  return res.json({
    ok: true,
    status: payload.status,
    statusLabel: payload.status_label,
    progressPercent: payload.progress_percent,
    statusDetail: payload.status_detail,
    outputUrl: payload.output_url,
    errorMessage: payload.error_message || ""
  });
});

router.get("/dashboard/video-jobs/:id/output", requireUser, async (req, res) => {
  return res.redirect(`/dashboard/videos/${req.params.id}/download`);
});

router.get("/dashboard/videos/:id/download", requireUser, async (req, res) => {
  const job = await db.get("SELECT id, user_id, output_file_id FROM video_jobs WHERE id = ? AND user_id = ?", [
    req.params.id,
    req.session.userId
  ]);
  if (!job || !job.output_file_id) {
    return res.redirect("/dashboard/video-studio");
  }
  return sendStoredFile(res, job.output_file_id, false);
});

router.get("/dashboard/files/:fileId", requireUser, async (req, res) => {
  const row = await db.get(
    "SELECT file_id, user_id FROM content_uploads WHERE file_id = ? AND user_id = ?",
    [req.params.fileId, req.session.userId]
  );
  if (!row) {
    return res.redirect("/dashboard");
  }
  return sendStoredFile(res, row.file_id, true);
});

module.exports = router;
