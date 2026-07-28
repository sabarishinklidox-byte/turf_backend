import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { sendEmail } from "./email.service.js";
import { AppError } from "../utils/app-error.js";
import {
  createRazorpayRefund,
  createRazorpayXContact,
  createRazorpayXFundAccount,
  createRazorpayXPayout,
  getActiveBookingAutomationConfig,
  verifyRazorpayWebhookSignature,
} from "./payment-gateway.service.js";
import { syncBookingPayoutWebhook, syncBookingRefundWebhook } from "./booking-payment-automation.service.js";
import { syncTournamentEntryPayoutWebhook, syncTournamentEntryRefundWebhook } from "./tournament.service.js";
import { deriveOpenMatchStatus, serializeOpenMatchFinancials } from "./user.service.js";

const appBaseUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173").trim();

const formatDateTimeForEmail = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));

const formatCurrencyInr = (amount = 0) => `Rs. ${Number(amount ?? 0).toLocaleString("en-IN")}`;

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const sendOpenMatchRefundEmail = async (match, participant, refundAmount) => {
  if (!participant?.user?.email || !match) return;
  const userName = [participant.user.firstName, participant.user.lastName].filter(Boolean).join(" ").trim() || participant.user.email;
  const venueLine = [match.turf?.name, match.turf?.city, match.turf?.state].filter(Boolean).join(", ");
  const timeLine = match.sessionStartAt ? formatDateTimeForEmail(match.sessionStartAt) : "Start time not set";
  const link = `${appBaseUrl.replace(/\/$/, "")}/user/join-play`;

  try {
    await sendEmail({
      to: participant.user.email,
      subject: `Refund update for your host match spot: ${match.title}`,
      text: `Hi ${userName},\n\nYour host match refund has been processed.\n\nMatch: ${match.title}\nVenue: ${venueLine || "PlayArena venue"}\nStart: ${timeLine}\nRefund amount: ${formatCurrencyInr(refundAmount)}\n\nOpen Join & Play:\n${link}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(userName)},</p>
          <h2 style="margin:0 0 12px;">Your host match refund is processed</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(match.title)}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">${escapeHtml(venueLine || "PlayArena venue")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(timeLine)}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Refund details</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">Refund amount: ${escapeHtml(formatCurrencyInr(refundAmount))}</div>
          </div>
          <p style="margin:0 0 18px;">
            <a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Join & Play
            </a>
          </p>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ error, matchId: match.id, participantId: participant.id }, "Open match refund email failed");
  }
};

const sendOpenMatchPayoutEmail = async (match, payoutAmount, payoutStatus) => {
  const ownerEmail = match?.turf?.ownerEmail;
  if (!ownerEmail || !match) return;
  const ownerName = match.turf?.ownerName?.trim() || "turf owner";
  const venueLine = [match.turf?.name, match.turf?.city, match.turf?.state].filter(Boolean).join(", ");
  const timeLine = match.sessionStartAt ? formatDateTimeForEmail(match.sessionStartAt) : "Start time not set";
  const link = `${appBaseUrl.replace(/\/$/, "")}/owner/open-matches`;
  const statusLine =
    payoutStatus === "PROCESSED"
      ? `Payout of ${formatCurrencyInr(payoutAmount)} has been sent to your account.`
      : payoutStatus === "REVERSED"
        ? `Payout of ${formatCurrencyInr(payoutAmount)} was reversed.`
        : `Payout of ${formatCurrencyInr(payoutAmount)} could not be completed yet.`;

  try {
    await sendEmail({
      to: ownerEmail,
      subject: `Host match payout update: ${match.title}`,
      text: `Hi ${ownerName},\n\n${statusLine}\n\nMatch: ${match.title}\nVenue: ${venueLine || "PlayArena venue"}\nStart: ${timeLine}\nPayout status: ${payoutStatus}\n\nOpen host match ledger:\n${link}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(ownerName)},</p>
          <h2 style="margin:0 0 12px;">Host match payout update</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(match.title)}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">${escapeHtml(venueLine || "PlayArena venue")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(timeLine)}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Payout details</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">${escapeHtml(statusLine)}</div>
            <div style="margin-top:4px;font-size:14px;color:#10245e;">Current status: ${escapeHtml(payoutStatus)}</div>
          </div>
          <p style="margin:0 0 18px;">
            <a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Host Match Ledger
            </a>
          </p>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ error, matchId: match.id, email: ownerEmail }, "Open match payout email failed");
  }
};

