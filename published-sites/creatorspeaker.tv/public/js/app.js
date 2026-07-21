const menuToggle = document.querySelector("[data-menu-toggle]");
const menuPanel = document.querySelector("[data-menu-panel]");

if (menuToggle && menuPanel) {
  menuToggle.addEventListener("click", () => {
    menuPanel.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(menuPanel.classList.contains("open")));
  });

  menuPanel.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menuPanel.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
}

document.querySelectorAll("[data-slider-prev]").forEach((button) => {
  button.addEventListener("click", () => {
    const track = document.getElementById(button.dataset.sliderPrev);
    if (!track) {
      return;
    }
    track.scrollBy({ left: -320, behavior: "smooth" });
  });
});

document.querySelectorAll("[data-slider-next]").forEach((button) => {
  button.addEventListener("click", () => {
    const track = document.getElementById(button.dataset.sliderNext);
    if (!track) {
      return;
    }
    track.scrollBy({ left: 320, behavior: "smooth" });
  });
});

document.querySelectorAll("[data-upload-form]").forEach((form) => {
  const progress = form.querySelector("[data-upload-progress]");
  const progressBar = form.querySelector("[data-upload-progress-bar]");
  const progressText = form.querySelector("[data-upload-progress-text]");
  const submitButton = form.querySelector("[data-upload-submit]");

  form.addEventListener("submit", (event) => {
    if (!window.FormData || !window.XMLHttpRequest) {
      return;
    }

    event.preventDefault();
    const request = new XMLHttpRequest();
    const payload = new FormData(form);
    const maxUploadMb = Number(form.getAttribute("data-max-upload-mb") || 0);
    const maxUploadBytes = maxUploadMb > 0 ? maxUploadMb * 1024 * 1024 : 0;
    const fileInputs = Array.from(form.querySelectorAll('input[type="file"]'));
    const selectedFiles = fileInputs.flatMap((input) => Array.from(input.files || []));
    const tooLargeFile = maxUploadBytes ? selectedFiles.find((file) => file.size > maxUploadBytes) : null;
    const totalUploadBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);

    if (tooLargeFile) {
      if (progress) {
        progress.hidden = false;
      }
      if (progressText) {
        progressText.hidden = false;
        progressText.textContent = `File troppo grande: ${tooLargeFile.name}. Limite ${maxUploadMb} MB`;
      }
      return;
    }

    if (maxUploadBytes && totalUploadBytes > maxUploadBytes) {
      if (progress) {
        progress.hidden = false;
      }
      if (progressText) {
        progressText.hidden = false;
        progressText.textContent = `File selezionati troppo pesanti. Totale massimo ${maxUploadMb} MB`;
      }
      return;
    }

    const imageInput = form.querySelector('input[name="images"]');
    if (imageInput && imageInput.files && imageInput.files.length > 10) {
      if (progress) {
        progress.hidden = false;
      }
      if (progressText) {
        progressText.hidden = false;
        progressText.textContent = "Seleziona massimo 10 immagini";
      }
      return;
    }

    if (progress) {
      progress.hidden = false;
    }
    if (progressText) {
      progressText.hidden = false;
      progressText.textContent = "Upload in corso 0%";
    }
    if (progressBar) {
      progressBar.style.width = "0%";
    }
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Invio in corso";
    }

    request.upload.addEventListener("progress", (progressEvent) => {
      if (!progressEvent.lengthComputable) {
        return;
      }
      const percent = Math.min(100, Math.round((progressEvent.loaded / progressEvent.total) * 100));
      if (progressBar) {
        progressBar.style.width = `${percent}%`;
      }
      if (progressText) {
        progressText.textContent = `Upload in corso ${percent}%`;
      }
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 400) {
        if (progressText) {
          progressText.textContent = "Upload completato, aggiornamento pagina";
        }
        if (progressBar) {
          progressBar.style.width = "100%";
        }
        window.location.href = request.responseURL || form.action;
        return;
      }
      if (progressText) {
        progressText.textContent = "Upload non riuscito, controlla il file e riprova";
      }
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Riprova";
      }
    });

    request.addEventListener("error", () => {
      if (progressText) {
        progressText.textContent = "Upload non riuscito";
      }
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Riprova";
      }
    });

    request.open(form.method || "POST", form.action, true);
    request.send(payload);
  });
});

document.querySelectorAll("[data-reveal-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const confirmed = window.confirm(
      "Stai per visualizzare credenziali riservate. Non condividerle con nessuno. La visualizzazione verra registrata"
    );
    if (!confirmed) {
      return;
    }

    const panel = form.closest("[data-credentials-panel]");
    const emailNode = panel && panel.querySelector("[data-credential-email]");
    const passwordNode = panel && panel.querySelector("[data-credential-password]");
    const actionsNode = panel && panel.querySelector("[data-reveal-actions]");
    const loginLink = panel && panel.querySelector("[data-login-link]");
    const submitButton = form.querySelector("[data-reveal-button]");

    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Caricamento";
      }
      const response = await fetch(form.action, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Cache-Control": "no-store"
        },
        body: new URLSearchParams(new FormData(form))
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Visualizzazione non consentita");
      }
      if (emailNode) {
        emailNode.textContent = payload.email;
      }
      if (passwordNode) {
        passwordNode.textContent = payload.password;
      }
      if (actionsNode) {
        actionsNode.hidden = false;
        actionsNode.dataset.email = payload.email;
        actionsNode.dataset.password = payload.password;
      }
      if (loginLink) {
        loginLink.hidden = false;
        loginLink.href = payload.loginUrl;
      }
      form.hidden = true;
    } catch (error) {
      window.alert(error.message || "Errore durante la visualizzazione");
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Mostra credenziali";
      }
    }
  });
});

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const actionsNode = button.closest("[data-reveal-actions]");
    if (!actionsNode || !navigator.clipboard) {
      return;
    }
    const key = button.dataset.copyTarget;
    const value = actionsNode.dataset[key];
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = key === "email" ? "Email copiata" : "Password copiata";
      window.setTimeout(() => {
        button.textContent = key === "email" ? "Copia email" : "Copia password";
      }, 1500);
    } catch (error) {
      window.alert("Copia non riuscita");
    }
  });
});
