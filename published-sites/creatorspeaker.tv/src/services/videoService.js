const fs = require("fs");
const os = require("os");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");
const ffmpeg = require("fluent-ffmpeg");

const db = require("../db");
const { parseJson } = require("../utils/safeJson");
const { slugify } = require("../utils/slug");
const { toInt } = require("../utils/validators");
const { createStoredFileFromPath, getStoredFile } = require("./fileStorageService");
const mediaService = require("./mediaService");

ffmpeg.setFfmpegPath(ffmpegPath);
const probeCandidate = ffprobeStatic && ffprobeStatic.path
  ? ffprobeStatic.path
  : path.join(path.dirname(ffmpegPath), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
if (probeCandidate && fs.existsSync(probeCandidate)) {
  ffmpeg.setFfprobePath(probeCandidate);
}

const FORMATS = {
  "16:9": { width: 1280, height: 720, resolution: "1280x720" },
  "9:16": { width: 720, height: 1280, resolution: "720x1280" },
  "1:1": { width: 1080, height: 1080, resolution: "1080x1080" }
};

const activeJobs = new Set();
const queuedJobs = new Set();

function enqueueVideoJob(jobId) {
  const numericJobId = Number(jobId);
  if (!numericJobId || activeJobs.has(numericJobId) || queuedJobs.has(numericJobId)) {
    return;
  }
  queuedJobs.add(numericJobId);
  setImmediate(drainVideoQueue);
}

function drainVideoQueue() {
  if (activeJobs.size > 0 || queuedJobs.size === 0) {
    return;
  }
  const [nextJobId] = queuedJobs;
  queuedJobs.delete(nextJobId);
  processJob(nextJobId).catch((error) => {
    console.error(`Video job queue failed ${nextJobId}:`, error.message);
  });
}

function boolValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanSeconds(value, fallback = 0, min = 0, max = 900) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function normalizeFilename(title, jobId) {
  const base = slugify(title) || `video-${jobId || Date.now()}`;
  return `${base}.mp4`;
}

function parseFeatureFlags(profile) {
  return parseJson(profile && profile.feature_flags_json, {});
}

function ffprobe(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
}

function runFfmpeg(command, output) {
  return new Promise((resolve, reject) => {
    command
      .on("end", resolve)
      .on("error", reject)
      .save(output);
  });
}

async function renderSegment(imagePath, duration, size, output) {
  const filter = `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=#070812`;
  const command = ffmpeg(imagePath)
    .inputOptions(["-loop 1"])
    .duration(duration)
    .videoFilters(filter)
    .outputOptions(["-r 30", "-pix_fmt yuv420p", "-c:v libx264", "-preset veryfast", "-movflags +faststart"]);

  await runFfmpeg(command, output);
}

async function concatSegments(segmentPaths, concatFile, output) {
  const payload = segmentPaths.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(concatFile, payload);
  const command = ffmpeg()
    .input(concatFile)
    .inputOptions(["-f concat", "-safe 0"])
    .outputOptions(["-c copy"]);
  await runFfmpeg(command, output);
}

async function mergeAudio(videoPath, audioPath, output, options = {}) {
  const audioStart = cleanSeconds(options.audioStartSeconds, 0, 0, 3600);
  const audioEnd = options.audioEndSeconds === null || options.audioEndSeconds === undefined
    ? null
    : cleanSeconds(options.audioEndSeconds, 0, 0, 3600);
  const trimDuration = audioEnd && audioEnd > audioStart ? audioEnd - audioStart : null;
  const filters = [];
  const volume = cleanSeconds(options.audioVolume, 1, 0.1, 2);
  if (volume !== 1) {
    filters.push(`volume=${volume}`);
  }
  const fadeIn = cleanSeconds(options.audioFadeIn, 0, 0, 20);
  if (fadeIn > 0) {
    filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  }
  const fadeOut = cleanSeconds(options.audioFadeOut, 0, 0, 20);
  if (fadeOut > 0 && trimDuration && trimDuration > fadeOut) {
    filters.push(`afade=t=out:st=${Math.max(0, trimDuration - fadeOut)}:d=${fadeOut}`);
  }

  const command = ffmpeg().input(videoPath).input(audioPath);
  if (audioStart > 0) {
    command.inputOptions([`-ss ${audioStart}`]);
  }
  if (trimDuration) {
    command.duration(trimDuration);
  }
  if (filters.length) {
    command.audioFilters(filters);
  }
  command.outputOptions(["-c:v libx264", "-preset veryfast", "-c:a aac", "-shortest", "-pix_fmt yuv420p", "-movflags +faststart"]);
  await runFfmpeg(command, output);
}

async function listRenderProfiles({ includeInactive = false } = {}) {
  const rows = await db.all(
    `SELECT * FROM video_render_profiles ${includeInactive ? "" : "WHERE active = " + (db.meta.driver === "pg" ? "TRUE" : "1")} ORDER BY sort_order ASC, credits_cost ASC, id ASC`
  );
  return rows.map((row) => ({
    ...row,
    active: boolValue(row.active),
    feature_flags: parseFeatureFlags(row)
  }));
}

async function getRenderProfileBySlug(slug) {
  const profile = await db.get("SELECT * FROM video_render_profiles WHERE slug = ? AND active = ?", [
    slug || "semplice",
    db.meta.driver === "pg" ? true : 1
  ]);
  if (profile) {
    return {
      ...profile,
      active: boolValue(profile.active),
      feature_flags: parseFeatureFlags(profile)
    };
  }
  const fallback = await db.get("SELECT * FROM video_render_profiles WHERE slug = ?", ["semplice"]);
  return fallback
    ? { ...fallback, active: boolValue(fallback.active), feature_flags: parseFeatureFlags(fallback) }
    : null;
}

async function getCreditCosts() {
  const profiles = await listRenderProfiles();
  if (profiles.length) {
    return profiles.reduce((acc, profile) => {
      acc[profile.slug] = Number(profile.credits_cost || 0);
      return acc;
    }, {});
  }
  return (await db.getSetting("video_credit_costs", {})) || { semplice: 3 };
}

async function readJobImages(job) {
  const rows = await db.all(
    "SELECT * FROM video_job_images WHERE video_job_id = ? ORDER BY sort_order ASC, id ASC",
    [job.id]
  );
  if (rows.length) {
    return rows.map((row, index) => ({
      fileId: Number(row.file_id),
      sortOrder: Number(row.sort_order || index),
      durationSeconds: cleanSeconds(row.duration_seconds, 5, 1, 60),
      caption: row.caption || "",
      transition: row.transition || "none"
    }));
  }
  return parseJson(job.image_file_ids_json || job.image_paths_json, []).map((fileId, index) => ({
    fileId: Number(fileId),
    sortOrder: index,
    durationSeconds: 5,
    caption: "",
    transition: "none"
  }));
}

async function uploadOutputToCloudinary(outputPath, outputFilename) {
  const status = mediaService.getCloudinaryStatus();
  if (!status.configured) {
    return null;
  }
  const cloudinary = mediaService.configureCloudinary();
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      outputPath,
      {
        folder: mediaService.buildUploadFolder("video", "generated-videos"),
        resource_type: "video",
        public_id: path.basename(outputFilename, ".mp4"),
        use_filename: true,
        unique_filename: true,
        overwrite: false
      },
      (error, result) => {
        if (error) {
          reject(new Error("Upload Cloudinary output non riuscito"));
        } else {
          resolve(result);
        }
      }
    );
  });
}

