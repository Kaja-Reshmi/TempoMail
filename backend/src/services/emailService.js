import nodemailer from "nodemailer";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const transporter = !resend
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  : null;

export async function verifyEmailConnection() {
  if (resend) {
    console.log("Resend email service configured successfully");
    return true;
  }

  await transporter.verify();
  console.log("Email SMTP connection verified successfully");
  return true;
}

export async function sendEmail({ to, subject, text, html }) {
  if (
    process.env.SIMULATE_EMAIL_FAILURE === "true" &&
    subject.includes("[RETRY-TEST]")
  ) {
    throw new Error("Simulated email failure for retry testing");
  }

  if (resend) {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "TempoMail <onboarding@resend.dev>",
      to: [to],
      subject,
      text,
      html,
    });

    if (error) throw new Error(error.message);

    return { messageId: data.id, previewUrl: null };
  }

  const result = await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  return {
    messageId: result.messageId,
    previewUrl: nodemailer.getTestMessageUrl(result),
  };
}