const automationInclude = {
  turf: true,
  slot: true,
  result: { include: { submissions: true } },
  participants: {
    include: {
      user: true,
      userTeam: true,
      refunds: { orderBy: { requestedAt: "desc" } },
    },
    orderBy: { joinedAt: "asc" },
  },
  payoutRelease: true,
};

const mapRefundStatus = (status) => {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "processed") return "PROCESSED";
  if (normalized === "failed") return "FAILED";
  return "CREATED";
};

const mapPayoutStatus = (status) => {
  switch (String(status ?? "").toLowerCase()) {
    case "processed":
      return "PROCESSED";
    case "queued":
      return "QUEUED";
    case "pending":
      return "PENDING";
    case "reversed":
      return "REVERSED";
    case "rejected":
      return "REJECTED";
    case "failed":
      return "FAILED";
    default:
      return "PROCESSING";
  }
};

const getPayoutContactPayload = (match) => ({
  name: match.turf?.ownerName?.trim() || "Turf owner",
  email: match.turf?.ownerEmail?.trim() || undefined,
  phone: match.turf?.ownerPhone?.trim() || undefined,
  referenceId: `turf-owner-${match.turfId}`,
});

const getPayoutFundAccountPayload = (match) => ({
  payoutMethod: match.turf?.payoutMethod,
  accountHolderName: match.turf?.payoutAccountHolderName?.trim() || match.turf?.ownerName?.trim() || "Turf owner",
  bankName: match.turf?.payoutBankName?.trim() || undefined,
  accountNumber: match.turf?.payoutAccountNumber?.trim() || undefined,
  ifscCode: match.turf?.payoutIfscCode?.trim() || undefined,
  upiId: match.turf?.payoutUpiId?.trim() || undefined,
});

const refreshMatchPayoutStatus = async (matchId) => {
  const match = await prisma.openMatch.findUnique({ where: { id: matchId }, include: automationInclude });
  if (!match) return null;
  const financials = serializeOpenMatchFinancials(match);
  return prisma.openMatch.update({
    where: { id: matchId },
    data: {
      payoutStatus: financials.payoutStatus,
      ...(financials.payoutStatus === "RELEASED" && !match.payoutReleasedAt ? { payoutReleasedAt: new Date() } : {}),
    },
    include: automationInclude,
  });
};

const maybeMarkMatchRefunded = async (matchId) => {
  const refundedCount = await prisma.openMatchParticipant.count({ where: { matchId, status: "REFUNDED" } });
  const paidCount = await prisma.openMatchParticipant.count({ where: { matchId, status: "PAID" } });
  if (paidCount === 0 && refundedCount > 0) {
    await prisma.openMatch.update({
      where: { id: matchId },
      data: { payoutStatus: "REFUNDED" },
    });
  }
};

