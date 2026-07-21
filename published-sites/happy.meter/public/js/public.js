document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href");
    if (!id || id === "#") {
      return;
    }
    const target = document.querySelector(id);
    if (!target) {
      return;
    }
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

const currentUrl = new URL(window.location.href);
const storedLanguage = window.localStorage.getItem("happymeter-language");

document.querySelectorAll("[data-welcome-enter]").forEach((button) => {
  button.addEventListener("click", () => {
    window.localStorage.setItem("happymeter-welcome-seen", "true");
    document.cookie = "happymeter-welcome-seen=true; path=/; max-age=31536000; samesite=lax";
  });
});

const overlay = document.querySelector("[data-home-overlay]");
if (overlay) {
  window.setTimeout(() => {
    overlay.classList.add("hero-claim-overlay--settled");
  }, 1800);
}

if (storedLanguage && !currentUrl.searchParams.get("lang")) {
  document.body.dataset.language = storedLanguage;
}
