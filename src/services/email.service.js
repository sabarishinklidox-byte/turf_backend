import nodemailer from "nodemailer";
import { logger } from "../config/logger.js";

let transporter;

const smtpReady = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.MAIL_FROM);

const getTransporter = () => {
  if (!smtpReady()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  const mailer = getTransporter();
  if (!mailer) {
    logger.info({ to, subject }, "Email skipped because SMTP is not configured");
    return { skipped: true };
  }

  return mailer.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    text,
    html,
  });
};
