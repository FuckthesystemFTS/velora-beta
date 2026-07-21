const { assert, db, withServer, loginAdmin, loginStaff, Client } = require("./admin-check-client");

async function main() {
  await withServer(async (baseUrl) => {
    const guest = new Client(baseUrl);
    assert((await guest.request("/admin/dashboard")).status === 302, "Utente non loggato entra in admin");

    const admin = await loginAdmin(baseUrl);
    const dashboard = await admin.text("/admin/dashboard");
    assert(dashboard.response.status === 200, "Dashboard admin non risponde");
    assert(dashboard.text.includes("data-admin-toggle"), "Pulsante Menu mancante");
    assert(dashboard.text.includes("aria-expanded"), "Menu senza aria-expanded");
    assert(dashboard.text.includes("admin-breadcrumb"), "Breadcrumb mancante");
    assert(dashboard.text.includes("admin-work-card"), "Card dashboard mancanti");
    assert(!dashboard.text.includes('href="#"'), "Dashboard contiene href vuoto");
    assert(dashboard.text.includes("Password iniziale ancora attiva"), "Banner password non rifinito");

    const routes = [
      "/admin/requests",
      "/admin/clients",
      "/admin/content",
      "/admin/cms-packages",
      "/admin/media",
      "/admin/settings",
      "/admin/staff",
      "/admin/analytics",
      "/admin/site",
      "/admin/payments"
    ];
    for (const route of routes) {
      const result = await admin.text(route);
      assert(result.response.status === 200, `${route} non risponde 200`);
      assert(result.text.includes("Torna al pannello") || route === "/admin/dashboard", `${route} senza ritorno al pannello`);
      assert(!result.text.match(/undefined|null|NaN|\[object Object\]/), `${route} contiene testo tecnico`);
    }

    const slug = "codex-check-package";
    const existingPackage = await db.get("SELECT id FROM service_packages WHERE slug = ?", [slug]);
    await admin.postForm("/admin/cms-packages", {
      ...(existingPackage ? { id: String(existingPackage.id) } : {}),
      title: "Codex check package",
      slug,
      category: "creator",
      short_description: "Pacchetto di controllo operativo",
      long_description: "Creato dallo script di verifica admin",
      price: "1",
      currency: "EUR",
      billing_type: "one_time",
      features: "Verifica creazione\nVerifica modifica",
      status: "draft",
      sort_order: "999",
      cta_label: "Richiedi"
    }, "/admin/cms-packages");
    const created = await db.get("SELECT id FROM service_packages WHERE slug = ?", [slug]);
    assert(created, "Admin non crea pacchetto CMS");

    await admin.postForm("/admin/cms-packages", {
      id: String(created.id),
      title: "Codex check package updated",
      slug,
      category: "creator",
      short_description: "Pacchetto aggiornato",
      long_description: "Aggiornamento dallo script admin",
      price: "2",
      currency: "EUR",
      billing_type: "one_time",
      features: "Verifica aggiornata",
      status: "hidden",
      sort_order: "999",
      cta_label: "Richiedi"
    }, "/admin/cms-packages");
    const updated = await db.get("SELECT status, price FROM service_packages WHERE id = ?", [created.id]);
    assert(updated && updated.status === "hidden", "Admin non modifica pacchetto CMS");

    const request = await db.get("SELECT id FROM notifications_log ORDER BY id DESC LIMIT 1");
    if (request) {
      await admin.postForm(`/admin/requests/${request.id}/status`, { status: "in lavorazione" }, "/admin/requests");
      const changed = await db.get("SELECT status FROM notifications_log WHERE id = ?", [request.id]);
      assert(changed.status === "in lavorazione", "Admin non aggiorna richiesta");
    }

    const staff = await loginStaff(baseUrl);
    const staffDashboard = await staff.text("/staff/dashboard");
    assert(staffDashboard.response.status === 200, "Dashboard staff non risponde");
    assert(staffDashboard.text.includes("Area staff"), "Staff non vede dashboard dedicata");
    const staffSettings = await staff.request("/staff/settings");
    assert(staffSettings.status === 302, "Staff accede a impostazioni senza permesso");

    console.log("check-admin-final-operational: OK");
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
