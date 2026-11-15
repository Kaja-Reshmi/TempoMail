
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

import { pool, connectDatabase } from "./config/database.js";
import { redisConnection } from "./config/redis.js";

import authRoutes from "./routes/authRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

const WORKER_HEARTBEAT_KEY = "tempomail:worker:heartbeat";

// Allowed frontend addresses
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://tempo-mail-dun.vercel.app",
  ...(process.env.CLIENT_URL || "").split(","),
  ...(process.env.CLIENT_URLS || "").split(","),
]
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests without an Origin header (health checks, server requests)
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = origin.replace(/\/$/, "");

    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    console.error("CORS blocked origin:", origin);
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

// Apply CORS before API routes so preflight requests are handled
app.use(cors(corsOptions));

// Request middleware
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);

// Welcome route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to TempoMail API",
    version: "1.0.0",
  });
});

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    const redisStatus = await redisConnection.ping();

    if (redisStatus !== "PONG") {
      throw new Error("Redis connection failed");
    }

    const heartbeat = await redisConnection.get(
      WORKER_HEARTBEAT_KEY
    );

    const workerOnline = Boolean(heartbeat);

    res.status(200).json({
      success: true,
      message: "TempoMail health check completed",
      services: {
        api: "running",
        database: "connected",
        redis: "connected",
        worker: workerOnline ? "online" : "offline",
      },
      worker: {
        status: workerOnline ? "online" : "offline",
        lastHeartbeat: heartbeat
          ? new Date(Number(heartbeat)).toISOString()
          : null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    res.status(503).json({
      success: false,
      message: "A service is unavailable",
    });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (error.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Frontend origin is not allowed",
    });
  }

  res.status(error.status || 500).json({
    success: false,
    message: "Internal server error",
  });
});

// Start server
async function startServer() {
  try {
    console.log("Starting TempoMail...");

    await connectDatabase();
    console.log("PostgreSQL connection verified");

    const redisStatus = await redisConnection.ping();

    if (redisStatus !== "PONG") {
      throw new Error("Redis health check failed");
    }

    console.log("Redis connection verified");

    console.log("Allowed frontend origins:", allowedOrigins);

    const server = app.listen(PORT, () => {
      console.log(`TempoMail API running on port ${PORT}`);
    });

    // Graceful shutdown
    async function shutdown(signal) {
      console.log(`${signal} received. Shutting down...`);

      server.close(async () => {
        try {
          await pool.end();
          await redisConnection.quit();

          console.log("Database and Redis connections closed");
          process.exit(0);
        } catch (error) {
          console.error("Shutdown error:", error);
          process.exit(1);
        }
      });
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("Failed to start TempoMail:", error);

    await Promise.allSettled([
      pool.end(),
      redisConnection.quit(),
    ]);

    process.exit(1);
  }
}

startServer();
