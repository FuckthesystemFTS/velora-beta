const styleSelect = document.getElementById("video-style");
if (styleSelect) {
  styleSelect.addEventListener("change", () => {
    styleSelect.title = `Costo crediti: ${styleSelect.options[styleSelect.selectedIndex].text}`;
  });
}

const builder = document.querySelector("[data-video-builder]");
if (builder) {
  const imageInput = builder.querySelector("[data-video-images]");
  const audioInput = builder.querySelector("[data-video-audio]");
  const audioPreview = builder.querySelector("[data-audio-preview]");
  const timeline = builder.querySelector("[data-video-timeline]");
  const totalDuration = builder.querySelector("[data-total-duration]");
  const selectedProfileName = builder.querySelector("[data-selected-profile-name]");
  const selectedProfileCost = builder.querySelector("[data-selected-profile-cost]");
  const advancedAudio = builder.querySelector("[data-advanced-audio]");
  const timelineHelp = builder.querySelector("[data-timeline-help]");

  const parseFeatures = (profileOption) => {
    try {
      return JSON.parse(profileOption.getAttribute("data-features") || "{}");
    } catch (error) {
      return {};
    }
  };

  const selectedProfile = () => builder.querySelector("[data-profile-option]:checked");

  const updateTotals = () => {
    const durations = Array.from(builder.querySelectorAll("[data-scene-duration]"));
    const seconds = durations.reduce((sum, input) => sum + Number(input.value || 0), 0);
    if (totalDuration) {
      totalDuration.textContent = `${Math.round(seconds * 10) / 10} sec`;
    }
  };

  const updateProfileControls = () => {
    const profile = selectedProfile();
    if (!profile) {
      return;
    }
    const features = parseFeatures(profile);
    const label = profile.closest(".profile-card");
    if (selectedProfileName && label) {
      selectedProfileName.textContent = label.querySelector("span").textContent;
    }
    if (selectedProfileCost) {
      selectedProfileCost.textContent = profile.getAttribute("data-credits") || "0";
    }
    if (advancedAudio) {
      advancedAudio.hidden = !features.audioTrim;
    }
    if (timelineHelp) {
      timelineHelp.textContent = features.customDurations
        ? "Puoi regolare durata scena e, se previsto dal profilo, testo e transizione"
        : "Nel livello semplice la durata scena resta automatica";
    }
    builder.querySelectorAll("[data-advanced-scene]").forEach((node) => {
      node.hidden = !features.customDurations;
    });
    builder.querySelectorAll("[data-caption-field]").forEach((node) => {
      node.hidden = !features.captions;
    });
    builder.querySelectorAll("[data-transition-field]").forEach((node) => {
      node.hidden = !features.transitions;
    });
    updateTotals();
  };

  const renderTimeline = () => {
    const files = imageInput ? Array.from(imageInput.files || []) : [];
    const profile = selectedProfile();
    const defaultDuration = Number(profile ? profile.getAttribute("data-default-duration") : 5) || 5;
    const maxImages = Number(profile ? profile.getAttribute("data-max-images") : 10) || 10;
    if (!timeline) {
      return;
    }
    timeline.innerHTML = "";
    files.slice(0, maxImages).forEach((file, index) => {
      const row = document.createElement("div");
      row.className = "timeline-item";
      const preview = URL.createObjectURL(file);
      row.innerHTML = `
        <img src="${preview}" alt="Anteprima ${index + 1}" />
        <div>
          <strong>${index + 1}. ${file.name}</strong>
          <div class="form-grid two" data-advanced-scene>
            <label>Durata sec
              <input type="number" name="image_duration_seconds" min="1" max="60" step="0.5" value="${defaultDuration}" data-scene-duration />
            </label>
            <label data-transition-field>Transizione
              <select name="image_transition">
                <option value="none">nessuna</option>
                <option value="fade">fade</option>
              </select>
            </label>
          </div>
          <label data-caption-field>Testo scena
            <input type="text" name="image_caption" maxlength="160" placeholder="opzionale" />
          </label>
        </div>
      `;
      row.querySelectorAll("input, select").forEach((input) => {
        input.addEventListener("input", updateTotals);
      });
      timeline.appendChild(row);
    });
    if (!files.length) {
      timeline.innerHTML = '<p class="muted">Seleziona le immagini per costruire la timeline</p>';
    }
    updateProfileControls();
  };

  builder.querySelectorAll("[data-profile-option]").forEach((option) => {
    option.addEventListener("change", renderTimeline);
  });
  if (imageInput) {
    imageInput.addEventListener("change", renderTimeline);
  }
  if (audioInput && audioPreview) {
    audioInput.addEventListener("change", () => {
      const file = audioInput.files && audioInput.files[0];
      if (!file) {
        audioPreview.hidden = true;
        audioPreview.removeAttribute("src");
        return;
      }
      audioPreview.src = URL.createObjectURL(file);
      audioPreview.hidden = false;
    });
  }
  updateProfileControls();
}

document.querySelectorAll("[data-job-status]").forEach((statusCard) => {
  const statusUrl = statusCard.getAttribute("data-job-status-url");
  const progressBar = statusCard.querySelector("[data-job-progress-bar]");
  const statusLabel = statusCard.querySelector("[data-job-status-label]");
  const statusDetail = statusCard.querySelector("[data-job-status-detail]");
  const progressText = statusCard.querySelector("[data-job-progress-text]");
  const outputLink = statusCard.querySelector("[data-job-output-link]");
  const refreshInterval = Number(statusCard.getAttribute("data-job-refresh-ms") || 4000);
  const reloadOnComplete = statusCard.getAttribute("data-job-reload-complete") === "true";

  const refreshStatus = async () => {
    try {
      const response = await fetch(statusUrl, {
        headers: {
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (!payload.ok) {
        return;
      }

      const progressPercent = Math.max(0, Math.min(100, Number(payload.progressPercent || 0)));
      if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
        progressBar.setAttribute("aria-valuenow", String(progressPercent));
      }
      if (progressText) {
        progressText.textContent = `${progressPercent}%`;
      }
      if (statusLabel) {
        statusLabel.textContent = payload.statusLabel || payload.status;
      }
      if (statusDetail) {
        statusDetail.textContent = payload.errorMessage || payload.statusDetail || "";
      }
      if (outputLink && payload.outputUrl) {
        outputLink.hidden = false;
        outputLink.href = payload.outputUrl;
      }

      if (payload.status === "processing") {
        window.setTimeout(refreshStatus, refreshInterval);
      } else if (reloadOnComplete && payload.status === "completed" && payload.outputUrl && !document.querySelector(".preview-video")) {
        window.location.reload();
      }
    } catch (error) {
      window.setTimeout(refreshStatus, 7000);
    }
  };

  window.setTimeout(refreshStatus, 2500);
});
