import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { sendEmail } from "./email.service.js";
import {
  createRazorpayRefund,
  createRazorpayXContact,
  createRazorpayXFundAccount,
  createRazorpayXPayout,
  getActiveBookingAutomationConfig,
} from "./payment-gateway.service.js";
import { AppError } from "../utils/app-error.js";

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

const sendDirectBookingRefundEmail = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: true,
      turf: true,
      slot: true,
      paymentRefunds: { orderBy: { requestedAt: "desc" } },
    },
  });

  if (!booking?.user?.email) return;

  const refund = booking.paymentRefunds?.[0] ?? null;
  const userName = [booking.user.firstName, booking.user.lastName].filter(Boolean).join(" ").trim() || booking.user.email;
  const bookingLink = `${appBaseUrl.replace(/\/$/, "")}/user/bookings`;
  const statusLine =
    booking.refundStatus === "PROCESSED"
      ? refund?.amount && refund.amount < Number(booking.price ?? 0)
        ? `Partial refund of ${formatCurrencyInr(refund.amount)} has been completed.`
        : `Refund of ${formatCurrencyInr(refund?.amount ?? booking.price ?? 0)} has been completed.`
      : booking.refundStatus === "FAILED"
        ? booking.refundFailureReason || "Refund could not be completed yet."
        : "Your refund is being processed.";

  try {
    await sendEmail({
      to: booking.user.email,
      subject:
        booking.refundStatus === "FAILED"
          ? `Your refund needs attention for booking ${booking.bookingCode}`
          : `Your refund is confirmed for booking ${booking.bookingCode}`,
      text: `Hi ${userName},\n\n${statusLine}\n\nBooking: ${booking.bookingCode}\nVenue: ${booking.turf?.name ?? "PlayArena venue"}\nTime: ${booking.slot?.startAt ? formatDateTimeForEmail(booking.slot.startAt) : "Not set"}\n${refund?.razorpayRefundId ? `Refund reference: ${refund.razorpayRefundId}\n` : ""}Open your bookings here:\n${bookingLink}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(userName)},</p>
          <h2 style="margin:0 0 12px;">${booking.refundStatus === "FAILED" ? "Refund needs attention" : "Your refund is confirmed"}</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(booking.bookingCode)}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">${escapeHtml(booking.turf?.name ?? "PlayArena venue")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(booking.slot?.startAt ? formatDateTimeForEmail(booking.slot.startAt) : "Time not set")}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Refund details</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">${escapeHtml(statusLine)}</div>
            ${refund?.razorpayRefundId ? `<div style="margin-top:6px;font-size:13px;color:#5f6f92;">Refund reference: ${escapeHtml(refund.razorpayRefundId)}</div>` : ""}
          </div>
          <p style="margin:0 0 18px;">
            <a href="${bookingLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open My Bookings
            </a>
          </p>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ error, bookingId: booking.id, email: booking.user.email }, "Direct booking refund email failed");
  }
};

const sendDirectBookingPayoutEmail = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { turf: true, slot: true },
  });

  if (!booking?.turf?.ownerEmail) return;

  const ownerName = booking.turf?.ownerName?.trim() || "turf owner";
  const venueLine = [booking.turf?.name, booking.turf?.city, booking.turf?.state].filter(Boolean).join(", ");
  const timeLine = booking.slot?.startAt ? formatDateTimeForEmail(booking.slot.startAt) : "Slot time not set";
  const amountLine = formatCurrencyInr(Number(booking.price ?? 0));
  const link = `${appBaseUrl.replace(/\/$/, "")}/owner/bookings`;
  const statusLine =
    booking.payoutStatus === "PAYOUT_SENT"
      ? `Payout of ${amountLine} has been sent to your account.`
      : booking.payoutStatus === "PAYOUT_REVERSED"
        ? `Payout of ${amountLine} was reversed and returned to the platform.`
        : `Payout of ${amountLine} could not be completed yet.`;

  try {
    await sendEmail({
      to: booking.turf.ownerEmail,
      subject: `Booking payout update for ${booking.bookingCode}`,
      text: `Hi ${ownerName},\n\n${statusLine}\n\nBooking: ${booking.bookingCode}\nVenue: ${venueLine || "Your turf"}\nTime: ${timeLine}\nPayout status: ${booking.payoutStatus}\nOpen booking ledger:\n${link}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(ownerName)},</p>
          <h2 style="margin:0 0 12px;">Booking payout update</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(booking.bookingCode)}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">${escapeHtml(venueLine || "Your turf")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(timeLine)}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Payout status</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">${escapeHtml(statusLine)}</div>
            <div style="margin-top:4px;font-size:14px;color:#10245e;">Current status: ${escapeHtml(booking.payoutStatus ?? "PENDING")}</div>
          </div>
          <p style="margin:0 0 18px;">
            <a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Booking Ledger
            </a>
          </p>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ error, bookingId: booking.id, email: booking.turf.ownerEmail }, "Direct booking payout email failed");
  }
};

