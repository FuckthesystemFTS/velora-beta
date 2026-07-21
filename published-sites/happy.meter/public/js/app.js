document.querySelectorAll("[data-score-ring]").forEach((ring) => {
  const score = Number(ring.dataset.score || 0);
  const degrees = Math.max(0, Math.min(100, score)) * 3.6;
  ring.style.background = `conic-gradient(#59c36a ${degrees}deg, #ffd84d ${degrees}deg, rgba(6,59,69,0.08) ${degrees}deg)`;
});

document.querySelectorAll(".range-row").forEach((row) => {
  const input = row.querySelector('input[type="range"]');
  const output = row.querySelector("[data-range-value]");
  if (!input || !output) {
    return;
  }
  input.addEventListener("input", () => {
    output.textContent = input.value;
  });
});
