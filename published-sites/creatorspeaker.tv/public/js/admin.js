const adminShell = document.querySelector("[data-admin-shell]");
const adminToggle = document.querySelector("[data-admin-toggle]");
const adminOverlay = document.querySelector("[data-admin-overlay]");

if (adminShell && adminToggle) {
  const setOpen = (open) => {
    adminShell.classList.toggle("nav-open", open);
    adminToggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("admin-nav-locked", open);
  };

  adminToggle.addEventListener("click", () => setOpen(!adminShell.classList.contains("nav-open")));
  adminOverlay?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });
  document.querySelectorAll(".admin-nav a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
}

document.querySelectorAll("[data-dismiss-banner]").forEach((button) => {
  button.addEventListener("click", () => {
    button.closest("[data-dismissible-banner]")?.remove();
  });
});

document.querySelectorAll("form").forEach((form) => {
  if (form.action.includes("/publish-") || form.action.includes("/refund") || form.action.includes("/delete")) {
    form.addEventListener("submit", (event) => {
      const confirmed = window.confirm("Confermi questa azione?");
      if (!confirmed) {
        event.preventDefault();
      }
    });
  }
});