const mapRefundStatus = (status) => {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "processed") return "PROCESSED";
  if (normalized === "failed") return "FAILED";
  return "CREATED";
};

export const bookingRefundInclude = {
  turf: true,
  slot: true,
  paymentRefunds: {
    orderBy: { requestedAt: "desc" },
  },
};

const mapPayoutStatus = (status) => {
  switch (String(status ?? "").toLowerCase()) {
    case "processed":
      return "PAYOUT_SENT";
    case "queued":
    case "pending":
    case "processing":
      return "PAYOUT_IN_PROGRESS";
    case "reversed":
      return "PAYOUT_REVERSED";
    case "rejected":
    case "failed":
      return "PAYOUT_FAILED";
    default:
      return "PAYOUT_IN_PROGRESS";
  }
};

const hasDirectBookingPayoutDestination = (booking) => {
  const turf = booking?.turf;
  if (!turf?.payoutMethod) return false;
  if (turf.payoutMethod === "UPI") {
    return Boolean(turf.payoutUpiId?.trim());
  }

  return Boolean(
    turf.payoutAccountHolderName?.trim() &&
      turf.payoutBankName?.trim() &&
      turf.payoutAccountNumber?.trim() &&
      turf.payoutIfscCode?.trim(),
  );
};

const getBookingRefundAmount = (booking) => Math.max(0, Number(booking?.paymentRefunds?.[0]?.amount ?? 0));

const getDirectBookingPayoutSnapshot = (booking, now = new Date()) => {
  const totalPaidAmount = booking?.paymentId ? Math.max(0, Number(booking?.price ?? 0)) : 0;
  const refundAmount = getBookingRefundAmount(booking);
  const retainedAmount =
    booking?.status === "CANCELLED"
      ? Math.max(0, totalPaidAmount - Math.min(totalPaidAmount, refundAmount))
      : totalPaidAmount;
  const slotEnded = booking?.slot?.endAt ? new Date(booking.slot.endAt) <= now : false;
  const payoutDestinationReady = hasDirectBookingPayoutDestination(booking);

  let payoutStatus = "NO_ONLINE_PAYMENT";
  if (totalPaidAmount > 0) {
    if (booking.paymentStatus === "REFUNDED" && retainedAmount <= 0) {
      payoutStatus = "REFUNDED";
    } else if (booking.status === "CANCELLED") {
      if (booking.refundStatus === "FAILED") payoutStatus = "REFUND_FAILED_HOLD";
      else if (booking.refundStatus === "CREATED") payoutStatus = "REFUND_REQUIRED";
      else if (retainedAmount <= 0) payoutStatus = "REFUNDED";
      else if (!payoutDestinationReady) payoutStatus = "OWNER_PAYOUT_DETAILS_PENDING";
      else payoutStatus = "READY_FOR_PAYOUT";
    } else if (!slotEnded) {
      payoutStatus = "HELD_IN_PLATFORM";
    } else if (!payoutDestinationReady) {
      payoutStatus = "OWNER_PAYOUT_DETAILS_PENDING";
    } else {
      payoutStatus = "READY_FOR_PAYOUT";
    }
  }

  if (booking?.payoutStatus === "PAYOUT_SENT") payoutStatus = "PAYOUT_SENT";
  if (booking?.payoutStatus === "PAYOUT_IN_PROGRESS") payoutStatus = "PAYOUT_IN_PROGRESS";
  if (booking?.payoutStatus === "PAYOUT_FAILED") payoutStatus = "PAYOUT_FAILED";
  if (booking?.payoutStatus === "PAYOUT_REVERSED") payoutStatus = "PAYOUT_REVERSED";
  if (booking.paymentStatus === "REFUNDED" && retainedAmount <= 0) payoutStatus = "REFUNDED";

  return {
    totalPaidAmount,
    refundAmount,
    retainedAmount,
    slotEnded,
    payoutDestinationReady,
    payoutAmount: payoutStatus === "READY_FOR_PAYOUT" || payoutStatus === "PAYOUT_IN_PROGRESS" || payoutStatus === "PAYOUT_SENT" || payoutStatus === "PAYOUT_FAILED" || payoutStatus === "PAYOUT_REVERSED"
      ? retainedAmount
      : 0,
    payoutStatus,
  };
};

