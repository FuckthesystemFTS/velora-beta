const db = require("../db");
const { parseJson } = require("../utils/safeJson");
const { normalizePermissions } = require("./adminOnly");

async function attachUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.currentAdmin = null;

  if (req.session.userId) {
    res.locals.currentUser = await db.get(
      "SELECT id, name, email, status, credits, created_at, updated_at FROM users WHERE id = ?",
      [req.session.userId]
    );
  }

  if (req.session.adminId) {
    const admin = await db.get(
      "SELECT id, username, display_name, role, status, permissions_json, must_change_password, created_at, updated_at FROM admins WHERE id = ?",
      [req.session.adminId]
    );
    if (admin) {
      res.locals.currentAdmin = {
        ...admin,
        permissions: normalizePermissions(parseJson(admin.permissions_json, {}))
      };
    }
  }

  next();
}

function requireUser(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = { type: "error", message: "Accedi per continuare." };
    return res.redirect("/login");
  }

  next();
}

function requireGuest(req, res, next) {
  if (req.session.userId) {
    return res.redirect("/dashboard");
  }

  next();
}

module.exports = {
  attachUser,
  requireUser,
  requireGuest
};
