function clampScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.round(parsed)));
}

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function validateRegistration(payload) {
  const errors = [];
  if (!normalizeText(payload.name)) {
    errors.push("Inserisci il nome");
  }
  if (!/^\S+@\S+\.\S+$/.test(normalizeText(payload.email))) {
    errors.push("Inserisci una email valida");
  }
  if ((payload.password || "").length < 8) {
    errors.push("La password deve avere almeno 8 caratteri");
  }
  if (payload.password !== payload.confirmPassword) {
    errors.push("Le password non coincidono");
  }
  if (!payload.acceptPrivacy) {
    errors.push("Devi accettare la privacy");
  }
  if (!payload.acceptTerms) {
    errors.push("Devi accettare i termini");
  }
  return errors;
}

module.exports = {
  clampScore,
  normalizeText,
  validateRegistration
};