const getBookingPayoutContactPayload = (booking) => ({
  name: booking.turf?.ownerName?.trim() || "Turf owner",
  email: booking.turf?.ownerEmail?.trim() || undefined,
  phone: booking.turf?.ownerPhone?.trim() || undefined,
  referenceId: `direct-booking-owner-${booking.turfId}`,
});

const getBookingPayoutFundAccountPayload = (booking) => ({
  payoutMethod: booking.turf?.payoutMethod,
  accountHolderName: booking.turf?.payoutAccountHolderName?.trim() || booking.turf?.ownerName?.trim() || "Turf owner",
  bankName: booking.turf?.payoutBankName?.trim() || undefined,
  accountNumber: booking.turf?.payoutAccountNumber?.trim() || undefined,
  ifscCode: booking.turf?.payoutIfscCode?.trim() || undefined,
  upiId: booking.turf?.payoutUpiId?.trim() || undefined,
});

const syncBookingPayoutStatus = async (bookingId) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingRefundInclude });
  if (!booking) return null;
  const snapshot = getDirectBookingPayoutSnapshot(booking);
  return prisma.booking.update({
    where: { id: bookingId },
    data: {
      payoutStatus: snapshot.payoutStatus,
      payoutMethod: booking.turf?.payoutMethod ?? null,
      ...(snapshot.payoutStatus === "PAYOUT_SENT" && !booking.payoutReleasedAt ? { payoutReleasedAt: new Date() } : {}),
    },
    include: bookingRefundInclude,
  });
};

const createBookingPayout = async (booking) => {
  const snapshot = getDirectBookingPayoutSnapshot(booking);
  if (snapshot.payoutStatus !== "READY_FOR_PAYOUT" || Number(snapshot.payoutAmount ?? 0) <= 0) return null;

  const referenceId = booking.payoutReference ?? `direct-booking-${booking.bookingCode}`.slice(0, 60);
  const idempotencyKey = booking.payoutIdempotencyKey ?? randomUUID();

  try {
    const contact = booking.razorpayContactId
      ? { id: booking.razorpayContactId }
      : await createRazorpayXContact(getBookingPayoutContactPayload(booking));
    const fundAccount = booking.razorpayFundAccountId
      ? { id: booking.razorpayFundAccountId }
      : await createRazorpayXFundAccount({
          contactId: contact.id,
          ...getBookingPayoutFundAccountPayload(booking),
        });
    const payout = await createRazorpayXPayout({
      fundAccountId: fundAccount.id,
      payoutMethod: booking.turf.payoutMethod,
      amount: Number(snapshot.payoutAmount ?? 0),
      currency: "INR",
      referenceId,
      narration: `Booking ${booking.bookingCode}`,
      idempotencyKey,
      notes: {
        flow: "direct_booking_payout",
        bookingId: booking.id,
        turfId: booking.turfId,
      },
    });

    const payoutStatus = mapPayoutStatus(payout.status);
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        payoutStatus,
        payoutMethod: booking.turf.payoutMethod,
        payoutReference: referenceId,
        payoutIdempotencyKey: idempotencyKey,
        razorpayContactId: contact.id,
        razorpayFundAccountId: fundAccount.id,
        razorpayPayoutId: payout.id ?? null,
        payoutFailureReason: payout.failure_reason ?? null,
        ...(payoutStatus === "PAYOUT_SENT" ? { payoutReleasedAt: new Date() } : {}),
      },
    });

    if (payoutStatus === "PAYOUT_SENT" || payoutStatus === "PAYOUT_FAILED" || payoutStatus === "PAYOUT_REVERSED") {
      await sendDirectBookingPayoutEmail(booking.id);
    }

    return payout;
  } catch (error) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        payoutStatus: "PAYOUT_FAILED",
        payoutMethod: booking.turf?.payoutMethod ?? null,
        payoutReference: referenceId,
        payoutIdempotencyKey: idempotencyKey,
        payoutFailureReason: error.message,
      },
    });
    await sendDirectBookingPayoutEmail(booking.id);
    logger.error({ error, bookingId: booking.id }, "Direct booking payout automation failed");
    return null;
  }
};

