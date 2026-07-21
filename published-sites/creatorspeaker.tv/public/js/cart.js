const CART_KEY = "creatorspeaker-tv-cart";

function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

function writeCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function addItem(item) {
  const cart = readCart();
  const existing = cart.find((entry) => String(entry.packageId) === String(item.packageId));
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...item, quantity: 1 });
  }
  writeCart(cart);
}

function money(cents) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
}

function total(cart) {
  return cart.reduce((sum, item) => sum + Number(item.priceCents || 0) * Number(item.quantity || 1), 0);
}

function renderCart(containerId, totalId) {
  const container = document.getElementById(containerId);
  const totalNode = document.getElementById(totalId);
  if (!container || !totalNode) {
    return;
  }

  const cart = readCart();
  if (!cart.length) {
    container.innerHTML = "<p class='muted'>Non hai ancora selezionato alcun percorso.</p>";
    totalNode.textContent = money(0);
    return;
  }

  container.innerHTML = cart
    .map(
      (item, index) => `
        <div class="row-card">
          <div>
            <strong>${item.name}</strong>
            <p class="muted">Quantita: ${item.quantity}</p>
          </div>
          <div class="inline-actions">
            <span>${money(item.priceCents * item.quantity)}</span>
            <button type="button" class="ghost-button" data-remove-index="${index}">Rimuovi</button>
          </div>
        </div>`
    )
    .join("");
  totalNode.textContent = money(total(cart));

  container.querySelectorAll("[data-remove-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const updated = readCart();
      updated.splice(Number(button.dataset.removeIndex), 1);
      writeCart(updated);
      renderCart(containerId, totalId);
      renderRequestSummary();
    });
  });
}

function renderRequestSummary() {
  const itemsNode = document.getElementById("checkout-items");
  const totalNode = document.getElementById("checkout-total");
  const payloadNode = document.getElementById("cart-payload");
  if (!itemsNode || !totalNode || !payloadNode) {
    return;
  }
  const cart = readCart();
  itemsNode.innerHTML = cart
    .map(
      (item) => `
        <div class="row-card">
          <strong>${item.name}</strong>
          <span>${item.quantity} x ${money(item.priceCents)}</span>
        </div>`
    )
    .join("");
  totalNode.textContent = money(total(cart));
  payloadNode.value = JSON.stringify(cart.map((item) => ({ packageId: item.packageId, quantity: item.quantity })));
}

document.querySelectorAll(".add-to-cart").forEach((button) => {
  button.addEventListener("click", () => {
    addItem({
      packageId: button.dataset.packageId,
      name: button.dataset.packageName,
      priceCents: Number(button.dataset.packagePrice || 0)
    });
    button.textContent = "Aggiunto";
    setTimeout(() => {
      button.textContent = "Richiedi attivazione";
    }, 1200);
  });
});

renderCart("cart-items", "cart-total");
renderRequestSummary();
