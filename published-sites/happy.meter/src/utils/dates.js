function pad(value) {
  return String(value).padStart(2, "0");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(value) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short"
  }).format(new Date(value));
}

function dayDiff(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00Z`);
  const b = new Date(`${dateB}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function getWeekStart(date = todayIso()) {
  const source = new Date(`${date}T00:00:00Z`);
  const weekday = source.getUTCDay() || 7;
  source.setUTCDate(source.getUTCDate() - weekday + 1);
  return source.toISOString().slice(0, 10);
}

function getMonthStart(date = todayIso()) {
  const source = new Date(`${date}T00:00:00Z`);
  return `${source.getUTCFullYear()}-${pad(source.getUTCMonth() + 1)}-01`;
}

module.exports = {
  addDays,
  dayDiff,
  formatDateLabel,
  getMonthStart,
  getWeekStart,
  todayIso
};
