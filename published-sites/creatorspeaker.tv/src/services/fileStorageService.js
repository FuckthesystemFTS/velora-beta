const fs = require("fs");
const path = require("path");

const db = require("../db");

function normalizeName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9.\-_]/g, "-")
    .replace(/-+/g, "-");
}

async function createStoredFileFromUpload(file, options = {}) {
  const absolutePath = file && file.path ? path.resolve(file.path) : null;
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error("File temporaneo non trovato");
  }

  const payload = {
    owner_user_id: options.ownerUserId || null,
    purpose: options.purpose || "generic",
    original_name: normalizeName(file.originalname || path.basename(absolutePath)),
    mime_type: file.mimetype || "application/octet-stream",
    size_bytes: Number(file.size || 0),
    data: fs.readFileSync(absolutePath)
  };

  const fileId = await db.insert("stored_files", payload);
  fs.unlinkSync(absolutePath);
  return {
    id: fileId,
    owner_user_id: payload.owner_user_id,
    purpose: payload.purpose,
    original_name: payload.original_name,
    mime_type: payload.mime_type,
    size_bytes: payload.size_bytes
  };
}

async function createStoredFileFromPath(absolutePath, options = {}) {
  const resolved = path.resolve(absolutePath);
  const data = fs.readFileSync(resolved);
  const fileId = await db.insert("stored_files", {
    owner_user_id: options.ownerUserId || null,
    purpose: options.purpose || "generated",
    original_name: normalizeName(options.originalName || path.basename(resolved)),
    mime_type: options.mimeType || "application/octet-stream",
    size_bytes: Number(data.length || 0),
    data
  });
  return await getStoredFile(fileId, false);
}

async function getStoredFile(fileId, includeData = true) {
  const fields = includeData
    ? "id, owner_user_id, purpose, original_name, mime_type, size_bytes, data, created_at"
    : "id, owner_user_id, purpose, original_name, mime_type, size_bytes, created_at";
  return db.get(`SELECT ${fields} FROM stored_files WHERE id = ?`, [fileId]);
}

async function sendStoredFile(res, fileId, inline = true) {
  const file = await getStoredFile(fileId, true);
  if (!file) {
    return res.status(404).send("File non trovato");
  }

  res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${normalizeName(file.original_name)}"`
  );
  res.setHeader("Content-Length", String(file.size_bytes || (file.data ? file.data.length : 0)));
  return res.end(file.data);
}

module.exports = {
  createStoredFileFromUpload,
  createStoredFileFromPath,
  getStoredFile,
  sendStoredFile
};
