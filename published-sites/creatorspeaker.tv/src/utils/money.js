function cents(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function fromCents(value) {
  return Number(value || 0) / 100;
}

function formatMoney(value, currency = process.env.DEFAULT_CURRENCY || "EUR") {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency
  }).format(fromCents(value));
}

module.exports = {
  cents,
  fromCents,
  formatMoney
};
