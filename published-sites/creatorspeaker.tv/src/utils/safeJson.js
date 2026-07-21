function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    return fallback;
  }
}

function stringifyJson(value, fallback = "[]") {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return fallback;
  }
}

module.exports = {
  parseJson,
  stringifyJson
};
