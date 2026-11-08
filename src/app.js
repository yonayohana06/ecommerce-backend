require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { validateEnv } = require("./config/env");

validateEnv(process.env, { requireDatabase: false });

const db = require("./config/db");
const { logger } = require("./utils/logger");
const { createRequestLogger } = require("./middlewares/requestLogger");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const cartRoutes = require("./routes/cartRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const mainRoutes = require("./routes/index");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(createRequestLogger({ logger }));
app.use(helmet());
app.use(express.json());

// Konfigurasi CORS
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
      "https://fastshop-id.vercel.app",
      "https://admin-fastshop.netlify.app",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-Request-Id"],
    credentials: true,
  }),
);

const healthCheck = (req, res) => {
  res.status(200).json({ status: "ok" });
};

// Liveness: proses hidup, tidak menyentuh database.
app.get("/health", healthCheck);
// Alias lama agar client/monitoring yang sudah memakai /200 tetap bekerja.
app.get("/200", healthCheck);

// Readiness: pastikan database utama bisa diakses sebelum menerima traffic.
app.get("/ready", async (req, res) => {
  try {
    await db.query("SELECT 1");
    return res.status(200).json({ status: "ready" });
  } catch (error) {
    const log = req.log || logger;
    log.error({
      msg: "readiness_failed",
      requestId: req.id,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
    return res.status(503).json({
      code: 503,
      message: "Database belum siap.",
    });
  }
});

app.use("/api/auth", authRoutes);

// Orders
app.use("/api/orders", orderRoutes);

// Cart
app.use("/api/cart", cartRoutes);

app.use("/api", paymentRoutes);
app.use("/api", mainRoutes);

// Route tidak dikenal dan error tak tertangani selalu dikembalikan sebagai JSON.
app.use(notFound);
app.use(errorHandler);

// Aplikasi Express murni: listener dan koneksi awal dijalankan oleh src/server.js.
module.exports = app;
