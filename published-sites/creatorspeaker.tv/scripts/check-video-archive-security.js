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

assertIncludes("src/routes/userRoutes.js", '"/dashboard/videos"', "Archivio video utente assente");
assertIncludes("src/routes/userRoutes.js", '"/dashboard/videos/:id/download"', "Download video utente assente");
assertIncludes("src/routes/userRoutes.js", "AND user_id = ?", "Download utente non vincolato al proprietario");
assertIncludes("src/routes/adminRoutes.js", '"/admin/videos"', "Archivio video admin assente");
assertIncludes("src/routes/adminRoutes.js", '"/admin/video-profiles"', "Gestione profili admin assente");
assertIncludes("views/partials/user-header.ejs", "/dashboard/videos", "Link video utente assente");
assertIncludes("views/partials/admin-header.ejs", "/admin/videos", "Link video admin assente");
assertIncludes("views/layout-admin.ejs", "panelPath('/admin/videos')", "Polling admin archivio video non caricato");

console.log("check-video-archive-security ok");
