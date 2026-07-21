function parseSafeJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function stringifySafeJson(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return fallback;
  }
}

module.exports = {
  parseSafeJson,
  stringifySafeJson
};
