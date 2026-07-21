const { formatDateLabel } = require("../utils/dates");

const COMPONENT_FIELDS = [
  ["happiness", "Felicita"],
  ["energy", "Energia"],
  ["sleep", "Sonno"],
  ["stress", "Stress invertito"],
  ["mood", "Umore"],
  ["physical_activity", "Movimento"],
  ["social_relations", "Relazioni"],
  ["gratitude", "Gratitudine"],
  ["meaning", "Significato"],
  ["day_satisfaction", "Soddisfazione"]
];

function average(items, selector) {
  if (!items.length) {
    return 0;
  }
  const total = items.reduce((sum, item) => sum + Number(selector(item) || 0), 0);
  return Math.round((total / items.length) * 10) / 10;
}

function normalizeTen(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.max(1, Math.min(10, numeric));
}

function normalizedComponent(entry, field) {
  const safe = normalizeTen(entry[field]);
  if (field === "stress") {
    return Math.round((100 - ((safe - 1) / 9) * 100) * 10) / 10;
  }
  return Math.round((((safe - 1) / 9) * 100) * 10) / 10;
}

function topComponent(entries, direction = "high") {
  const list = COMPONENT_FIELDS.map(([field, label]) => ({
    field,
    label,
    value: average(entries, (entry) => normalizedComponent(entry, field))
  }));
  list.sort((a, b) => (direction === "high" ? b.value - a.value : a.value - b.value));
  return list[0] || null;
}

function compareBucket(entries, field, comparator, leftLabel, rightLabel) {
  const left = entries.filter((entry) => comparator(normalizeTen(entry[field])));
  const right = entries.filter((entry) => !comparator(normalizeTen(entry[field])));
  if (!left.length || !right.length) {
    return null;
  }

  return {
    label: `${leftLabel} vs ${rightLabel}`,
    leftAverage: average(left, (entry) => entry.happy_score),
    rightAverage: average(right, (entry) => entry.happy_score)
  };
}

function buildActivityAssociations(entries, activityRows) {
  const scoreByDate = new Map(entries.map((entry) => [String(entry.entry_date).slice(0, 10), Number(entry.happy_score || 0)]));
  const buckets = new Map();

  activityRows.forEach((row) => {
    const label = row.activity_name || row.custom_name || "Attivita personale";
    const date = String(row.completed_date || "").slice(0, 10);
    const bucket = buckets.get(label) || { count: 0, scores: [] };
    bucket.count += 1;
    if (scoreByDate.has(date)) {
      bucket.scores.push(scoreByDate.get(date));
    }
    buckets.set(label, bucket);
  });

  return Array.from(buckets.entries())
    .map(([label, bucket]) => ({
      label,
      count: bucket.count,
      averageScore: average(bucket.scores, (value) => value)
    }))
    .filter((item) => item.count > 0 && item.averageScore > 0)
    .sort((a, b) => {
      if (b.averageScore === a.averageScore) {
        return b.count - a.count;
      }
      return b.averageScore - a.averageScore;
    })
    .slice(0, 6);
}

