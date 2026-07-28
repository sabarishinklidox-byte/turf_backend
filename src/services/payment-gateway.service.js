import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import Razorpay from "razorpay";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

const BOOKING_PAYMENT_GATEWAY_ID = "booking-payment-gateway";
const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

const serializeBookingPaymentGatewayAdmin = (setting) => ({
  provider: setting.provider,
  isEnabled: setting.isEnabled,
  currency: setting.currency,
  razorpayKeyId: setting.razorpayKeyId ?? "",
  hasRazorpayKeySecret: Boolean(setting.razorpayKeySecret),
  hasRazorpayWebhookSecret: Boolean(setting.razorpayWebhookSecret),
  razorpayXKeyId: setting.razorpayXKeyId ?? "",
  hasRazorpayXKeySecret: Boolean(setting.razorpayXKeySecret),
  razorpayXSourceAccountNumber: setting.razorpayXSourceAccountNumber ?? "",
  autoRefundsEnabled: Boolean(setting.autoRefundsEnabled),
  autoPayoutsEnabled: Boolean(setting.autoPayoutsEnabled),
});

const ensureBookingPaymentGatewayRecord = async () =>
  prisma.bookingPaymentGatewaySetting.upsert({
    where: { id: BOOKING_PAYMENT_GATEWAY_ID },
    update: {},
    create: {
      id: BOOKING_PAYMENT_GATEWAY_ID,
      provider: "RAZORPAY",
      isEnabled: false,
      currency: "INR",
      autoRefundsEnabled: false,
      autoPayoutsEnabled: false,
    },
  });

const withTrimmedValue = (value) => value?.trim() || null;

const getRazorpayClient = (setting) =>
  new Razorpay({
    key_id: setting.razorpayKeyId,
    key_secret: setting.razorpayKeySecret,
  });

const buildBasicAuthHeader = (keyId, keySecret) =>
  `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

const callRazorpayX = async (setting, path, { method = "POST", body, idempotencyKey } = {}) => {
  const response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: buildBasicAuthHeader(setting.razorpayXKeyId, setting.razorpayXKeySecret),
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "X-Payout-Idempotency": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw AppError.conflict(data?.error?.description ?? data?.message ?? "RazorpayX request failed");
  }
  return data;
};

export const getBookingPaymentGatewayRecord = ensureBookingPaymentGatewayRecord;

export const getBookingPaymentGatewayForAdmin = async () =>
  serializeBookingPaymentGatewayAdmin(await ensureBookingPaymentGatewayRecord());

export const updateBookingPaymentGateway = async (input) => {
  const existing = await ensureBookingPaymentGatewayRecord();
  const updated = await prisma.bookingPaymentGatewaySetting.update({
    where: { id: BOOKING_PAYMENT_GATEWAY_ID },
    data: {
      isEnabled: input.isEnabled,
      currency: input.currency ?? existing.currency,
      razorpayKeyId: withTrimmedValue(input.razorpayKeyId),
      razorpayKeySecret: withTrimmedValue(input.razorpayKeySecret) ?? existing.razorpayKeySecret ?? null,
      razorpayWebhookSecret: withTrimmedValue(input.razorpayWebhookSecret) ?? existing.razorpayWebhookSecret ?? null,
      razorpayXKeyId: withTrimmedValue(input.razorpayXKeyId),
      razorpayXKeySecret: withTrimmedValue(input.razorpayXKeySecret) ?? existing.razorpayXKeySecret ?? null,
      razorpayXSourceAccountNumber:
        withTrimmedValue(input.razorpayXSourceAccountNumber) ?? existing.razorpayXSourceAccountNumber ?? null,
      autoRefundsEnabled: Boolean(input.autoRefundsEnabled),
      autoPayoutsEnabled: Boolean(input.autoPayoutsEnabled),
    },
  });

  return serializeBookingPaymentGatewayAdmin(updated);
};

export const getActiveBookingPaymentGatewayConfig = async () => {
  const setting = await ensureBookingPaymentGatewayRecord();
  if (!setting.isEnabled) return null;
  if (!setting.razorpayKeyId || !setting.razorpayKeySecret) {
    throw AppError.conflict("Booking payment gateway is enabled but Razorpay keys are incomplete");
  }
  return setting;
};

export const getActiveBookingAutomationConfig = async () => {
  const setting = await getActiveBookingPaymentGatewayConfig();
  if (!setting) return null;
  return setting;
};

export const getActiveRazorpayXConfig = async () => {
  const setting = await getActiveBookingAutomationConfig();
  if (!setting) return null;
  if (!setting.razorpayXKeyId || !setting.razorpayXKeySecret || !setting.razorpayXSourceAccountNumber) {
    throw AppError.conflict("RazorpayX payout settings are incomplete");
  }
  return setting;
};

export const createRazorpayOrder = async ({
  amount,
  receipt,
  notes = {},
  customer,
  description = "PlayArena payment",
}) => {
  const setting = await getActiveBookingPaymentGatewayConfig();
  if (!setting) return null;

  const razorpay = getRazorpayClient(setting);
  const order = await razorpay.orders.create({
    amount,
    currency: setting.currency,
    receipt,
    notes,
  });

  return {
    provider: setting.provider,
    keyId: setting.razorpayKeyId,
    currency: setting.currency,
    orderId: order.id,
    amount: order.amount,
    checkout: {
      name: "PlayArena",
      description,
      prefill: {
        name: [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim(),
        email: customer?.email ?? "",
        contact: customer?.phone ?? "",
      },
    },
  };
};

export const createRazorpayBookingOrder = async (input) =>
  createRazorpayOrder({
    ...input,
    description: "Turf slot booking",
  });

export const verifyRazorpayPaymentSignature = async ({
  orderId,
  paymentId,
  signature,
  expectedAmount = null,
  expectedCurrency = null,
}) => {
  const setting = await getActiveBookingPaymentGatewayConfig();
  if (!setting) throw AppError.conflict("Booking payment gateway is not enabled");

  const expected = crypto
    .createHmac("sha256", setting.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  if (expected !== signature) {
    throw AppError.validation("Payment signature verification failed");
  }

  const razorpay = getRazorpayClient(setting);
  const payment = await razorpay.payments.fetch(paymentId);

  if (!payment) throw AppError.validation("Unable to fetch Razorpay payment details");
  if (payment.order_id !== orderId) throw AppError.validation("Payment order does not match the checkout order");
  if (expectedAmount !== null && Number(payment.amount ?? 0) !== Number(expectedAmount)) {
    throw AppError.validation("Payment amount does not match the expected amount");
  }
  if ((expectedCurrency ?? setting.currency) && payment.currency !== (expectedCurrency ?? setting.currency)) {
    throw AppError.validation("Payment currency does not match the expected currency");
  }
  if (!["authorized", "captured"].includes(String(payment.status ?? "").toLowerCase())) {
    throw AppError.validation("Payment is not in a valid payable state");
  }

  return {
    provider: setting.provider,
    paymentOrderId: orderId,
    paymentId,
    paymentSignature: signature,
    paymentCapturedAt: payment.created_at ? new Date(Number(payment.created_at) * 1000) : new Date(),
  };
};

export const createRazorpayRefund = async ({ paymentId, amount, notes = {}, receipt }) => {
  const setting = await getActiveBookingAutomationConfig();
  if (!setting) throw AppError.conflict("Booking payment gateway is not enabled");

  const response = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}/refund`, {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(setting.razorpayKeyId, setting.razorpayKeySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amount * 100,
      speed: "normal",
      receipt,
      notes,
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw AppError.conflict(data?.error?.description ?? data?.message ?? "Unable to create Razorpay refund");
  }
  return data;
};

