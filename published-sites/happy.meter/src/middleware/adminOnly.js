module.exports = function adminOnly(req, res, next) {
  if (!req.session.adminId) {
    return res.redirect("/admin/login");
  }
  res.locals.adminPath = req.path;
  return next();
};
