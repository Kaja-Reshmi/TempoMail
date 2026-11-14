
import dotenv from "dotenv";

import { pool, connectDatabase } from "./config/database.js";
import { redisConnection } from "./config/redis.js";
import { verifyEmailConnection } from "./services/emailService.js";
import { recoverScheduledEmails } from "./services/queueRecoveryService.js";
import { emailWorker } from "./workers/emailWorker.js";

dotenv.config();

const RECOVERY_INTERVAL = 30 * 1000;

const WORKER_HEARTBEAT_KEY = "tempomail:worker:heartbeat";
const HEARTBEAT_INTERVAL = 5 * 1000;
const HEARTBEAT_TTL = 20;

let recoveryInterval = null;
let heartbeatInterval = null;
let shuttingDown = false;

// Publish worker heartbeat to Redis
async function publishWorkerHeartbeat() {
  try {
    await redisConnection.set(
      WORKER_HEARTBEAT_KEY,
      Date.now().toString(),
      "EX",
      HEARTBEAT_TTL
    );
  } catch (error) {
    console.error("Worker heartbeat failed:", error.message);
  }
}

async function startWorker() {
  try {
    console.log("Starting TempoMail background worker...");

    // Verify PostgreSQL
    await connectDatabase();
    console.log("Worker database connection verified");

    // Verify Redis
    const redisStatus = await redisConnection.ping();

    if (redisStatus !== "PONG") {
      throw new Error("Redis connection failed");
    }

    console.log("Worker Redis connection verified");

    // Verify SMTP connection
    await verifyEmailConnection();
    console.log("SMTP connection verified");

    // Recover missing scheduled jobs
    console.log("Checking for missing scheduled emails...");

    const recoveryResult = await recoverScheduledEmails();

    console.log(
      `Startup recovery finished. Jobs restored: ${recoveryResult.recovered}`
    );

    // Repeat queue recovery every 30 seconds
    recoveryInterval = setInterval(async () => {
      try {
        const result = await recoverScheduledEmails();

        if (result.recovered > 0) {
          console.log(
            `Periodic recovery restored ${result.recovered} job(s)`
          );
        }
      } catch (error) {
        console.error(
          "Periodic queue recovery failed:",
          error.message
        );
      }
    }, RECOVERY_INTERVAL);

    console.log("Automatic queue recovery enabled (every 30 seconds)");

    // Publish initial heartbeat
    await publishWorkerHeartbeat();

    // Refresh heartbeat every 5 seconds
    heartbeatInterval = setInterval(() => {
      publishWorkerHeartbeat();
    }, HEARTBEAT_INTERVAL);

    console.log("Worker heartbeat enabled (every 5 seconds)");
    console.log("TempoMail background worker is ready!");
  } catch (error) {
    console.error("Worker startup failed:", error);

    if (recoveryInterval) {
      clearInterval(recoveryInterval);
      recoveryInterval = null;
    }

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    await redisConnection
      .del(WORKER_HEARTBEAT_KEY)
      .catch(() => {});

    await emailWorker.close().catch(() => {});
    await pool.end().catch(() => {});
    await redisConnection.quit().catch(() => {});

    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(`${signal} received. Closing worker...`);

  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  try {
    await emailWorker.close();

    // Remove heartbeat when worker shuts down normally
    await redisConnection.del(WORKER_HEARTBEAT_KEY);

    await pool.end();
    await redisConnection.quit();

    console.log("Worker connections closed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Worker shutdown error:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startWorker();