const createParticipantRefund = async (match, participant, refundPercent = 100) => {
  if (!participant.paymentId || participant.status !== "PAID") return null;
  const refundAmount = Math.max(0, Math.round((Number(participant.amountPaid ?? 0) * Number(refundPercent ?? 0)) / 100));
  if (refundAmount <= 0) {
    await prisma.openMatchParticipant.update({
      where: { id: participant.id },
      data: { status: "CANCELLED", refundStatus: null, refundFailureReason: null },
    });
    return null;
  }
  const existing = participant.refunds.find((refund) => ["CREATED", "PROCESSED"].includes(refund.status));
  if (existing) return existing;

  const refundRecord = await prisma.openMatchPaymentRefund.create({
    data: {
      matchId: match.id,
      participantId: participant.id,
      amount: refundAmount,
      currency: "INR",
      receipt: `OMRF-${match.matchCode}-${participant.id}`.slice(0, 60),
      razorpayPaymentId: participant.paymentId,
      status: "CREATED",
    },
  });

  try {
    const refund = await createRazorpayRefund({
      paymentId: participant.paymentId,
      amount: refundAmount,
      receipt: refundRecord.receipt,
      notes: {
        flow: "open_match_refund",
        matchId: match.id,
        participantId: participant.id,
      },
    });

    const refundStatus = mapRefundStatus(refund.status);
    await prisma.openMatchPaymentRefund.update({
      where: { id: refundRecord.id },
      data: {
        razorpayRefundId: refund.id ?? null,
        status: refundStatus,
        ...(refundStatus === "PROCESSED" ? { processedAt: new Date() } : {}),
        ...(refundStatus === "FAILED" ? { failedAt: new Date(), failureReason: refund.error_description ?? "Refund failed" } : {}),
      },
    });

    if (refundStatus === "PROCESSED") {
      await prisma.openMatchParticipant.update({
        where: { id: participant.id },
        data:
          refundAmount >= Number(participant.amountPaid ?? 0)
            ? { status: "REFUNDED", refundStatus: "PROCESSED", refundedAt: new Date(), refundFailureReason: null }
            : { status: "REFUNDED", refundStatus: "PROCESSED", refundedAt: new Date(), refundFailureReason: null },
      });
      await sendOpenMatchRefundEmail(match, participant, refundAmount);
      await maybeMarkMatchRefunded(match.id);
    }

    return refund;
  } catch (error) {
    await prisma.openMatchPaymentRefund.update({
      where: { id: refundRecord.id },
      data: { status: "FAILED", failedAt: new Date(), failureReason: error.message },
    });
    await prisma.openMatchParticipant.update({
      where: { id: participant.id },
      data: { refundStatus: "FAILED", refundFailureReason: error.message },
    });
    logger.error({ error, matchId: match.id, participantId: participant.id }, "Open match refund automation failed");
    return null;
  }
};

export const refundOpenMatchParticipant = async (matchId, participantId, refundPercent = 100) => {
  const match = await prisma.openMatch.findUnique({ where: { id: matchId }, include: automationInclude });
  if (!match) throw AppError.notFound("Host match payment");
  const participant = match.participants.find((item) => item.id === participantId);
  if (!participant) throw AppError.notFound("Open match participant");

  await createParticipantRefund(match, participant, refundPercent);

  return prisma.openMatch.findUnique({ where: { id: matchId }, include: automationInclude });
};

export const forceOpenMatchRefunds = async (matchId, refundPercent = 100) => {
  const match = await prisma.openMatch.findUnique({ where: { id: matchId }, include: automationInclude });
  if (!match) throw AppError.notFound("Host match payment");

  for (const participant of match.participants) {
    await createParticipantRefund(match, participant, refundPercent);
  }

  return prisma.openMatch.findUnique({ where: { id: matchId }, include: automationInclude });
};

