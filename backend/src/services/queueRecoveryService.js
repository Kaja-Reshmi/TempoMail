
import { pool } from "../config/database.js";
import { emailQueue } from "../queues/emailQueue.js";

let recoveryRunning = false;

export async function recoverScheduledEmails() {
  if (recoveryRunning) {
    return { recovered: 0, skipped: true };
  }

  recoveryRunning = true;

  let recovered = 0;
  let skipped = 0;

  try {
    const result = await pool.query(
      `SELECT id, scheduled_at, status
       FROM emails
       WHERE status IN ('scheduled', 'queued')
       ORDER BY scheduled_at ASC`
    );

    for (const email of result.rows) {
      const existingJob = await emailQueue.getJob(email.id);

      if (existingJob) {
        const state = await existingJob.getState();

        // Keep jobs that are still waiting to be processed.
        if (
          ["waiting", "delayed", "active", "waiting-children", "prioritized"].includes(state)
        ) {
          skipped++;
          continue;
        }

        // Remove stale completed or failed jobs so they
        // can be recreated from the database record.
        if (["completed", "failed"].includes(state)) {
          await existingJob.remove();
        }
      }

      const delay = Math.max(
        0,
        new Date(email.scheduled_at).getTime() - Date.now()
      );

      await emailQueue.add(
        "send-email",
        { emailId: email.id },
        {
          jobId: email.id,
          delay,
        }
      );

      await pool.query(
        `UPDATE emails
         SET queue_job_id = $1,
             last_error = NULL
         WHERE id = $2
           AND status IN ('scheduled', 'queued')`,
        [email.id, email.id]
      );

      recovered++;

      console.log(`Recovered scheduled email: ${email.id}`);
    }

    if (recovered > 0 || skipped > 0) {
      console.log(
        `Queue recovery finished. Restored: ${recovered}, already active: ${skipped}`
      );
    }

    return {
      recovered,
      skipped: false,
      alreadyActive: skipped,
    };
  } finally {
    recoveryRunning = false;
  }
}
