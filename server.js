const express = require("express");
const path = require("path");
const fs = require("fs");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "orders.json");
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function readOrders() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return []; }
}
function writeOrders(orders) {
  fs.writeFileSync(DATA, JSON.stringify(orders, null, 2));
}

app.get("/api/orders", (req,res) => res.json(readOrders()));

app.post("/api/orders", (req,res) => {
  const order = {
    id: "PZ-" + Date.now().toString().slice(-8),
    createdAt: new Date().toISOString(),
    status: "New",
    ...req.body
  };
  const orders = readOrders();
  orders.unshift(order);
  writeOrders(orders);
  res.json(order);
});

app.patch("/api/orders/:id", (req,res) => {
  const orders = readOrders();
  const item = orders.find(o => o.id === req.params.id);
  if (!item) return res.status(404).json({error:"Order not found"});
  Object.assign(item, req.body);
  writeOrders(orders);
  res.json(item);
});

app.post("/api/create-checkout-session", async (req,res) => {
  if (!stripe) return res.status(503).json({error:"Stripe is not configured yet. Add STRIPE_SECRET_KEY on the server."});
  const {items, customer, fulfillment} = req.body;
  const line_items = (items || []).map(i => ({
    price_data: {
      currency: "usd",
      product_data: {name: i.name},
      unit_amount: Math.round(Number(i.price) * 100)
    },
    quantity: Number(i.qty) || 1
  }));
  if (fulfillment?.method === "delivery" && Number(fulfillment.fee) > 0) {
    line_items.push({
      price_data: {
        currency: "usd",
        product_data: {name: "Local Delivery"},
        unit_amount: Math.round(Number(fulfillment.fee) * 100)
      },
      quantity: 1
    });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    customer_email: customer?.email || undefined,
    success_url: `${process.env.PUBLIC_URL || "http://localhost:"+PORT}/?paid=1`,
    cancel_url: `${process.env.PUBLIC_URL || "http://localhost:"+PORT}/?cancelled=1`,
    metadata: { customerName: customer?.name || "", phone: customer?.phone || "" }
  });
  res.json({url: session.url});
});

app.use((req,res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Popzilla app running on http://localhost:${PORT}`));
