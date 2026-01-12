// api.js
const path = require("path");
const express = require("express");
const { openDb, createRepo } = require("./db");

const PORT = process.env.PORT || 3000;

// всегда один и тот же файл рядом с api.js
const DB_PATH = path.resolve(__dirname, "warehouse.db");
console.log("DB PATH =", DB_PATH);

const db = openDb(DB_PATH);
const repo = createRepo(db);
repo.init();

const app = express();
app.use(express.json());

// анти-кэш для API
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// UI
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function handleError(res, err) {
  if (err && typeof err.status === "number") {
    res.status(err.status).json({ error: err.message, details: err.details ?? null });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
}

// META
app.get("/api/meta", (req, res) => {
  try {
    res.json({ currentDate: repo.getCurrentDate() });
  } catch (e) {
    handleError(res, e);
  }
});

app.post("/api/meta/advance-day", (req, res) => {
  try {
    res.json(repo.advanceDay());
  } catch (e) {
    handleError(res, e);
  }
});

app.post("/api/meta/reset-today", (req, res) => {
  try {
    res.json(repo.resetToToday());
  } catch (e) {
    handleError(res, e);
  }
});

// PRODUCTS
app.get("/api/products", (req, res) => {
  try {
    res.json(repo.listProducts());
  } catch (e) {
    handleError(res, e);
  }
});

// ORDERS
app.get("/api/orders", (req, res) => {
  try {
    res.json(repo.listOrders());
  } catch (e) {
    handleError(res, e);
  }
});

app.get("/api/orders/:id", (req, res) => {
  try {
    res.json(repo.getOrderWithItems(req.params.id));
  } catch (e) {
    handleError(res, e);
  }
});

app.post("/api/orders", (req, res) => {
  try {
    res.json(repo.createOrder(req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.put("/api/orders/:id", (req, res) => {
  try {
    res.json(repo.updateOrder(req.params.id, req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.delete("/api/orders/:id", (req, res) => {
  try {
    res.json(repo.deleteOrder(req.params.id));
  } catch (e) {
    handleError(res, e);
  }
});

// ITEMS
app.post("/api/orders/:id/items", (req, res) => {
  try {
    res.json(repo.addItem(req.params.id, req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.put("/api/orders/:id/items/:itemId", (req, res) => {
  try {
    res.json(repo.updateItem(req.params.id, req.params.itemId, req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.delete("/api/orders/:id/items/:itemId", (req, res) => {
  try {
    res.json(repo.deleteItem(req.params.id, req.params.itemId));
  } catch (e) {
    handleError(res, e);
  }
});

// MOVE ITEM
app.post("/api/order-items/:itemId/move", (req, res) => {
  try {
    res.json(repo.moveItem(req.params.itemId, req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