export const verifyRazorpayWebhookSignature = async ({ rawBody, signature }) => {
  const setting = await ensureBookingPaymentGatewayRecord();
  if (!setting.razorpayWebhookSecret) {
    throw AppError.conflict("Razorpay webhook secret is not configured");
  }

  const expected = crypto.createHmac("sha256", setting.razorpayWebhookSecret).update(rawBody).digest("hex");
  if (expected !== signature) {
    throw AppError.validation("Webhook signature verification failed");
  }
};

export const createRazorpayXContact = async ({ name, email, phone, referenceId }) => {
  const setting = await getActiveRazorpayXConfig();
  return callRazorpayX(setting, "/contacts", {
    body: {
      name,
      email,
      contact: phone,
      type: "vendor",
      reference_id: referenceId,
    },
  });
};

export const createRazorpayXFundAccount = async ({
  contactId,
  payoutMethod,
  accountHolderName,
  bankName,
  accountNumber,
  ifscCode,
  upiId,
}) => {
  const setting = await getActiveRazorpayXConfig();
  const accountType = payoutMethod === "UPI" ? "vpa" : "bank_account";
  const body =
    accountType === "vpa"
      ? {
          contact_id: contactId,
          account_type: "vpa",
          vpa: { address: upiId, name: accountHolderName || "Turf owner" },
        }
      : {
          contact_id: contactId,
          account_type: "bank_account",
          bank_account: {
            name: accountHolderName,
            ifsc: ifscCode,
            account_number: accountNumber,
            bank_name: bankName,
          },
        };

  return callRazorpayX(setting, "/fund_accounts", { body });
};

export const createRazorpayXPayout = async ({
  fundAccountId,
  payoutMethod,
  amount,
  currency,
  referenceId,
  narration,
  notes = {},
  idempotencyKey = randomUUID(),
}) => {
  const setting = await getActiveRazorpayXConfig();
  const mode = payoutMethod === "UPI" ? "UPI" : "IMPS";

  return callRazorpayX(setting, "/payouts", {
    idempotencyKey,
    body: {
      account_number: setting.razorpayXSourceAccountNumber,
      fund_account_id: fundAccountId,
      amount: amount * 100,
      currency,
      mode,
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration,
      notes,
    },
  });
};
