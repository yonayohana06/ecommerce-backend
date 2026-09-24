const express = require("express");
require("dotenv").config();

const db = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// app.get("/test", (req, res) => res.status(200).send("OK"));

app.use("/api/auth", authRoutes);

// Orders
app.use("/api/orders", orderRoutes);

// Product
app.use("/api/products", productRoutes);

// Product
app.use("/api/cart", cartRoutes);

app.use("/api", paymentRoutes);

// Fungsi untuk cek database sebelum server menerima traffic
const startServer = async () => {
  try {
    // Eksekusi query ringan untuk tes koneksi
    const res = await db.query("SELECT NOW()");
    console.log("✅ PostgreSQL Connected successfully at:", res.rows[0].now);

    // Nyalakan HTTP server setelah database siap
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Database connection failed!");
    console.error("Error detail:", err.message);
    process.exit(1);
  }
};

startServer();

module.exports = app;
