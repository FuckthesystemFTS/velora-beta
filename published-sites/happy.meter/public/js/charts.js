document.querySelectorAll("[data-chart]").forEach((canvas) => {
  const labels = JSON.parse(canvas.dataset.labels || "[]");
  const series = canvas.dataset.series ? JSON.parse(canvas.dataset.series) : null;
  const values = JSON.parse(canvas.dataset.values || "[]");

  if (!labels.length || (!values.length && !series) || typeof Chart === "undefined") {
    return;
  }

  const type = canvas.dataset.chart || "line";
  const datasets = series || [
    {
      label: "Happy Score",
      data: values,
      borderColor: "#064e7a",
      backgroundColor: "rgba(125, 221, 242, 0.35)",
      fill: type === "line",
      borderWidth: 3,
      tension: 0.35
    }
  ];

  new Chart(canvas, {
    type,
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: datasets.length > 1
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100
        }
      }
    }
  });
});