const createMatchPayout = async (match) => {
  const financials = serializeOpenMatchFinancials(match);
  if (financials.payoutStatus !== "ELIGIBLE" || Number(financials.ownerPayoutAmount ?? 0) <= 0) return null;
  if (match.payoutRelease && !["FAILED", "REVERSED", "REJECTED"].includes(match.payoutRelease.status)) return match.payoutRelease;

  const existing = await prisma.openMatchPayoutRelease.findUnique({ where: { matchId: match.id } });
  let payoutRecord = existing;

  if (!payoutRecord) {
    payoutRecord = await prisma.openMatchPayoutRelease.create({
      data: {
        matchId: match.id,
        amount: Number(financials.ownerPayoutAmount ?? 0),
        currency: financials.currency ?? "INR",
        payoutMethod: match.turf.payoutMethod,
        idempotencyKey: randomUUID(),
        referenceId: `open-match-${match.matchCode}`.slice(0, 40),
        status: "CREATED",
      },
    });
  } else if (["FAILED", "REVERSED", "REJECTED"].includes(payoutRecord.status)) {
    payoutRecord = await prisma.openMatchPayoutRelease.update({
      where: { id: payoutRecord.id },
      data: {
        amount: Number(financials.ownerPayoutAmount ?? 0),
        currency: financials.currency ?? "INR",
        payoutMethod: match.turf.payoutMethod,
        idempotencyKey: randomUUID(),
        referenceId: `open-match-${match.matchCode}-${Date.now()}`.slice(0, 60),
        status: "CREATED",
        failureReason: null,
        failedAt: null,
        reversedAt: null,
      },
    });
  }

  try {
    const contact = payoutRecord.razorpayContactId
      ? { id: payoutRecord.razorpayContactId }
      : await createRazorpayXContact(getPayoutContactPayload(match));
    const fundAccount = payoutRecord.razorpayFundAccountId
      ? { id: payoutRecord.razorpayFundAccountId }
      : await createRazorpayXFundAccount({
          contactId: contact.id,
          ...getPayoutFundAccountPayload(match),
        });
    const payout = await createRazorpayXPayout({
      fundAccountId: fundAccount.id,
      payoutMethod: match.turf.payoutMethod,
      amount: Number(financials.ownerPayoutAmount ?? 0),
      currency: financials.currency ?? "INR",
      referenceId: payoutRecord.referenceId,
      narration: `Open match ${match.matchCode}`,
      idempotencyKey: payoutRecord.idempotencyKey,
      notes: {
        flow: "open_match_payout",
        matchId: match.id,
      },
    });

    const payoutStatus = mapPayoutStatus(payout.status);
    await prisma.openMatchPayoutRelease.update({
      where: { id: payoutRecord.id },
      data: {
        razorpayContactId: contact.id,
        razorpayFundAccountId: fundAccount.id,
        razorpayPayoutId: payout.id ?? null,
        status: payoutStatus,
        utr: payout.utr ?? null,
        ...(payoutStatus === "PROCESSED" ? { processedAt: new Date(), failureReason: null } : {}),
      },
    });

    if (payoutStatus === "PROCESSED") {
      await prisma.openMatch.update({
        where: { id: match.id },
        data: { payoutStatus: "RELEASED", payoutReleasedAt: new Date(), payoutReference: payout.id ?? payout.utr ?? null },
      });
      await sendOpenMatchPayoutEmail(match, Number(financials.ownerPayoutAmount ?? 0), payoutStatus);
    }

    return payout;
  } catch (error) {
    await prisma.openMatchPayoutRelease.update({
      where: { id: payoutRecord.id },
      data: { status: "FAILED", failedAt: new Date(), failureReason: error.message },
    });
    logger.error({ error, matchId: match.id }, "Open match payout automation failed");
    return null;
  }
};

export const reconcileOpenMatchAutomation = async (matchId) => {
  const match = await prisma.openMatch.findUnique({ where: { id: matchId }, include: automationInclude });
  if (!match) return null;

  const effectiveStatus = deriveOpenMatchStatus(match);
  if (effectiveStatus !== match.status) {
    await prisma.openMatch.update({ where: { id: match.id }, data: { status: effectiveStatus } });
    match.status = effectiveStatus;
  }

  let gateway = null;
  try {
    gateway = await getActiveBookingAutomationConfig();
  } catch (error) {
    logger.warn({ error, matchId }, "Open match automation skipped because gateway config is incomplete");
  }

  if (gateway?.autoRefundsEnabled && effectiveStatus === "CANCELLED_REFUND") {
    for (const participant of match.participants) {
      await createParticipantRefund(match, participant);
    }
  }

  const refreshed = await refreshMatchPayoutStatus(match.id);
  const latestFinancials = refreshed ? serializeOpenMatchFinancials(refreshed) : serializeOpenMatchFinancials(match);
  if (gateway?.autoPayoutsEnabled && latestFinancials.payoutStatus === "ELIGIBLE") {
    await createMatchPayout(refreshed ?? match);
  }

  return prisma.openMatch.findUnique({ where: { id: match.id }, include: automationInclude });
};

export const reconcileOpenMatchAutomationBatch = async (matchIds = []) =>
  Promise.allSettled([...new Set(matchIds.filter(Boolean))].map((matchId) => reconcileOpenMatchAutomation(matchId)));

