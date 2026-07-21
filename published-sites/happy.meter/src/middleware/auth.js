module.exports = function auth(req, res, next) {
  if (!req.session.userId) {
    req.session.redirectTo = req.originalUrl;
    return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
  return next();
};
