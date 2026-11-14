
import { Worker } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { pool } from "../config/database.js";
import { sendEmail } from "../services/emailService.js";

const concurrency = Math.max(
  1,
  Number(process.env.EMAIL_WORKER_CONCURRENCY || 5)
);

const rateLimitMax = Math.max(
  1,
  Number(process.env.EMAIL_RATE_LIMIT_MAX || 10)
);

const rateLimitDuration = Math.max(
  1,
  Number(process.env.EMAIL_RATE_LIMIT_DURATION_MS || 1000)
);

export const emailWorker = new Worker(
  "email-delivery",
  async (job) => {
    const { emailId } = job.data;

    console.log(`Processing email: ${emailId}`);

    const result = await pool.query(
      `SELECT id, to_email, subject, body_text, body_html, status
       FROM emails
       WHERE id = $1`,
      [emailId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Email ${emailId} was not found`);
    }

    const email = result.rows[0];

    // Avoid sending an email that has already been delivered.
    if (email.status === "sent") {
      console.log(`Email ${emailId} was already sent. Skipping.`);
      return {
        success: true,
        message: "Email already sent",
      };
    }

    await pool.query(
      `UPDATE emails
       SET status = 'processing'
       WHERE id = $1`,
      [emailId]
    );

    await pool.query(
      `INSERT INTO email_logs (email_id, event_type, details)
       VALUES ($1, $2, $3)`,
      [
        emailId,
        "processing",
        JSON.stringify({ jobId: job.id }),
      ]
    );

    try {
      // Attempt email delivery.
      const delivery = await sendEmail({
        to: email.to_email,
        subject: email.subject,
        text: email.body_text,
        html: email.body_html || undefined,
      });

      // Update email after successful delivery.
      await pool.query(
        `UPDATE emails
         SET status = 'sent',
             provider_message_id = $1,
             sent_at = NOW(),
             last_error = NULL,
             failed_at = NULL,
             attempts = $2
         WHERE id = $3`,
        [delivery.messageId, job.attemptsMade + 1, emailId]
      );

      await pool.query(
        `INSERT INTO email_logs (email_id, event_type, details)
         VALUES ($1, $2, $3)`,
        [
          emailId,
          "sent",
          JSON.stringify({
            messageId: delivery.messageId,
            previewUrl: delivery.previewUrl,
          }),
        ]
      );

      console.log(`Email ${emailId} sent successfully`);

      return {
        success: true,
        emailId,
        messageId: delivery.messageId,
        previewUrl: delivery.previewUrl,
      };
    } catch (error) {
      const maxAttempts = Number(job.opts.attempts || 1);
      const currentAttempt = job.attemptsMade + 1;
      const finalAttempt = currentAttempt >= maxAttempts;

      console.error(
        `Email ${emailId} delivery failed. Attempt ${currentAttempt}/${maxAttempts}: ${error.message}`
      );

      // Update the email record.
      await pool.query(
        `UPDATE emails
         SET status = $1,
             last_error = $2,
             failed_at = CASE WHEN $5::boolean THEN NOW() ELSE NULL END,
             attempts = $3
         WHERE id = $4`,
        [
          finalAttempt ? "failed" : "queued",
          error.message,
          currentAttempt,
          emailId,
          finalAttempt,
        ]
      );

      // Record the retry or final failure.
      await pool.query(
        `INSERT INTO email_logs (email_id, event_type, details)
         VALUES ($1, $2, $3)`,
        [
          emailId,
          finalAttempt ? "failed" : "retry",
          JSON.stringify({
            error: error.message,
            attempt: currentAttempt,
            maxAttempts,
            finalAttempt,
          }),
        ]
      );

      if (finalAttempt) {
        console.error(
          `Email ${emailId} permanently failed after ${maxAttempts} attempts`
        );
      } else {
        console.log(
          `Email ${emailId} will be retried. Attempt ${currentAttempt}/${maxAttempts}`
        );
      }

      // Throwing the error allows BullMQ to execute its retry mechanism.
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency,
    limiter: {
      max: rateLimitMax,
      duration: rateLimitDuration,
    },
  }
);

// Successful jobs
emailWorker.on("completed", (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

// Failed attempts and exhausted jobs
emailWorker.on("failed", (job, error) => {
  console.error(
    `Job ${job?.id} failed: ${error.message}`
  );

  if (job) {
    console.log(
      `Attempts made: ${job.attemptsMade}/${job.opts.attempts || 1}`
    );
  }
});

// Worker-level errors
emailWorker.on("error", (error) => {
  console.error("Email worker error:", error);
});

console.log(
  `TempoMail worker initialized (concurrency: ${concurrency}, rate: ${rateLimitMax}/${rateLimitDuration}ms)`
);
