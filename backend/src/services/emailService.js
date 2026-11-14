
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT || 587),
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verify SMTP connection
export async function verifyEmailConnection() {
  try {
    await transporter.verify();

    console.log("Email SMTP connection verified successfully");

    return true;
  } catch (error) {
    console.error("Email SMTP connection failed:", error.message);
    throw error;
  }
}

// Send email with optional failure simulation for retry testing
export async function sendEmail({
  to,
  subject,
  text,
  html,
}) {
  // TEMPORARY TEST:
  // Only emails containing [RETRY-TEST] will fail.
  if (
    process.env.SIMULATE_EMAIL_FAILURE === "true" &&
    subject.includes("[RETRY-TEST]")
  ) {
    console.error("TEST MODE: Simulating email delivery failure");

    throw new Error(
      "TEST FAILURE: Simulated SMTP delivery error"
    );
  }

  try {
    const result = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });

    console.log("Email sent successfully:", result.messageId);

    return {
      messageId: result.messageId,
      previewUrl: nodemailer.getTestMessageUrl(result),
    };
  } catch (error) {
    console.error("Email delivery failed:", error.message);
    throw error;
  }
}
