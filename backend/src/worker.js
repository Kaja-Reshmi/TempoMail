
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

// Queue recovery must not prevent the worker from starting.
async function runQueueRecovery(source = "startup") {
  try {
    console.log(`Checking for missing scheduled emails (${source})...`);

    const recoveryResult = await recoverScheduledEmails();

    console.log(
      `Queue recovery completed (${source}). Jobs restored: ${
        recoveryResult.recovered
      }`
    );
  } catch (error) {
    console.error(
      `Queue recovery failed (${source}):`,
      error.message
    );
  }
}

async function startWorker() {
  try {
    console.log("Starting TempoMail background worker...");

    // 1. Verify PostgreSQL
    await connectDatabase();
    console.log("Worker database connection verified");

    // 2. Verify Redis
    const redisStatus = await redisConnection.ping();

    if (redisStatus !== "PONG") {
      throw new Error("Redis connection failed");
    }

    console.log("Worker Redis connection verified");

    // 3. Verify email delivery service
    await verifyEmailConnection();
    console.log("Email delivery connection verified");

    // 4. Publish heartbeat immediately after successful verification
    await publishWorkerHeartbeat();

    heartbeatInterval = setInterval(() => {
      publishWorkerHeartbeat();
    }, HEARTBEAT_INTERVAL);

    console.log("Worker heartbeat enabled (every 5 seconds)");

    // 5. Start periodic queue recovery
    recoveryInterval = setInterval(() => {
      if (!shuttingDown) {
        runQueueRecovery("periodic");
      }
    }, RECOVERY_INTERVAL);

    console.log("Automatic queue recovery enabled (every 30 seconds)");

    // 6. Run initial recovery without blocking worker availability
    runQueueRecovery("startup");

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
