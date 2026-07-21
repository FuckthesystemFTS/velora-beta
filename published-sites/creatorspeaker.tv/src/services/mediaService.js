const path = require("path");
const { Readable } = require("stream");

const db = require("../db");
const { requiredText, toInt } = require("../utils/validators");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".txt"]);

function getCloudinaryStatus() {
  const configured = Boolean(
    requiredText(process.env.CLOUDINARY_CLOUD_NAME) &&
      requiredText(process.env.CLOUDINARY_API_KEY) &&
      requiredText(process.env.CLOUDINARY_API_SECRET)
  );
  return {
    configured,
    folder: requiredText(process.env.CLOUDINARY_FOLDER || "creatorspeaker"),
    message: configured
      ? "Cloudinary configurato"
      : "Cloudinary non configurato. Impostare CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET"
  };
}

function configureCloudinary() {
  const status = getCloudinaryStatus();
  if (!status.configured) {
    return null;
  }
  const { v2: cloudinary } = require("cloudinary");
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  return cloudinary;
}

function buildUploadFolder(type, customFolder = "") {
  const base = requiredText(process.env.CLOUDINARY_FOLDER || "creatorspeaker").replace(/^\/+|\/+$/g, "");
  const cleanCustom = requiredText(customFolder).replace(/[^a-zA-Z0-9/_-]/g, "").replace(/^\/+|\/+$/g, "");
  if (cleanCustom) {
    return `${base}/${cleanCustom}`;
  }
  return `${base}/${type === "video" ? "videos" : type === "audio" ? "audio" : type === "document" ? "documents" : "images"}`;
}

function detectType(file, requestedType = "") {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  const requested = requiredText(requestedType);
  const type = requested || (mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : mime.startsWith("image/") ? "image" : "document");
  if (type === "image" && IMAGE_EXTENSIONS.has(extension) && mime.startsWith("image/")) {
    return { type, resourceType: "image", extension };
  }
  if (type === "video" && VIDEO_EXTENSIONS.has(extension) && mime.startsWith("video/")) {
    return { type, resourceType: "video", extension };
  }
  if (type === "audio" && AUDIO_EXTENSIONS.has(extension) && mime.startsWith("audio/")) {
    return { type, resourceType: "video", extension };
  }
  if (type === "document" && DOCUMENT_EXTENSIONS.has(extension)) {
    return { type, resourceType: "raw", extension };
  }
  throw new Error("Tipo file non consentito o estensione non valida");
}

function validateUpload(file, requestedType = "") {
  if (!file || !file.buffer) {
    throw new Error("Seleziona un file da caricare");
  }
  const detected = detectType(file, requestedType);
  const maxImageBytes = toInt(process.env.MAX_IMAGE_UPLOAD_MB, 10) * 1024 * 1024;
  const maxVideoBytes = toInt(process.env.MAX_VIDEO_UPLOAD_MB, 200) * 1024 * 1024;
  const maxAudioBytes = toInt(process.env.MAX_AUDIO_UPLOAD_MB, 100) * 1024 * 1024;
  const maxDocumentBytes = 25 * 1024 * 1024;
  const maxBytes =
    detected.type === "video"
      ? maxVideoBytes
      : detected.type === "audio"
        ? maxAudioBytes
        : detected.type === "document"
          ? maxDocumentBytes
          : maxImageBytes;
  if (file.size > maxBytes) {
    throw new Error(`File troppo grande. Limite ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  return detected;
}

function uploadBuffer(cloudinary, file, options) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        return reject(new Error("Upload Cloudinary non riuscito"));
      }
      return resolve(result);
    });
    Readable.from(file.buffer).pipe(uploadStream);
  });
}

async function uploadToCloudinary(file, options = {}) {
  const status = getCloudinaryStatus();
  if (!status.configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(status.message);
    }
    throw new Error(status.message);
  }
  const detected = validateUpload(file, options.type);
  const cloudinary = configureCloudinary();
  const folder = buildUploadFolder(detected.type, options.folder);
  const result = await uploadBuffer(cloudinary, file, {
    folder,
    resource_type: detected.resourceType,
    use_filename: true,
    unique_filename: true,
    overwrite: false
  });
  return {
    ...result,
    cmsType: detected.type,
    cmsFolder: folder
  };
}

async function deleteFromCloudinary(publicId, resourceType = "image") {
  const status = getCloudinaryStatus();
  if (!status.configured || !publicId) {
    return { ok: false, message: status.message };
  }
  const cloudinary = configureCloudinary();
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType || "image" });
  return { ok: true };
}

async function createMediaAsset({ file, body, adminId }) {
  const result = await uploadToCloudinary(file, {
    type: requiredText(body.type || "image"),
    folder: requiredText(body.folder)
  });
  return db.insert("media_assets", {
    title: requiredText(body.title) || file.originalname,
    alt_text: requiredText(body.alt_text),
    description: requiredText(body.description),
    type: result.cmsType,
    resource_type: result.resource_type || result.cmsType,
    cloudinary_public_id: result.public_id,
    cloudinary_secure_url: result.secure_url,
    cloudinary_format: result.format || "",
    cloudinary_folder: result.cmsFolder,
    width: result.width || null,
    height: result.height || null,
    duration: result.duration || null,
    bytes: result.bytes || file.size || 0,
    status: "active",
    created_by_admin_id: adminId
  });
}

async function listMediaAssets({ type = "", q = "" } = {}) {
  const params = [];
  const where = ["status != 'deleted'"];
  if (requiredText(type)) {
    where.push("type = ?");
    params.push(requiredText(type));
  }
  if (requiredText(q)) {
    where.push("(title LIKE ? OR alt_text LIKE ? OR description LIKE ?)");
    const like = `%${requiredText(q)}%`;
    params.push(like, like, like);
  }
  return db.all(`SELECT * FROM media_assets WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC`, params);
}

async function logAdmin(adminId, action, entityType, entityId, details = "") {
  return db.insert("admin_audit_logs", {
    admin_id: adminId || null,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    details: requiredText(details).slice(0, 500)
  });
}

module.exports = {
  getCloudinaryStatus,
  configureCloudinary,
  uploadToCloudinary,
  deleteFromCloudinary,
  createMediaAsset,
  listMediaAssets,
  logAdmin,
  buildUploadFolder,
  validateUpload
};