async function refundJobCredits(job, detail = "Crediti rimborsati", options = {}) {
  if (!job || boolValue(job.refunded) || Number(job.credits_refunded || 0) > 0) {
    return false;
  }
  const credits = Number(job.credits_charged || job.credits_cost || 0);
  if (credits > 0) {
    const user = await db.get("SELECT id, credits FROM users WHERE id = ?", [job.user_id]);
    if (user) {
      await db.run("UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
        Number(user.credits || 0) + credits,
        job.user_id
      ]);
    }
  }
  const status = options.status || "refunded";
  const errorMessage = options.keepError ? (job.error_message || "") : "";
  await db.run(
    "UPDATE video_jobs SET refunded = ?, credits_refunded = ?, status = ?, progress_percent = ?, status_detail = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [db.meta.driver === "pg" ? true : 1, credits, status, options.progressPercent || 100, detail, errorMessage, job.id]
  );
  return true;
}

async function failJob(job, error) {
  const message = error && error.message ? error.message : "Errore tecnico durante la generazione";
  await db.run(
    "UPDATE video_jobs SET status = 'failed', status_detail = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ["Elaborazione non completata, crediti restituiti", message, job.id]
  );
  await refundJobCredits(
    { ...job, error_message: message },
    `Crediti restituiti dopo errore tecnico: ${message}`.slice(0, 500),
    { status: "failed", progressPercent: Number(job.progress_percent || 18), keepError: true }
  );
}

