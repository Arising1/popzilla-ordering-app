const express = require("express");
const path = require("path");
const fs = require("fs");
const Stripe = require("stripe");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const ADMIN_PIN = process.env.ADMIN_PIN || "2019";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL,
      order_data JSONB NOT NULL
    )
  `);

  // Import any existing orders.json once.
  const dataFile = path.join(__dirname, "orders.json");

  if (fs.existsSync(dataFile)) {
    try {
      const orders = JSON.parse(
        fs.readFileSync(dataFile, "utf8")
      );

      for (const order of orders) {
        if (!order.id) continue;

        await pool.query(
          `INSERT INTO orders
           (id, created_at, status, order_data)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [
            order.id,
            order.createdAt || new Date().toISOString(),
            order.status || "New",
            order
          ]
        );
      }
    } catch (err) {
      console.error(
        "orders.json migration skipped:",
        err.message
      );
    }
  }
}

async function readOrders() {
  const result = await pool.query(
    `SELECT order_data
     FROM orders
     ORDER BY created_at DESC`
  );

  return result.rows.map(row => row.order_data);
}

function requireAdmin(req, res, next) {
  if (req.get("x-admin-pin") !== ADMIN_PIN) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

app.get("/api/orders", async (req, res) => {
  try {
    res.json(await readOrders());
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Could not load orders"
    });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const order = {
      id: "PZ-" + Date.now().toString().slice(-8),
      createdAt: new Date().toISOString(),
      status: "New",
      ...req.body
    };

    await pool.query(
      `INSERT INTO orders
       (id, created_at, status, order_data)
       VALUES ($1, $2, $3, $4)`,
      [
        order.id,
        order.createdAt,
        order.status,
        order
      ]
    );

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Could not save order"
    });
  }
});

app.post("/api/admin/login", (req, res) => {
  if ((req.body?.pin || "") !== ADMIN_PIN) {
    return res.status(401).json({
      error: "Invalid PIN"
    });
  }

  res.json({ ok: true });
});

app.get(
  "/api/admin/orders",
  requireAdmin,
  async (req, res) => {
    try {
      res.json(await readOrders());
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Could not load orders"
      });
    }
  }
);

app.patch(
  "/api/orders/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT order_data
         FROM orders
         WHERE id = $1`,
        [req.params.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Order not found"
        });
      }

      const order = result.rows[0].order_data;

      Object.assign(order, req.body);

      await pool.query(
        `UPDATE orders
         SET status = $1,
             order_data = $2
         WHERE id = $3`,
        [
          order.status || "New",
          order,
          req.params.id
        ]
      );

      res.json(order);
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Could not update order"
      });
    }
  }
);

app.post(
  "/api/create-checkout-session",
  async (req, res) => {
    try {
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

      const line_items = (items || []).map(item => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name
          },
          unit_amount:
            Math.round(Number(item.price) * 100)
        },
        quantity: Number(item.qty) || 1
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
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error:
          "Could not create checkout session"
      });
    }
  }
);

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "admin.html"
    )
  );
});

app.use((req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Popzilla app running on port ${PORT}`
      );
    });
  })
  .catch(err => {
    console.error(
      "Database startup failed:",
      err
    );
    process.exit(1);
  });
