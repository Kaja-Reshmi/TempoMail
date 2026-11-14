
import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

const maxAttempts = Number(process.env.EMAIL_MAX_ATTEMPTS || 3);
const retryDelay = Number(process.env.EMAIL_RETRY_DELAY_MS || 5000);

export const emailQueue = new Queue("email-delivery", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: maxAttempts,
    backoff: {
      type: "exponential",
      delay: retryDelay,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1000,
    },
    removeOnFail: false,
  },
});

emailQueue.on("error", (error) => {
  console.error("Email queue error:", error);
});

console.log("Email delivery queue initialized");
