// api.js
const path = require("path");
const express = require("express");
const { openDb, createRepo } = require("./db");

const PORT = process.env.PORT || 3000;

const db = openDb("warehouse.db");
const repo = createRepo(db);
repo.init();

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function ok(res, data) {
  res.json(data);
}

function handleError(res, err) {
  if (err && typeof err.status === "number") {
    res.status(err.status).json({ error: err.message, details: err.details ?? null });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
}

app.get("/api/meta", (req, res) => {
  try {
    ok(res, { currentDate: repo.getCurrentDate() });
  } catch (e) {
    handleError(res, e);
  }
});

app.post("/api/meta/advance-day", (req, res) => {
  try {
    ok(res, repo.advanceDay());
  } catch (e) {
    handleError(res, e);
  }
});

app.get("/api/products", (req, res) => {
  try {
    ok(res, repo.listProducts());
  } catch (e) {
    handleError(res, e);
  }
});

app.get("/api/orders", (req, res) => {
  try {
    ok(res, repo.listOrders());
  } catch (e) {
    handleError(res, e);
  }
});

app.get("/api/orders/:id", (req, res) => {
  try {
    ok(res, repo.getOrderWithItems(req.params.id));
  } catch (e) {
    handleError(res, e);
  }
});

app.post("/api/orders", (req, res) => {
  try {
    ok(res, repo.createOrder(req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.put("/api/orders/:id", (req, res) => {
  try {
    ok(res, repo.updateOrder(req.params.id, req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.delete("/api/orders/:id", (req, res) => {
  try {
    ok(res, repo.deleteOrder(req.params.id));
  } catch (e) {
    handleError(res, e);
  }
});

app.post("/api/orders/:id/items", (req, res) => {
  try {
    ok(res, repo.addItem(req.params.id, req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.put("/api/orders/:id/items/:itemId", (req, res) => {
  try {
    ok(res, repo.updateItem(req.params.id, req.params.itemId, req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.delete("/api/orders/:id/items/:itemId", (req, res) => {
  try {
    ok(res, repo.deleteItem(req.params.id, req.params.itemId));
  } catch (e) {
    handleError(res, e);
  }
});

app.post("/api/order-items/:itemId/move", (req, res) => {
  try {
    ok(res, repo.moveItem(req.params.itemId, req.body));
  } catch (e) {
    handleError(res, e);
  }
});

app.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