export const processRazorpayWebhook = async ({ rawBody, signature }) => {
  await verifyRazorpayWebhookSignature({ rawBody, signature });
  const payload = JSON.parse(rawBody.toString("utf8"));
  const event = String(payload?.event ?? "");

  if (event.startsWith("refund.")) {
    const refund = payload?.payload?.refund?.entity;
    if (!refund?.id) return { ok: true };
    const refundStatus = mapRefundStatus(refund.status);
    const record = await prisma.openMatchPaymentRefund.findFirst({ where: { razorpayRefundId: refund.id } });
    if (!record) {
      const syncedTournamentRefund = await syncTournamentEntryRefundWebhook(refund);
      if (!syncedTournamentRefund) await syncBookingRefundWebhook(refund);
      return { ok: true };
    }

    await prisma.openMatchPaymentRefund.update({
      where: { id: record.id },
      data: {
        status: refundStatus,
        failureReason: refund.error_description ?? null,
        ...(refundStatus === "PROCESSED" ? { processedAt: new Date() } : {}),
        ...(refundStatus === "FAILED" ? { failedAt: new Date() } : {}),
      },
    });

    if (refundStatus === "PROCESSED") {
      await prisma.openMatchParticipant.update({
        where: { id: record.participantId },
        data: { status: "REFUNDED", refundStatus: "PROCESSED", refundedAt: new Date(), refundFailureReason: null },
      });
      if (!record.participant?.refundedAt) {
        const match = await prisma.openMatch.findUnique({
          where: { id: record.matchId },
          include: automationInclude,
        });
        const participant = match?.participants?.find((item) => item.id === record.participantId);
        if (match && participant) {
          await sendOpenMatchRefundEmail(match, participant, Number(record.amount ?? 0));
        }
      }
      await maybeMarkMatchRefunded(record.matchId);
    }
  }

  if (event.startsWith("payout.")) {
    const payout = payload?.payload?.payout?.entity;
    if (!payout?.id) return { ok: true };
    const payoutStatus = mapPayoutStatus(payout.status);
    const record = await prisma.openMatchPayoutRelease.findFirst({ where: { razorpayPayoutId: payout.id } });
    if (!record) {
      const syncedTournamentPayout = await syncTournamentEntryPayoutWebhook(payout);
      if (syncedTournamentPayout) return { ok: true };
      await syncBookingPayoutWebhook(payout);
      return { ok: true };
    }
    const matchBeforeUpdate = await prisma.openMatch.findUnique({
      where: { id: record.matchId },
      select: { payoutReleasedAt: true },
    });

    await prisma.openMatchPayoutRelease.update({
      where: { id: record.id },
      data: {
        status: payoutStatus,
        utr: payout.utr ?? null,
        failureReason: payout.failure_reason ?? null,
        ...(payoutStatus === "PROCESSED" ? { processedAt: new Date() } : {}),
        ...(payoutStatus === "FAILED" || payoutStatus === "REJECTED" ? { failedAt: new Date() } : {}),
        ...(payoutStatus === "REVERSED" ? { reversedAt: new Date() } : {}),
      },
    });

    await prisma.openMatch.update({
      where: { id: record.matchId },
      data:
        payoutStatus === "PROCESSED"
          ? { payoutStatus: "RELEASED", payoutReleasedAt: new Date(), payoutReference: payout.id ?? payout.utr ?? null }
          : payoutStatus === "FAILED" || payoutStatus === "REJECTED" || payoutStatus === "REVERSED"
            ? { payoutStatus: "ELIGIBLE" }
            : {},
    });

    if (payoutStatus === "PROCESSED" && !matchBeforeUpdate?.payoutReleasedAt) {
      const match = await prisma.openMatch.findUnique({ where: { id: record.matchId }, include: automationInclude });
      if (match) {
        await sendOpenMatchPayoutEmail(match, Number(match?.payoutRelease?.amount ?? 0), payoutStatus);
      }
    }
  }

  return { ok: true };
};

export const triggerOpenMatchPayoutRelease = async (matchId) => {
  const match = await reconcileOpenMatchAutomation(matchId);
  if (!match) throw AppError.notFound("Host match payment");
  const financials = serializeOpenMatchFinancials(match);
  if (financials.payoutStatus === "RELEASED") return match;
  if (financials.payoutStatus !== "ELIGIBLE") {
    throw AppError.conflict("This host match payout is not ready for release yet");
  }
  await createMatchPayout(match);
  return prisma.openMatch.findUnique({ where: { id: matchId }, include: automationInclude });
};
