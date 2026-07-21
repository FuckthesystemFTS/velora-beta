const languageForms = document.querySelectorAll("[data-language-form]");
const languageLinks = document.querySelectorAll("[data-lang-link]");

function setLanguageStorage(value) {
  if (!value) {
    return;
  }

  window.localStorage.setItem("happymeter-language", value);
  document.cookie = `happymeter-language=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

function updateLanguageLinks(value) {
  languageLinks.forEach((link) => {
    const basePath = link.dataset.langLink;
    if (!basePath) {
      return;
    }

    const nextUrl = new URL(basePath, window.location.origin);
    nextUrl.searchParams.set("lang", value);
    link.setAttribute("href", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  });
}

const queryLanguage = new URL(window.location.href).searchParams.get("lang");

if (queryLanguage) {
  setLanguageStorage(queryLanguage);
  updateLanguageLinks(queryLanguage);
}

languageForms.forEach((form) => {
  const select = form.querySelector("[data-language-select]");
  if (!select) {
    return;
  }

  select.addEventListener("change", () => {
    const value = select.value;
    setLanguageStorage(value);
    updateLanguageLinks(value);

    const action = form.getAttribute("action") || window.location.pathname;
    const nextUrl = new URL(action, window.location.origin);
    nextUrl.searchParams.set("lang", value);
    window.location.assign(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  });
});