function buildMessages(entries, activityRows, totalDays) {
  const messages = [];
  const activityAssociations = buildActivityAssociations(entries, activityRows);
  const sleepDiff = compareBucket(entries, "sleep", (value) => value >= 7, "Sonno oltre 7", "Sonno sotto 7");
  const stressDiff = compareBucket(entries, "stress", (value) => value >= 7, "Stress alto", "Stress piu gestibile");
  const gratitudeDiff = compareBucket(entries, "gratitude", (value) => value >= 7, "Gratitudine alta", "Gratitudine piu bassa");
  const socialDiff = compareBucket(entries, "social_relations", (value) => value >= 7, "Relazioni alte", "Relazioni piu scariche");

  if (activityAssociations.length) {
    const top = activityAssociations[0];
    messages.push(
      `Nei giorni in cui hai completato ${top.label.toLowerCase()}, il tuo Happy Score medio e stato ${top.averageScore}`
    );
  }

  if (sleepDiff) {
    messages.push(
      `Quando il valore del sonno supera 7 su 10, il tuo Happy Score medio sale da ${sleepDiff.rightAverage} a ${sleepDiff.leftAverage}`
    );
  }

  if (stressDiff) {
    messages.push(
      `Stress elevato e poco riposo sembrano coincidere con punteggi piu bassi, con media ${stressDiff.leftAverage}`
    );
  }

  if (gratitudeDiff) {
    messages.push(
      `Le giornate con gratitudine alta risultano tra le piu positive del tuo diario, con media ${gratitudeDiff.leftAverage}`
    );
  }

  if (socialDiff) {
    messages.push(
      `Nei giorni con piu relazioni sociali positive, il tuo benessere medio e piu alto e arriva a ${socialDiff.leftAverage}`
    );
  }

  if (totalDays < 21) {
    messages.push("Indicazione preliminare, da confermare con piu giorni di utilizzo");
  } else if (activityAssociations.length) {
    const listed = activityAssociations.slice(0, 3).map((item) => item.label.toLowerCase()).join(", ");
    messages.push(`Le attivita piu presenti nelle tue giornate migliori sono ${listed}`);
  }

  return messages;
}

function buildInsights(entries, activityRows) {
  const totalDays = entries.length;
  const averageScore = average(entries, (entry) => entry.happy_score);
  const bestDay = entries.length
    ? [...entries].sort((a, b) => Number(b.happy_score || 0) - Number(a.happy_score || 0))[0]
    : null;
  const hardestDay = entries.length
    ? [...entries].sort((a, b) => Number(a.happy_score || 0) - Number(b.happy_score || 0))[0]
    : null;
  const strongestComponent = totalDays ? topComponent(entries, "high") : null;
  const weakestComponent = totalDays ? topComponent(entries, "low") : null;
  const activityAssociations = buildActivityAssociations(entries, activityRows);
  const weeklySeries = entries.slice(-7).map((entry) => ({
    label: formatDateLabel(entry.entry_date),
    value: Number(entry.happy_score || 0)
  }));
  const monthlySeries = entries.slice(-30).map((entry) => ({
    label: String(entry.entry_date).slice(5),
    value: Number(entry.happy_score || 0)
  }));
  const componentAverages = COMPONENT_FIELDS.map(([field, label]) => ({
    label,
    value: average(entries, (entry) => normalizedComponent(entry, field))
  }));
  const stressSeries = entries.slice(-14).map((entry) => ({
    label: String(entry.entry_date).slice(5),
    stress: normalizeTen(entry.stress) * 10,
    score: Number(entry.happy_score || 0)
  }));
  const sleepSeries = entries.slice(-14).map((entry) => ({
    label: String(entry.entry_date).slice(5),
    sleep: normalizeTen(entry.sleep) * 10,
    score: Number(entry.happy_score || 0)
  }));

  if (totalDays < 3) {
    return {
      totalDays,
      averageScore,
      hasMinimumData: false,
      hasWeeklyData: false,
      hasDeepData: false,
      emptyMessage: "Servono ancora alcuni giorni di dati per iniziare a riconoscere pattern personali",
      bestDay,
      hardestDay,
      strongestComponent,
      weakestComponent,
      weeklySeries,
      monthlySeries,
      componentAverages,
      activityAssociations,
      stressSeries,
      sleepSeries,
      messages: []
    };
  }

  return {
    totalDays,
    averageScore,
    hasMinimumData: true,
    hasWeeklyData: totalDays >= 7,
    hasDeepData: totalDays >= 21,
    emptyMessage: "",
    bestDay,
    hardestDay,
    strongestComponent,
    weakestComponent,
    weeklySeries,
    monthlySeries,
    componentAverages,
    activityAssociations,
    stressSeries,
    sleepSeries,
    messages: buildMessages(entries, activityRows, totalDays)
  };
}

module.exports = {
  buildInsights
};
