const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertIncludes(file, pattern, message) {
  const content = read(file);
  if (!content.includes(pattern)) {
    throw new Error(`${message} in ${file}`);
  }
}

assertIncludes("src/db/index.js", "video_render_profiles", "Tabella profili video assente");
assertIncludes("src/db/index.js", "video_job_images", "Tabella timeline video assente");
assertIncludes("src/services/videoService.js", "listRenderProfiles", "Servizio profili non esportato");
assertIncludes("src/services/videoService.js", "credits_charged", "Addebito crediti tracciato assente");
assertIncludes("src/services/videoService.js", "refundJobCredits", "Rimborso idempotente assente");
assertIncludes("src/services/videoService.js", "COALESCE(started_at, ?)", "Timestamp avvio job non compatibile con Postgres");
assertIncludes("src/services/videoService.js", "keepError", "Errore tecnico non preservato dopo rimborso crediti");
assertIncludes("views/user-video-studio.ejs", "data-profile-option", "Selettore profili assente nello studio");
assertIncludes("views/user-video-studio.ejs", "data-video-timeline", "Timeline utente assente");
assertIncludes("public/js/video-studio.js", "data-video-builder", "Builder video client assente");

if (read("src/services/videoService.js").includes("COALESCE(started_at, CURRENT_TIMESTAMP)")) {
  throw new Error("COALESCE(started_at, CURRENT_TIMESTAMP) rompe Postgres quando started_at e TEXT");
}

console.log("check-video-studio-advanced ok");
