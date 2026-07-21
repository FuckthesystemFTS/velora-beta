(function initAuthModal() {
  const modal = document.querySelector("[data-auth-modal]");
  if (!modal) {
    return;
  }

  const titleNode = modal.querySelector("[data-auth-modal-title]");
  const bodyNode = modal.querySelector("[data-auth-modal-body]");
  const loginLink = modal.querySelector("[data-auth-modal-login]");
  const registerLink = modal.querySelector("[data-auth-modal-register]");
  const closeButtons = modal.querySelectorAll("[data-auth-modal-close]");

  function closeModal() {
    modal.classList.remove("is-open");
    document.body.classList.remove("modal-open");
  }

  function buildUrl(baseUrl, redirect) {
    const nextUrl = new URL(baseUrl, window.location.origin);
    if (redirect) {
      nextUrl.searchParams.set("redirect", redirect);
    }
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  }

  function openModal(options) {
    const redirectTo = options && options.redirectTo ? options.redirectTo : window.location.pathname + window.location.search;
    titleNode.textContent = (options && options.title) || modal.dataset.defaultTitle;
    bodyNode.textContent = (options && options.body) || modal.dataset.defaultBody;
    loginLink.setAttribute("href", buildUrl("/login", redirectTo));
    registerLink.setAttribute("href", buildUrl("/register", redirectTo));
    modal.classList.add("is-open");
    document.body.classList.add("modal-open");
  }

  closeButtons.forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });

  window.HappyMeterAuthModal = {
    open: openModal,
    close: closeModal
  };
})();
