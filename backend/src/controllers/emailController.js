
import { z } from "zod";
import { pool } from "../config/database.js";
import { emailQueue } from "../queues/emailQueue.js";

const createEmailSchema = z.object({
  toEmail: z.string().trim().email("Enter a valid recipient email"),
  subject: z.string().trim().min(1, "Subject is required").max(255),
  bodyText: z.string().trim().min(1, "Email message is required"),
  bodyHtml: z.string().optional(),
  scheduledAt: z.string().datetime({
    offset: true,
    message: "Provide a valid scheduled date and time",
  }),
});

// CREATE AND SCHEDULE EMAIL
export async function createEmail(req, res) {
  try {
    const validation = createEmailSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid email details",
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { toEmail, subject, bodyText, bodyHtml, scheduledAt } =
      validation.data;

    const scheduledDate = new Date(scheduledAt);

    if (scheduledDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Scheduled delivery must be in the future",
      });
    }

    // Save email in PostgreSQL first
    const result = await pool.query(
      `INSERT INTO emails
        (user_id, to_email, subject, body_text, body_html, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
       RETURNING
         id,
         to_email,
         subject,
         body_text,
         scheduled_at,
         status,
         created_at`,
      [
        req.user.id,
        toEmail,
        subject,
        bodyText,
        bodyHtml || null,
        scheduledDate,
      ]
    );

    const email = result.rows[0];

    // Calculate BullMQ delay
    const delay = Math.max(
      0,
      scheduledDate.getTime() - Date.now()
    );

    try {
      // Add the email to the delivery queue
      await emailQueue.add(
        "send-email",
        { emailId: email.id },
        {
          jobId: email.id,
          delay,
        }
      );

      // Save queue job ID
      await pool.query(
        `UPDATE emails
         SET queue_job_id = $1
         WHERE id = $2`,
        [email.id, email.id]
      );

      return res.status(201).json({
        success: true,
        message: "Email scheduled and added to delivery queue",
        email: {
          ...email,
          queue_job_id: email.id,
        },
        queue: {
          jobId: email.id,
          delayMilliseconds: delay,
        },
      });
    } catch (queueError) {
      console.error("Failed to add email to queue:", queueError);

      // Keep the email recoverable instead of marking it failed.
      await pool.query(
        `UPDATE emails
         SET last_error = $1
         WHERE id = $2`,
        [queueError.message, email.id]
      );

      return res.status(202).json({
        success: true,
        message:
          "Email was saved successfully. Delivery queue recovery will retry scheduling it.",
        email: {
          ...email,
          queue_job_id: null,
        },
        queue: {
          jobId: null,
          delayMilliseconds: delay,
          recoveryPending: true,
        },
      });
    }
  } catch (error) {
    console.error("Create email error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to schedule email",
    });
  }
}

// GET EMAILS WITH FILTERING AND PAGINATION
export async function getEmails(req, res) {
  try {
    const status = req.query.status;

    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(
        1,
        Number.parseInt(req.query.limit, 10) || 10
      )
    );

    const allowedStatuses = [
      "draft",
      "scheduled",
      "queued",
      "processing",
      "sent",
      "failed",
      "cancelled",
    ];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email status filter",
      });
    }

    const offset = (page - 1) * limit;

    const conditions = ["user_id = $1"];
    const values = [req.user.id];

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM emails
       WHERE ${whereClause}`,
      values
    );

    const total = countResult.rows[0].total;

    const emailResult = await pool.query(
      `SELECT
         id,
         to_email,
         subject,
         body_text,
         scheduled_at,
         status,
         attempts,
         last_error,
         sent_at,
         failed_at,
         created_at
       FROM emails
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    return res.status(200).json({
      success: true,
      emails: emailResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get emails error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve emails",
    });
  }
}

// GET DASHBOARD STATISTICS
export async function getEmailStats(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE status IN ('scheduled', 'queued')
         )::int AS scheduled,
         COUNT(*) FILTER (
           WHERE status = 'sent'
         )::int AS sent,
         COUNT(*) FILTER (
           WHERE status = 'failed'
         )::int AS failed,
         COUNT(*) FILTER (
           WHERE status = 'processing'
         )::int AS processing
       FROM emails
       WHERE user_id = $1`,
      [req.user.id]
    );

    return res.status(200).json({
      success: true,
      stats: result.rows[0],
    });
  } catch (error) {
    console.error("Email stats error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve email statistics",
    });
  }
}

// GET BULLMQ QUEUE STATUS
export async function getQueueStatus(req, res) {
  try {
    const counts = await emailQueue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "completed",
      "failed",
      "paused"
    );

    return res.status(200).json({
      success: true,
      queue: counts,
    });
  } catch (error) {
    console.error("Queue status error:", error);

    return res.status(503).json({
      success: false,
      message: "Unable to retrieve queue status",
    });
  }
}
