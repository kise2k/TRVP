// db.js
const Database = require("better-sqlite3");
const crypto = require("crypto");

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback (очень редко понадобится)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isISODate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDaysISO(dateStr, days) {
  // Работаем в UTC, чтобы не ловить DST
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function openDb(file = "warehouse.db") {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  return db;
}

function createRepo(db) {
  // ---- schema ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stock INTEGER NOT NULL CHECK(stock >= 0)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      order_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK(qty >= 1),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);
  `);

  // ---- prepared statements ----
  const st = {
    metaGet: db.prepare(`SELECT current_date AS currentDate FROM meta WHERE id=1`),
    metaSet: db.prepare(`INSERT INTO meta(id, current_date) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET current_date=excluded.current_date`),

    productsCount: db.prepare(`SELECT COUNT(*) AS c FROM products`),
    productList: db.prepare(`SELECT id, name, stock FROM products ORDER BY name`),
    productGet: db.prepare(`SELECT id, name, stock FROM products WHERE id=?`),
    productUpdateStock: db.prepare(`UPDATE products SET stock=? WHERE id=?`),
    productIncStock: db.prepare(`UPDATE products SET stock = stock + ? WHERE id=?`),
    productInsert: db.prepare(`INSERT INTO products(id, name, stock) VALUES(?, ?, ?)`),

    ordersList: db.prepare(`
      SELECT o.id, o.customer_name AS customerName, o.order_date AS orderDate,
             (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id) AS itemsCount
      FROM orders o
      ORDER BY o.order_date, o.customer_name
    `),
    orderGet: db.prepare(`SELECT id, customer_name AS customerName, order_date AS orderDate FROM orders WHERE id=?`),
    orderInsert: db.prepare(`INSERT INTO orders(id, customer_name, order_date) VALUES(?, ?, ?)`),
    orderUpdate: db.prepare(`UPDATE orders SET customer_name=?, order_date=? WHERE id=?`),
    orderDelete: db.prepare(`DELETE FROM orders WHERE id=?`),

    itemsByOrder: db.prepare(`
      SELECT i.id, i.order_id AS orderId, i.product_id AS productId, i.qty,
             p.name AS productName
      FROM order_items i
      JOIN products p ON p.id = i.product_id
      WHERE i.order_id=?
      ORDER BY p.name
    `),
    itemGet: db.prepare(`SELECT id, order_id AS orderId, product_id AS productId, qty FROM order_items WHERE id=?`),
    itemInsert: db.prepare(`INSERT INTO order_items(id, order_id, product_id, qty) VALUES(?, ?, ?, ?)`),
    itemUpdate: db.prepare(`UPDATE order_items SET product_id=?, qty=? WHERE id=?`),
    itemUpdateOrder: db.prepare(`UPDATE order_items SET order_id=? WHERE id=?`),
    itemDelete: db.prepare(`DELETE FROM order_items WHERE id=?`),

    reservedSum: db.prepare(`SELECT COALESCE(SUM(qty), 0) AS s FROM order_items WHERE product_id=?`),
    reservedSumExcluding: db.prepare(`SELECT COALESCE(SUM(qty), 0) AS s FROM order_items WHERE product_id=? AND id<>?`),

    deleteExpiredOrders: db.prepare(`DELETE FROM orders WHERE order_date < ?`),

    ordersForDate: db.prepare(`SELECT id FROM orders WHERE order_date=?`),
    shipSumsForDate: db.prepare(`
      SELECT oi.product_id AS productId, SUM(oi.qty) AS totalQty
      FROM order_items oi
      WHERE oi.order_id IN (SELECT id FROM orders WHERE order_date=?)
      GROUP BY oi.product_id
    `),
    deleteOrdersForDate: db.prepare(`DELETE FROM orders WHERE order_date=?`),
  };

  function getCurrentDate() {
    const row = st.metaGet.get();
    return row?.currentDate || null;
  }

  function ensureMeta() {
    let cd = getCurrentDate();
    if (!cd) {
      // current date = today (UTC) in ISO date
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const d = String(now.getUTCDate()).padStart(2, "0");
      cd = `${y}-${m}-${d}`;
      st.metaSet.run(cd);
    }
    return cd;
  }

  function seedProductsIfEmpty() {
    const { c } = st.productsCount.get();
    if (c > 0) return;

    const seed = [
      { name: "Кабель USB-C 1м", stock: 30 },
      { name: "Мышь беспроводная", stock: 15 },
      { name: "Клавиатура", stock: 12 },
      { name: "Наушники", stock: 18 },
      { name: "Флешка 64GB", stock: 22 },
      { name: "Батарейки AA (4 шт)", stock: 40 },
      { name: "Блок питания 65W", stock: 10 },
      { name: "Переходник HDMI", stock: 16 },
    ];

    const tx = db.transaction(() => {
      for (const p of seed) st.productInsert.run(uuid(), p.name, p.stock);
    });
    tx();
  }

  function init() {
    const cd = ensureMeta();
    // Удаляем заказы с истекшей датой при старте
    st.deleteExpiredOrders.run(cd);
    seedProductsIfEmpty();
    return { currentDate: cd };
  }

  function listProducts() {
    return st.productList.all();
  }

  function listOrders() {
    return st.ordersList.all();
  }

  function getOrderWithItems(orderId) {
    const order = st.orderGet.get(orderId);
    if (!order) throw new HttpError(404, "Заказ не найден");
    const items = st.itemsByOrder.all(orderId);
    return { ...order, items };
  }

  function assertOrderDateNotPast(orderDate) {
    const cd = getCurrentDate();
    if (!isISODate(orderDate)) throw new HttpError(400, "Некорректный формат даты (нужно YYYY-MM-DD)");
    if (orderDate < cd) throw new HttpError(409, "Дата заказа не может быть меньше текущей даты", { currentDate: cd });
  }

  function createOrder({ customerName, orderDate }) {
    if (!customerName || typeof customerName !== "string") throw new HttpError(400, "ФИО заказчика обязательно");
    assertOrderDateNotPast(orderDate);

    const id = uuid();
    st.orderInsert.run(id, customerName.trim(), orderDate);
    return getOrderWithItems(id);
  }

  function updateOrder(orderId, { customerName, orderDate }) {
    const existing = st.orderGet.get(orderId);
    if (!existing) throw new HttpError(404, "Заказ не найден");

    const newName = (customerName ?? existing.customerName);
    const newDate = (orderDate ?? existing.orderDate);

    if (!newName || typeof newName !== "string") throw new HttpError(400, "ФИО заказчика обязательно");
    assertOrderDateNotPast(newDate);

    st.orderUpdate.run(newName.trim(), newDate, orderId);
    return getOrderWithItems(orderId);
  }

  function deleteOrder(orderId) {
    const existing = st.orderGet.get(orderId);
    if (!existing) throw new HttpError(404, "Заказ не найден");
    st.orderDelete.run(orderId);
    return { ok: true };
  }

  function reservedSum(productId, excludeItemId = null) {
    if (excludeItemId) return st.reservedSumExcluding.get(productId, excludeItemId).s;
    return st.reservedSum.get(productId).s;
  }

  function checkAvailabilityOrThrow(productId, requestedQty, excludeItemId = null) {
    const product = st.productGet.get(productId);
    if (!product) throw new HttpError(404, "Товар не найден");

    const reserved = reservedSum(productId, excludeItemId);
    const available = product.stock - reserved;

    if (available < requestedQty) {
      throw new HttpError(409, "Недостаточно товара на складе для этой операции", {
        productId,
        productName: product.name,
        stock: product.stock,
        reserved,
        available,
        requestedQty,
      });
    }
  }

  const txAddItem = db.transaction((orderId, productId, qty) => {
    const order = st.orderGet.get(orderId);
    if (!order) throw new HttpError(404, "Заказ не найден");
    if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, "Количество должно быть целым числом >= 1");

    checkAvailabilityOrThrow(productId, qty, null);

    const id = uuid();
    st.itemInsert.run(id, orderId, productId, qty);
    return getOrderWithItems(orderId);
  });

  function addItem(orderId, { productId, qty }) {
    return txAddItem(orderId, productId, qty);
  }

  const txUpdateItem = db.transaction((orderId, itemId, productId, qty) => {
    const order = st.orderGet.get(orderId);
    if (!order) throw new HttpError(404, "Заказ не найден");

    const item = st.itemGet.get(itemId);
    if (!item || item.orderId !== orderId) throw new HttpError(404, "Позиция заказа не найдена");

    const newQty = qty ?? item.qty;
    const newProductId = productId ?? item.productId;

    if (!Number.isInteger(newQty) || newQty < 1) throw new HttpError(400, "Количество должно быть целым числом >= 1");

    // Проверяем доступность для нового товара, исключая текущую позицию (если товар тот же — корректно)
    checkAvailabilityOrThrow(newProductId, newQty, itemId);

    st.itemUpdate.run(newProductId, newQty, itemId);
    return getOrderWithItems(orderId);
  });

  function updateItem(orderId, itemId, payload) {
    return txUpdateItem(orderId, itemId, payload.productId, payload.qty);
  }

  const txDeleteItem = db.transaction((orderId, itemId) => {
    const order = st.orderGet.get(orderId);
    if (!order) throw new HttpError(404, "Заказ не найден");

    const item = st.itemGet.get(itemId);
    if (!item || item.orderId !== orderId) throw new HttpError(404, "Позиция заказа не найдена");

    st.itemDelete.run(itemId);
    return getOrderWithItems(orderId);
  });

  function deleteItem(orderId, itemId) {
    return txDeleteItem(orderId, itemId);
  }

  const txMoveItem = db.transaction((itemId, toOrderId) => {
    const item = st.itemGet.get(itemId);
    if (!item) throw new HttpError(404, "Позиция заказа не найдена");

    const toOrder = st.orderGet.get(toOrderId);
    if (!toOrder) throw new HttpError(404, "Целевой заказ не найден");

    // Перенос не меняет общий резерв/остаток (qty и productId те же),
    // поэтому доп.проверка наличия не нужна.
    st.itemUpdateOrder.run(toOrderId, itemId);
    return getOrderWithItems(toOrderId);
  });

  function moveItem(itemId, { toOrderId }) {
    if (!toOrderId || typeof toOrderId !== "string") throw new HttpError(400, "toOrderId обязателен");
    return txMoveItem(itemId, toOrderId);
  }

  const txAdvanceDay = db.transaction(() => {
    const currentDate = ensureMeta();

    // 1) Считаем отгрузку по товарам для заказов на текущую дату
    const ship = st.shipSumsForDate.all(currentDate);

    // 2) Списываем со склада
    for (const row of ship) {
      const p = st.productGet.get(row.productId);
      if (!p) continue;
      const newStock = p.stock - row.totalQty;

      // На всякий случай защита (вообще не должно случаться при корректных проверках)
      if (newStock < 0) {
        throw new HttpError(500, "Отрицательный остаток при отгрузке (проверь логику резерва)", {
          productId: row.productId,
          stock: p.stock,
          shipQty: row.totalQty,
        });
      }
      st.productUpdateStock.run(newStock, row.productId);
    }

    // 3) Удаляем заказы текущего дня (позиции удалятся каскадом)
    const ordersToday = st.ordersForDate.all(currentDate);
    st.deleteOrdersForDate.run(currentDate);

    // 4) Приход партий товара: случайное увеличение остатков
    const arrivals = {};
    const products = st.productList.all();
    for (const p of products) {
      const delta = Math.floor(Math.random() * 6); // 0..5
      if (delta > 0) {
        st.productIncStock.run(delta, p.id);
        arrivals[p.id] = delta;
      }
    }

    // 5) Сдвигаем дату
    const newDate = addDaysISO(currentDate, 1);
    st.metaSet.run(newDate);

    // 6) На всякий случай чистим “просрочку” (если кто-то руками в БД напортачил)
    st.deleteExpiredOrders.run(newDate);

    return {
      previousDate: currentDate,
      currentDate: newDate,
      shippedOrdersCount: ordersToday.length,
      shippedProducts: ship,
      arrivals,
    };
  });

  function advanceDay() {
    return txAdvanceDay();
  }

  return {
    HttpError,
    init,
    getCurrentDate: () => ensureMeta(),
    listProducts,
    listOrders,
    getOrderWithItems,
    createOrder,
    updateOrder,
    deleteOrder,
    addItem,
    updateItem,
    deleteItem,
    moveItem,
    advanceDay,
  };
}

module.exports = { openDb, createRepo };