export const reconcileDirectBookingPayoutAutomation = async (bookingId) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingRefundInclude });
  if (!booking) return null;

  const snapshot = getDirectBookingPayoutSnapshot(booking);
  let updatedBooking = booking;
  if (
    booking.payoutStatus !== snapshot.payoutStatus ||
    booking.payoutMethod !== (booking.turf?.payoutMethod ?? null)
  ) {
    updatedBooking = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        payoutStatus: snapshot.payoutStatus,
        payoutMethod: booking.turf?.payoutMethod ?? null,
      },
      include: bookingRefundInclude,
    });
  }

  const gateway = await getActiveBookingAutomationConfig().catch(() => null);
  if (gateway?.autoPayoutsEnabled && snapshot.payoutStatus === "READY_FOR_PAYOUT") {
    await createBookingPayout(updatedBooking);
    return prisma.booking.findUnique({ where: { id: bookingId }, include: bookingRefundInclude });
  }

  return updatedBooking;
};

export const reconcileDirectBookingPayoutAutomationBatch = async (bookingIds = []) =>
  Promise.allSettled([...new Set(bookingIds.filter(Boolean))].map((bookingId) => reconcileDirectBookingPayoutAutomation(bookingId)));

export const createBookingRefund = async (booking, { actorRole = "SYSTEM", reason, amount } = {}) => {
  const totalAmount = Number(booking?.price ?? 0);
  const refundAmount = Math.max(0, Math.min(Number(amount ?? totalAmount), totalAmount));
  if (!booking?.id || !booking?.paymentId || refundAmount <= 0) return booking;
  if (booking.paymentStatus === "REFUNDED") return booking;

  const existingRefund = (booking.paymentRefunds ?? []).find((refund) => ["CREATED", "PROCESSED"].includes(refund.status));
  if (existingRefund) {
    if (existingRefund.status === "PROCESSED" && booking.paymentStatus !== "REFUNDED") {
      await prisma.booking.update({
        where: { id: booking.id },
        data:
          Number(existingRefund.amount ?? 0) >= totalAmount
            ? {
                paymentStatus: "REFUNDED",
                refundStatus: "PROCESSED",
                refundedAt: existingRefund.processedAt ?? new Date(),
                refundFailureReason: null,
              }
            : {
                refundStatus: "PROCESSED",
                refundedAt: existingRefund.processedAt ?? new Date(),
                refundFailureReason: null,
              },
      });
    } else if (booking.refundStatus !== existingRefund.status) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          refundStatus: existingRefund.status,
          refundFailureReason: existingRefund.failureReason ?? null,
        },
      });
    }
    const refreshedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      include: bookingRefundInclude,
    });
    await reconcileDirectBookingPayoutAutomation(booking.id);
    return refreshedBooking;
  }

  const refundRecord = await prisma.bookingPaymentRefund.create({
    data: {
      bookingId: booking.id,
      amount: refundAmount,
      currency: "INR",
      receipt: `BKRF-${booking.bookingCode}`.slice(0, 60),
      razorpayPaymentId: booking.paymentId,
      status: "CREATED",
    },
  });

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      refundStatus: "CREATED",
      refundFailureReason: null,
    },
  });

  try {
    const refund = await createRazorpayRefund({
      paymentId: booking.paymentId,
      amount: refundAmount,
      receipt: refundRecord.receipt,
      notes: {
        flow: "direct_booking_refund",
        bookingId: booking.id,
        actorRole,
        reason: reason?.trim() || "Booking cancelled",
      },
    });

    const refundStatus = mapRefundStatus(refund.status);
    const now = new Date();

    await prisma.bookingPaymentRefund.update({
      where: { id: refundRecord.id },
      data: {
        razorpayRefundId: refund.id ?? null,
        status: refundStatus,
        failureReason: refund.error_description ?? null,
        ...(refundStatus === "PROCESSED" ? { processedAt: now } : {}),
        ...(refundStatus === "FAILED" ? { failedAt: now } : {}),
      },
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data:
        refundStatus === "PROCESSED"
          ? refundAmount >= totalAmount
            ? {
                paymentStatus: "REFUNDED",
                refundStatus: "PROCESSED",
                refundedAt: now,
                refundFailureReason: null,
              }
            : {
                refundStatus: "PROCESSED",
                refundedAt: now,
                refundFailureReason: null,
              }
          : refundStatus === "FAILED"
            ? {
                refundStatus: "FAILED",
                refundFailureReason: refund.error_description ?? "Refund failed",
              }
            : {
                refundStatus: "CREATED",
                refundFailureReason: null,
              },
    });

    if (refundStatus === "PROCESSED" || refundStatus === "FAILED") {
      const refreshedBooking = await prisma.booking.findUnique({ where: { id: booking.id }, include: bookingRefundInclude });
      if (refreshedBooking) {
        await sendDirectBookingRefundEmail(refreshedBooking.id);
      }
    }
  } catch (error) {
    await prisma.bookingPaymentRefund.update({
      where: { id: refundRecord.id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        failureReason: error.message,
      },
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        refundStatus: "FAILED",
        refundFailureReason: error.message,
      },
    });
    await sendDirectBookingRefundEmail(booking.id);

    logger.error({ error, bookingId: booking.id }, "Direct booking refund failed");
  }

  const refreshedBooking = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: bookingRefundInclude,
  });
  await reconcileDirectBookingPayoutAutomation(booking.id);
  return refreshedBooking;
};