async function processJob(jobId) {
  if (activeJobs.has(Number(jobId))) {
    return;
  }
  activeJobs.add(Number(jobId));
  const job = await db.get("SELECT * FROM video_jobs WHERE id = ?", [jobId]);
  if (!job) {
    activeJobs.delete(Number(jobId));
    return;
  }

  let workDir = "";
  try {
    const timeline = await readJobImages(job);
    const audioFileId = Number(job.audio_file_id || 0);
    if (!timeline.length || !audioFileId) {
      throw new Error("Asset del video incompleti");
    }

    await db.run(
      "UPDATE video_jobs SET started_at = COALESCE(started_at, ?), progress_percent = ?, status_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [new Date().toISOString(), 12, "Preparazione media", job.id]
    );

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), `cstv-job-${job.id}-`));
    const mediaDir = path.join(workDir, "media");
    fs.mkdirSync(mediaDir, { recursive: true });

    const imageItems = [];
    for (let index = 0; index < timeline.length; index += 1) {
      const item = timeline[index];
      const imageFile = await getStoredFile(Number(item.fileId), true);
      if (!imageFile) {
        throw new Error(`Immagine ${index + 1} non trovata`);
      }
      const imagePath = path.join(mediaDir, `${index + 1}-${imageFile.original_name}`);
      fs.writeFileSync(imagePath, imageFile.data);
      imageItems.push({ ...item, path: imagePath });
    }

    const audioFile = await getStoredFile(audioFileId, true);
    if (!audioFile) {
      throw new Error("File audio non trovato");
    }
    const audioPath = path.join(mediaDir, `audio-${audioFile.original_name}`);
    fs.writeFileSync(audioPath, audioFile.data);

    await db.run(
      "UPDATE video_jobs SET progress_percent = ?, status_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [18, "Analisi traccia audio", job.id]
    );

    const audioProbe = await ffprobe(audioPath);
    const sourceAudioDuration = Math.max(1, Number((audioProbe.format && audioProbe.format.duration) || 0));
    const audioStart = cleanSeconds(job.audio_start_seconds, 0, 0, sourceAudioDuration);
    const audioEnd = job.audio_end_seconds ? cleanSeconds(job.audio_end_seconds, sourceAudioDuration, audioStart, sourceAudioDuration) : null;
    const selectedAudioDuration = Math.max(1, (audioEnd && audioEnd > audioStart ? audioEnd : sourceAudioDuration) - audioStart);
    const settings = parseJson(job.settings_json, {});
    if (job.audio_mode === "fit_audio") {
      const perImage = Math.max(2, selectedAudioDuration / imageItems.length);
      imageItems.forEach((item) => {
        item.durationSeconds = perImage;
      });
    } else if (settings.profileSlug === "semplice") {
      imageItems.forEach((item) => {
        item.durationSeconds = cleanSeconds(settings.defaultDurationSeconds, 5, 2, 30);
      });
    }

    const totalDuration = imageItems.reduce((sum, item) => sum + cleanSeconds(item.durationSeconds, 5, 1, 60), 0);
    const format = FORMATS[job.aspect_ratio] || FORMATS[job.format] || FORMATS["16:9"];
    const renderDir = path.join(workDir, "render");
    fs.mkdirSync(renderDir, { recursive: true });
    const segmentPaths = [];

    for (let index = 0; index < imageItems.length; index += 1) {
      const segmentPath = path.join(renderDir, `segment-${index + 1}.mp4`);
      await renderSegment(imageItems[index].path, cleanSeconds(imageItems[index].durationSeconds, 5, 1, 60), format, segmentPath);
      segmentPaths.push(segmentPath);
      const progressValue = Math.min(72, 24 + Math.round(((index + 1) / imageItems.length) * 48));
      await db.run(
        "UPDATE video_jobs SET progress_percent = ?, status_detail = ?, total_duration_seconds = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [progressValue, `Render slide ${index + 1} di ${imageItems.length}`, totalDuration, job.id]
      );
    }

    await db.run(
      "UPDATE video_jobs SET progress_percent = ?, status_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [78, "Composizione sequenza video", job.id]
    );

    const concatFile = path.join(renderDir, "segments.txt");
    const mergedVideo = path.join(renderDir, "slideshow.mp4");
    const outputFilename = job.output_filename || normalizeFilename(job.title, job.id);
    const outputFullPath = path.join(renderDir, outputFilename);
    await concatSegments(segmentPaths, concatFile, mergedVideo);
    await db.run(
      "UPDATE video_jobs SET progress_percent = ?, status_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [88, "Merge finale audio e video", job.id]
    );
    await mergeAudio(mergedVideo, audioPath, outputFullPath, {
      audioStartSeconds: audioStart,
      audioEndSeconds: audioEnd,
      audioVolume: job.audio_volume,
      audioFadeIn: job.audio_fade_in,
      audioFadeOut: job.audio_fade_out
    });

    await db.run(
      "UPDATE video_jobs SET progress_percent = ?, status_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [94, "Salvataggio output", job.id]
    );

    const storedOutput = await createStoredFileFromPath(outputFullPath, {
      ownerUserId: job.user_id,
      purpose: "video_output",
      originalName: outputFilename,
      mimeType: "video/mp4"
    });
    const outputStats = fs.statSync(outputFullPath);
    let cloudinaryResult = null;
    try {
      cloudinaryResult = await uploadOutputToCloudinary(outputFullPath, outputFilename);
    } catch (error) {
      console.warn(`Cloudinary output upload skipped for job ${job.id}: ${error.message}`);
    }

    await db.run(
      `UPDATE video_jobs
       SET output_path = ?, output_file_id = ?, output_cloudinary_public_id = ?, output_secure_url = ?,
           output_bytes = ?, output_duration_seconds = ?, output_format = ?, output_filename = ?,
           progress_percent = ?, status = 'completed', status_detail = ?, error_message = '',
           completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        `/dashboard/videos/${job.id}/download`,
        storedOutput.id,
        cloudinaryResult ? cloudinaryResult.public_id : null,
        cloudinaryResult ? cloudinaryResult.secure_url : null,
        outputStats.size,
        totalDuration,
        "mp4",
        outputFilename,
        100,
        "Video pronto",
        job.id
      ]
    );
  } catch (error) {
    await failJob(job, error);
  } finally {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    activeJobs.delete(Number(jobId));
    setImmediate(drainVideoQueue);
  }
}

async function createVideoJob({
  userId,
  title,
  imageFileIds,
  audioFileId,
  style,
  format,
  profileSlug,
  imageDurations = [],
  imageCaptions = [],
  imageTransitions = [],
  audioStartSeconds = 0,
  audioEndSeconds = null,
  audioMode = "fit_video",
  audioVolume = 1,
  audioFadeIn = 0,
  audioFadeOut = 0
}) {
  const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
  const profile = await getRenderProfileBySlug(profileSlug || style || "semplice");
  if (!profile) {
    throw new Error("Profilo video non disponibile");
  }
  const flags = profile.feature_flags || {};
  const safeImageIds = (imageFileIds || []).map(Number).filter(Boolean).slice(0, Number(profile.max_images || 10));
  if (!safeImageIds.length) {
    throw new Error("Carica almeno una immagine");
  }
  const cost = Number(profile.credits_cost || 0);
  if (!user || Number(user.credits || 0) < cost) {
    throw new Error("Crediti insufficienti per generare il video");
  }

  await db.run("UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    Number(user.credits) - cost,
    userId
  ]);

  const aspectRatio = FORMATS[format] ? format : profile.aspect_ratio || "16:9";
  const profileSize = FORMATS[aspectRatio] || FORMATS["16:9"];
  const defaultDuration = cleanSeconds(profile.default_duration_seconds, 5, 2, 30);
  const normalizedDurations = safeImageIds.map((_, index) => (
    flags.customDurations ? cleanSeconds(imageDurations[index], defaultDuration, 1, 60) : defaultDuration
  ));
  const totalDuration = normalizedDurations.reduce((sum, item) => sum + item, 0);
  const slug = slugify(title) || `video-${Date.now()}`;
  const outputFilename = normalizeFilename(slug, Date.now());
  const settings = {
    profileSlug: profile.slug,
    profileName: profile.name,
    defaultDurationSeconds: defaultDuration,
    features: flags
  };

  const jobId = await db.insert("video_jobs", {
    user_id: userId,
    title,
    style: profile.slug,
    format: aspectRatio,
    image_paths_json: JSON.stringify([]),
    image_file_ids_json: JSON.stringify(safeImageIds),
    audio_path: "",
    audio_file_id: audioFileId,
    output_path: "",
    output_file_id: null,
    credits_cost: cost,
    status: "processing",
    progress_percent: 8,
    status_detail: "Job acquisito in coda",
    error_message: "",
    refunded: db.meta.driver === "pg" ? false : 0,
    render_profile_id: profile.id,
    slug,
    credits_charged: cost,
    credits_refunded: 0,
    resolution: profileSize.resolution,
    aspect_ratio: aspectRatio,
    total_duration_seconds: totalDuration,
    audio_start_seconds: flags.audioTrim ? cleanSeconds(audioStartSeconds, 0, 0, 3600) : 0,
    audio_end_seconds: flags.audioTrim && audioEndSeconds ? cleanSeconds(audioEndSeconds, 0, 0, 3600) : null,
    audio_mode: audioMode === "fit_audio" && flags.audioTrim ? "fit_audio" : "fit_video",
    audio_volume: flags.audioTrim ? cleanSeconds(audioVolume, 1, 0.1, 2) : 1,
    audio_fade_in: flags.audioTrim ? cleanSeconds(audioFadeIn, 0, 0, 20) : 0,
    audio_fade_out: flags.audioTrim ? cleanSeconds(audioFadeOut, 0, 0, 20) : 0,
    settings_json: JSON.stringify(settings),
    output_format: "mp4",
    output_filename: outputFilename
  });

  for (let index = 0; index < safeImageIds.length; index += 1) {
    await db.insert("video_job_images", {
      video_job_id: jobId,
      file_id: safeImageIds[index],
      sort_order: index,
      duration_seconds: normalizedDurations[index],
      caption: flags.captions ? String(imageCaptions[index] || "").slice(0, 160) : "",
      transition: flags.transitions ? String(imageTransitions[index] || "none").slice(0, 40) : "none"
    });
  }

  enqueueVideoJob(jobId);

  return await db.get("SELECT * FROM video_jobs WHERE id = ?", [jobId]);
}

async function retryVideoJob(jobId) {
  const job = await db.get("SELECT * FROM video_jobs WHERE id = ?", [jobId]);
  if (!job || job.status === "completed" || job.status === "refunded") {
    return job;
  }
  await db.run(
    "UPDATE video_jobs SET status = 'processing', progress_percent = ?, status_detail = ?, error_message = '', started_at = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [12, "Job rilanciato", jobId]
  );
  enqueueVideoJob(jobId);
  return db.get("SELECT * FROM video_jobs WHERE id = ?", [jobId]);
}

async function updateRenderProfile(profileId, payload) {
  const existing = await db.get("SELECT * FROM video_render_profiles WHERE id = ?", [profileId]);
  if (!existing) {
    return null;
  }
  const flags = {
    customDurations: Boolean(payload.customDurations),
    audioTrim: Boolean(payload.audioTrim),
    captions: Boolean(payload.captions),
    transitions: Boolean(payload.transitions)
  };
  await db.run(
    `UPDATE video_render_profiles
     SET name = ?, credits_cost = ?, description = ?, default_duration_seconds = ?, max_images = ?,
         max_upload_mb = ?, resolution = ?, aspect_ratio = ?, feature_flags_json = ?,
         active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      String(payload.name || existing.name).trim(),
      toInt(payload.credits_cost, existing.credits_cost),
      String(payload.description || "").trim(),
      cleanSeconds(payload.default_duration_seconds, existing.default_duration_seconds || 5, 1, 60),
      toInt(payload.max_images, existing.max_images || 10),
      toInt(payload.max_upload_mb, existing.max_upload_mb || 250),
      String(payload.resolution || existing.resolution || "1280x720").trim(),
      FORMATS[payload.aspect_ratio] ? payload.aspect_ratio : existing.aspect_ratio || "16:9",
      JSON.stringify(flags),
      payload.active ? (db.meta.driver === "pg" ? true : 1) : (db.meta.driver === "pg" ? false : 0),
      toInt(payload.sort_order, existing.sort_order || 0),
      profileId
    ]
  );
  return db.get("SELECT * FROM video_render_profiles WHERE id = ?", [profileId]);
}

async function resumeProcessingJobs() {
  const jobs = await db.all("SELECT id FROM video_jobs WHERE status = 'processing' ORDER BY updated_at ASC, id ASC LIMIT 5");
  for (const job of jobs) {
    enqueueVideoJob(job.id);
  }
  return jobs.length;
}

module.exports = {
  createVideoJob,
  getCreditCosts,
  listRenderProfiles,
  getRenderProfileBySlug,
  updateRenderProfile,
  refundJobCredits,
  processJob,
  enqueueVideoJob,
  retryVideoJob,
  resumeProcessingJobs
};
