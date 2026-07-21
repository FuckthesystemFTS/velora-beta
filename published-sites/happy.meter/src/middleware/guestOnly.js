module.exports = function guestOnly(req, res, next) {
  if (req.session.userId) {
    return res.redirect("/app");
  }
  return next();
};