export const syncBookingRefundWebhook = async (refund) => {
  if (!refund?.id) return false;

  const refundStatus = mapRefundStatus(refund.status);
  const record = await prisma.bookingPaymentRefund.findFirst({
    where: { razorpayRefundId: refund.id },
  });

  if (!record) return false;

  const now = new Date();
  await prisma.bookingPaymentRefund.update({
    where: { id: record.id },
    data: {
      status: refundStatus,
      failureReason: refund.error_description ?? null,
      ...(refundStatus === "PROCESSED" ? { processedAt: now } : {}),
      ...(refundStatus === "FAILED" ? { failedAt: now } : {}),
    },
  });

  const booking = await prisma.booking.findUnique({
    where: { id: record.bookingId },
    include: bookingRefundInclude,
  });

  await prisma.booking.update({
    where: { id: record.bookingId },
    data:
      refundStatus === "PROCESSED"
        ? record.amount >= Number(booking?.price ?? 0)
          ? {
              paymentStatus: "REFUNDED",
              refundStatus: "PROCESSED",
              refundedAt: now,
              refundFailureReason: null,
            }
          : {
              refundStatus: "PROCESSED",
              refundedAt: now,
              refundFailureReason: null,
            }
        : refundStatus === "FAILED"
          ? {
              refundStatus: "FAILED",
              refundFailureReason: refund.error_description ?? "Refund failed",
            }
          : {
              refundStatus: "CREATED",
              refundFailureReason: null,
            },
  });

  if (
    booking &&
    ((refundStatus === "PROCESSED" && !booking.refundedAt) ||
      (refundStatus === "FAILED" && booking.refundStatus !== "FAILED"))
  ) {
    await sendDirectBookingRefundEmail(booking.id);
  }

  await reconcileDirectBookingPayoutAutomation(record.bookingId);

  return true;
};

export const syncBookingPayoutWebhook = async (payout) => {
  if (!payout?.id) return false;

  const payoutStatus = mapPayoutStatus(payout.status);
  const booking = await prisma.booking.findFirst({
    where: { razorpayPayoutId: payout.id },
    include: bookingRefundInclude,
  });
  if (!booking) return false;

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      payoutStatus,
      payoutFailureReason: payout.failure_reason ?? null,
      payoutReference: booking.payoutReference ?? payout.id ?? payout.utr ?? null,
      ...(payoutStatus === "PAYOUT_SENT" ? { payoutReleasedAt: new Date() } : {}),
    },
  });

  if (
    (payoutStatus === "PAYOUT_SENT" && !booking.payoutReleasedAt) ||
    ((payoutStatus === "PAYOUT_FAILED" || payoutStatus === "PAYOUT_REVERSED") &&
      booking.payoutStatus !== payoutStatus)
  ) {
    await sendDirectBookingPayoutEmail(booking.id);
  }

  await syncBookingPayoutStatus(booking.id);
  return true;
};
