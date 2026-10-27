const express = require("express");
const cors = require("cors");
const supabase = require("./config/supabase");
require("dotenv").config();

const db = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const cartRoutes = require("./routes/cartRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const mainRoutes = require("./routes/index");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Konfigurasi CORS
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://frontend-kamu.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.get("/200", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc("version");
    if (error) throw error;
    res.status(200).send("OK");
  } catch (err) {
    res.status(500).send("Database Error");
  }
});

app.use("/api/auth", authRoutes);

// Orders
app.use("/api/orders", orderRoutes);

// Cart
app.use("/api/cart", cartRoutes);

app.use("/api", paymentRoutes);
app.use("/api", mainRoutes);

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
