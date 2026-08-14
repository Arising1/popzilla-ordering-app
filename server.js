const express = require("express");
const path = require("path");
const fs = require("fs");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA = path.join(__dirname, "orders.json");
const PRODUCTS = path.join(__dirname, "products.json");

const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const ADMIN_PIN = process.env.ADMIN_PIN || "2019";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==================== ORDERS ====================

function readOrders() {
  try {
    return JSON.parse(
      fs.readFileSync(DATA, "utf8")
    );
  } catch {
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(orders, null, 2)
  );
}

// ==================== PRODUCTS ====================

function readProducts() {
  try {
    return JSON.parse(
      fs.readFileSync(PRODUCTS, "utf8")
    );
  } catch {
    return [];
  }
}

function writeProducts(products) {
  fs.writeFileSync(
    PRODUCTS,
    JSON.stringify(products, null, 2)
  );
}

// ==================== ADMIN SECURITY ====================

function requireAdmin(req, res, next) {
  if (req.get("x-admin-pin") !== ADMIN_PIN) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

// ==================== ORDERS API ====================

app.get("/api/orders", (req, res) => {
  res.json(readOrders());
});

app.post("/api/orders", (req, res) => {
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

app.post("/api/admin/login", (req, res) => {
  if ((req.body?.pin || "") !== ADMIN_PIN) {
    return res.status(401).json({
      error: "Invalid PIN"
    });
  }

  res.json({
    ok: true
  });
});

app.get(
  "/api/admin/orders",
  requireAdmin,
  (req, res) => {
    res.json(readOrders());
  }
);

app.patch(
  "/api/orders/:id",
  requireAdmin,
  (req, res) => {
    const orders = readOrders();

    const item = orders.find(
      o => o.id === req.params.id
    );

    if (!item) {
      return res.status(404).json({
        error: "Order not found"
      });
    }

    Object.assign(item, req.body);

    writeOrders(orders);

    res.json(item);
  }
);

// ==================== PRODUCTS API ====================

// Get all products
app.get(
  "/api/admin/products",
  requireAdmin,
  (req, res) => {
    res.json(readProducts());
  }
);

// Add a product
app.post(
  "/api/admin/products",
  requireAdmin,
  (req, res) => {
    const products = readProducts();

    const product = {
      id:
        "product-" +
        Date.now().toString(),
      name:
        String(req.body.name || "").trim(),
      price:
        Number(req.body.price) || 0,
      category:
        String(req.body.category || "other"),
      active:
        req.body.active !== false
    };

    if (!product.name) {
      return res.status(400).json({
        error: "Product name is required"
      });
    }

    products.push(product);

    writeProducts(products);

    res.json(product);
  }
);

// Edit a product
app.patch(
  "/api/admin/products/:id",
  requireAdmin,
  (req, res) => {
    const products = readProducts();

    const product = products.find(
      p => p.id === req.params.id
    );

    if (!product) {
      return res.status(404).json({
        error: "Product not found"
      });
    }

    if (req.body.name !== undefined) {
      product.name =
        String(req.body.name).trim();
    }

    if (req.body.price !== undefined) {
      product.price =
        Number(req.body.price);
    }

    if (req.body.category !== undefined) {
      product.category =
        String(req.body.category);
    }

    if (req.body.active !== undefined) {
      product.active =
        Boolean(req.body.active);
    }

    writeProducts(products);

    res.json(product);
  }
);

// Delete a product
app.delete(
  "/api/admin/products/:id",
  requireAdmin,
  (req, res) => {
    const products = readProducts();

    const remaining =
      products.filter(
        p => p.id !== req.params.id
      );

    if (
      remaining.length === products.length
    ) {
      return res.status(404).json({
        error: "Product not found"
      });
    }

    writeProducts(remaining);

    res.json({
      ok: true
    });
  }
);

// ==================== STRIPE ====================

app.post(
  "/api/create-checkout-session",
  async (req, res) => {
    if (!stripe) {
      return res.status(503).json({
        error:
          "Stripe is not configured yet. Add STRIPE_SECRET_KEY on the server."
      });
    }

    const {
      items,
      customer,
      fulfillment
    } = req.body;

    const line_items =
      (items || []).map(i => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: i.name
          },
          unit_amount:
            Math.round(
              Number(i.price) * 100
            )
        },
        quantity:
          Number(i.qty) || 1
      }));

    if (
      fulfillment?.method === "delivery" &&
      Number(fulfillment.fee) > 0
    ) {
      line_items.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Local Delivery"
          },
          unit_amount:
            Math.round(
              Number(fulfillment.fee) * 100
            )
        },
        quantity: 1
      });
    }

    const baseUrl =
      process.env.PUBLIC_URL ||
      `http://localhost:${PORT}`;

    const session =
      await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        customer_email:
          customer?.email || undefined,
        success_url:
          `${baseUrl}/?paid=1`,
        cancel_url:
          `${baseUrl}/?cancelled=1`,
        metadata: {
          customerName:
            customer?.name || "",
          phone:
            customer?.phone || ""
        }
      });

    res.json({
      url: session.url
    });
  }
);

// ==================== ADMIN PAGE ====================

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "admin.html"
    )
  );
});

// ==================== CUSTOMER STORE ====================

app.use((req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(
    `Popzilla app running on port ${PORT}`
  );
});
