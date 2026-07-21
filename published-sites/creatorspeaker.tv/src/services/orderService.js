const db = require("../db");
const { parseJson, stringifyJson } = require("../utils/safeJson");

async function nextOrderCode() {
  const year = new Date().getFullYear();
  const row = await db.get("SELECT id FROM orders ORDER BY id DESC LIMIT 1");
  const nextNumber = ((row && row.id) || 0) + 1;
  return `CSTV-${year}-${String(nextNumber).padStart(6, "0")}`;
}

async function resolveBankInstructions(orderCode) {
  const bank = (await db.getSetting("bank", {})) || {};
  return [
    `Intestatario: ${bank.holder || "CreatorSpeaker TV"}`,
    `IBAN: ${bank.iban || "INSERIRE-IBAN-REALE-DA-PANNELLO-ADMIN"}`,
    `Causale: ${(bank.causalPrefix || "Ordine creatorspeaker TV")} ${orderCode}`,
    bank.adminNote || "Attivazione entro 5 giorni lavorativi dalla verifica del bonifico"
  ].join("\n");
}

async function createNotification(type, target, subject, body, status = "logged") {
  await db.insert("notifications_log", {
    type,
    target,
    subject,
    body,
    status
  });
}

function resolvePaymentSetup(paymentMethod) {
  if (paymentMethod === "paypal") {
    return {
      status: "pending_payment_setup",
      paymentStatus: "configuration_required",
      paymentProvider: "paypal"
    };
  }

  if (paymentMethod === "stripe") {
    return {
      status: "pending_payment_setup",
      paymentStatus: "configuration_required",
      paymentProvider: "stripe"
    };
  }

  return {
    status: "pending_bank_transfer",
    paymentStatus: "pending",
    paymentProvider: "bank_transfer"
  };
}

async function hydrateItems(rawItems) {
  const items = [];
  for (const item of rawItems) {
    const pkg = await db.get(
      "SELECT id, area, name, slug, price_cents, billing_type, description FROM packages WHERE id = ?",
      [item.packageId]
    );
    if (!pkg) {
      continue;
    }
    items.push({
      packageId: pkg.id,
      name: pkg.name,
      area: pkg.area,
      billingType: pkg.billing_type,
      priceCents: pkg.price_cents,
      quantity: Math.max(1, Number(item.quantity || 1)),
      subtotalCents: pkg.price_cents * Math.max(1, Number(item.quantity || 1))
    });
  }
  return items;
}

async function createOrder({ userId, customer, rawItems, paymentMethod = "bank_transfer" }) {
  const items = await hydrateItems(rawItems);
  const totalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
  const orderCode = await nextOrderCode();
  const bankInstructions = await resolveBankInstructions(orderCode);
  const paymentSetup = resolvePaymentSetup(paymentMethod);
  let linkedUserId = userId || null;

  if (!linkedUserId && customer.email) {
    const existingUser = await db.get("SELECT id FROM users WHERE email = ?", [customer.email]);
    linkedUserId = existingUser ? existingUser.id : null;
  }

  const orderId = await db.insert("orders", {
    order_code: orderCode,
    user_id: linkedUserId,
    customer_name: customer.name,
    customer_email: customer.email,
    customer_phone: customer.phone || "",
    company_name: customer.company || "",
    total_cents: totalCents,
    status: paymentSetup.status,
    bank_instructions: paymentMethod === "bank_transfer" ? bankInstructions : "",
    items_json: stringifyJson(items),
    notes: customer.notes || "",
    admin_notes: "",
    payment_method: paymentMethod,
    payment_status: paymentSetup.paymentStatus,
    payment_provider: paymentSetup.paymentProvider,
    payment_reference: "",
    payment_last_event_at: new Date().toISOString()
  });

  await createNotification(
    "order_confirmation",
    customer.email,
    `Ordine ${orderCode} creato`,
    paymentMethod === "bank_transfer"
      ? `Ordine creato in modalita bonifico\n${bankInstructions}`
      : `Ordine creato in modalita ${paymentMethod}\nIl provider verra attivato dopo configurazione chiavi`,
    "simulated"
  );

  return await db.get("SELECT * FROM orders WHERE id = ?", [orderId]);
}

async function activateOrder(orderId) {
  const order = await db.get("SELECT * FROM orders WHERE id = ?", [orderId]);
  if (!order) {
    return null;
  }

  await db.run(
    "UPDATE orders SET status = 'activated', payment_status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [orderId]
  );

  const items = parseJson(order.items_json, []);
  if (order.user_id) {
    await db.run("UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      order.user_id
    ]);
  }

  for (const item of items) {
    if (!order.user_id || item.billingType !== "monthly") {
      continue;
    }
    const existing = await db.get(
      "SELECT id FROM subscriptions WHERE user_id = ? AND package_id = ? AND order_id = ?",
      [order.user_id, item.packageId, order.id]
    );
    if (existing) {
      continue;
    }
    await db.insert("subscriptions", {
      user_id: order.user_id,
      package_id: item.packageId,
      order_id: order.id,
      status: "active",
      starts_at: new Date().toISOString(),
      ends_at: null
    });
  }

  return await db.get("SELECT * FROM orders WHERE id = ?", [orderId]);
}

module.exports = {
  createOrder,
  activateOrder,
  createNotification
};
