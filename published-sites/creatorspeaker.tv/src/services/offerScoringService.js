function computeDiscount(normalPriceCents, currentPriceCents) {
  if (!normalPriceCents || normalPriceCents <= currentPriceCents) {
    return 0;
  }
  return Math.round(((normalPriceCents - currentPriceCents) / normalPriceCents) * 100);
}

function computeOfferScore(offer, categoryWeight = 0) {
  let score = 0;
  score += computeDiscount(offer.normal_price_cents, offer.current_price_cents) * 1.5;
  score += offer.prime_available ? 10 : 0;
  score += offer.current_price_cents < 5000 ? 8 : 0;
  score += offer.current_price_cents < 25000 ? 12 : 4;
  score += categoryWeight;
  if (offer.status && String(offer.status).includes("published")) {
    score -= 25;
  }
  if (offer.duplicatePenalty) {
    score -= offer.duplicatePenalty;
  }
  return Math.max(0, Math.round(score));
}

module.exports = {
  computeDiscount,
  computeOfferScore
};
