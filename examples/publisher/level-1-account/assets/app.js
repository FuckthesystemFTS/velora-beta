const output = document.querySelector("#output");
document.querySelector("#session")?.addEventListener("click", async () => {
  const velora = globalThis.Velora;
  if (!velora?.auth?.getSession) {
    output.textContent = "Velora SDK non disponibile in questo ambiente.";
    return;
  }
  const session = await velora.auth.getSession();
  output.textContent = JSON.stringify(session, null, 2);
});
