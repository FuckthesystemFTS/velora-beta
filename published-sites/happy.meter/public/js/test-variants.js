(function initTestVariants() {
  function updateRangeValues() {
    document.querySelectorAll(".range-row").forEach((row) => {
      const input = row.querySelector('input[type="range"]');
      const output = row.querySelector("[data-range-value]");
      if (!input || !output) {
        return;
      }
      const sync = () => {
        output.textContent = String(input.value || "0");
      };
      input.addEventListener("input", sync);
      sync();
    });
  }

  function numericValue(input) {
    const value = Number(input?.value || 0);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(10, Math.round(value)));
  }

  function bindLiveScore() {
    document.querySelectorAll("[data-live-score-card]").forEach((card) => {
      const mode = card.dataset.liveScoreCard;
      const output = card.querySelector("[data-live-total]");
      const label = card.querySelector("[data-live-label]");
      if (!output) {
        return;
      }

      const update = () => {
        if (mode === "B") {
          let missionsScore = 0;
          card.querySelectorAll('[data-mission-checkbox]:checked').forEach((checkbox) => {
            missionsScore += Number(checkbox.dataset.points || 0);
          });
          const reflection = String(card.querySelector('[name="reflection_text"]')?.value || "").trim();
          const reflectionScore = reflection.length >= 20 ? 5 : 0;
          const total = Math.max(0, Math.min(100, missionsScore + reflectionScore));
          output.textContent = String(total);
          if (label) {
            label.textContent = `${missionsScore}/95 + ${reflectionScore}/5`;
          }
          return;
        }

        if (mode === "C") {
          const happiness = numericValue(card.querySelector('[name="happiness"]'));
          const energy = numericValue(card.querySelector('[name="energy"]'));
          const stress = numericValue(card.querySelector('[name="stress"]'));
          const socialRelations = numericValue(card.querySelector('[name="social_relations"]'));
          const gratitude = numericValue(card.querySelector('[name="gratitude"]'));
          const sliderScore = Math.max(0, Math.min(50, happiness + energy + (10 - stress) + socialRelations + gratitude));

          let missionsScore = 0;
          card.querySelectorAll('[data-mission-checkbox]:checked').forEach((checkbox) => {
            missionsScore += Number(checkbox.dataset.points || 0);
          });

          const reflection = String(card.querySelector('[name="reflection_text"]')?.value || "").trim();
          const reflectionScore = reflection.length >= 20 ? 10 : 0;
          const total = Math.max(0, Math.min(100, sliderScore + missionsScore + reflectionScore));
          output.textContent = String(total);
          if (label) {
            label.textContent = `${sliderScore}/50 + ${missionsScore}/40 + ${reflectionScore}/10`;
          }
        }
      };

      card.addEventListener("input", update);
      card.addEventListener("change", update);
      update();
    });
  }

  function bindLikeButtons() {
    document.querySelectorAll("[data-test-like]").forEach((button) => {
      button.addEventListener("click", async () => {
        const code = button.dataset.testLike;
        if (!code) {
          return;
        }

        button.disabled = true;
        try {
          const response = await fetch(`/test/${code}/like`, {
            method: "POST",
            headers: {
              Accept: "application/json"
            }
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) {
            if (payload && payload.authRequired && window.HappyMeterAuthModal) {
              window.HappyMeterAuthModal.open({
                title: button.dataset.authTitle || "Accedi per votare",
                body: payload.message || button.dataset.authBody || "Accedi o registrati per votare il tuo test preferito",
                redirectTo: window.location.pathname + window.location.search
              });
              return;
            }
            throw new Error("like-failed");
          }

          button.classList.add("is-liked");
          button.setAttribute("aria-pressed", "true");
          const counter = document.querySelector(`[data-test-like-count="${code}"]`);
          if (counter && !payload.alreadyLiked) {
            counter.textContent = String(Number(counter.textContent || 0) + 1);
          }
          const status = document.querySelector("[data-test-like-feedback]");
          if (status) {
            status.textContent = payload.message || "";
          }
        } catch (error) {
          const status = document.querySelector("[data-test-like-feedback]");
          if (status) {
            status.textContent = button.dataset.errorText || "Non e stato possibile salvare il voto";
          }
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  updateRangeValues();
  bindLiveScore();
  bindLikeButtons();
})();
