import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { getTournamentRegistrationOfferRecord } from "./tournament-offer.service.js";
import { sendEmail } from "./email.service.js";
import { notifyUsersForTournament } from "./notification.service.js";
import {
  createRazorpayOrder,
  createRazorpayRefund,
  createRazorpayXContact,
  createRazorpayXFundAccount,
  createRazorpayXPayout,
  getActiveBookingPaymentGatewayConfig,
  verifyRazorpayPaymentSignature,
} from "./payment-gateway.service.js";
import { AppError } from "../utils/app-error.js";

const tournamentCode = () => `TN-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
const tournamentPaymentReceipt = () => `TEP-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
const tournamentRefundReceipt = (payment) => `TERF-${payment.tournament?.tournamentCode ?? payment.tournamentId}-${payment.id}`.slice(0, 60);
const tournamentPayoutReference = (payment) => `tournament-${payment.tournament?.tournamentCode ?? payment.tournamentId}-${payment.id}`.slice(0, 60);
const appBaseUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173").trim();
const TOURNAMENT_ENTRY_PAYOUT_STATUS = {
  HELD_IN_PLATFORM: "HELD_IN_PLATFORM",
  LOCKED_AFTER_START: "LOCKED_AFTER_START",
  READY_FOR_PAYOUT: "READY_FOR_PAYOUT",
  PAYOUT_PROCESSING: "PAYOUT_PROCESSING",
  PAYOUT_SENT: "PAYOUT_SENT",
  PAYOUT_FAILED: "PAYOUT_FAILED",
  PAYOUT_REVERSED: "PAYOUT_REVERSED",
  PLATFORM_RETAINED: "PLATFORM_RETAINED",
  REFUND_REQUIRED: "REFUND_REQUIRED",
  REFUNDED: "REFUNDED",
};
const PLAYOFF_STAGE_PREFIX = "__PLAYOFF_STAGE__:";
const PLAYOFF_STAGES = {
  SEMIFINAL: "SEMIFINAL",
  FINAL: "FINAL",
};
const CRICKET_OVERS_PATTERN = /^\d{1,3}(\.[0-5])?$/;
const CRICKET_MATCH_OUTCOMES = {
  NORMAL: "NORMAL",
  ABANDONED: "ABANDONED",
  NO_RESULT: "NO_RESULT",
  RAIN_AFFECTED: "RAIN_AFFECTED",
  SUPER_OVER: "SUPER_OVER",
};
const CRICKET_DISMISSAL_TYPES = {
  BOWLED: "BOWLED",
  CAUGHT: "CAUGHT",
  LBW: "LBW",
  RUN_OUT: "RUN_OUT",
  STUMPED: "STUMPED",
  HIT_WICKET: "HIT_WICKET",
  RETIRED_OUT: "RETIRED_OUT",
  RETIRED_HURT: "RETIRED_HURT",
};
const CRICKET_DISMISSAL_TYPES_WITH_FIELDER = new Set([
  CRICKET_DISMISSAL_TYPES.CAUGHT,
  CRICKET_DISMISSAL_TYPES.RUN_OUT,
  CRICKET_DISMISSAL_TYPES.STUMPED,
]);
const CRICKET_BOWLER_WICKET_TYPES = new Set([
  CRICKET_DISMISSAL_TYPES.BOWLED,
  CRICKET_DISMISSAL_TYPES.CAUGHT,
  CRICKET_DISMISSAL_TYPES.LBW,
  CRICKET_DISMISSAL_TYPES.STUMPED,
  CRICKET_DISMISSAL_TYPES.HIT_WICKET,
]);
const formatDateTimeForEmail = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));

const formatDateForEmail = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
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

const sendTournamentEntryConfirmationEmail = async (teamId) => {
  const team = await prisma.tournamentTeam.findUnique({
    where: { id: teamId },
    include: {
      owner: {
        select: { firstName: true, lastName: true, email: true },
      },
      tournament: {
        include: {
          turf: true,
        },
      },
      entryPayment: true,
    },
  });

  if (!team?.owner?.email || !team.tournament) return;

  const userName = [team.owner.firstName, team.owner.lastName].filter(Boolean).join(" ").trim() || team.owner.email;
  const tournamentLink = `${appBaseUrl.replace(/\/$/, "")}/user/tournaments/${team.tournament.id}`;
  const venueLine = [team.tournament.turf?.name, team.tournament.turf?.city, team.tournament.turf?.state].filter(Boolean).join(", ");
  const payment = team.entryPayment;
  const paymentText = payment
    ? [
        `Entry fee paid: ${formatCurrencyInr(payment.finalEntryFee)}`,
        payment.paymentId ? `Payment ID: ${payment.paymentId}` : null,
        payment.paymentOrderId ? `Order ID: ${payment.paymentOrderId}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Entry fee: No online payment was required for this tournament join.";
  const paymentHtml = payment
    ? [
        `<div style="margin-top:8px;font-size:14px;color:#10245e;">Entry fee paid: ${escapeHtml(formatCurrencyInr(payment.finalEntryFee))}</div>`,
        payment.paymentId
          ? `<div style="margin-top:4px;font-size:14px;color:#10245e;">Payment ID: ${escapeHtml(payment.paymentId)}</div>`
          : "",
        payment.paymentOrderId
          ? `<div style="margin-top:4px;font-size:14px;color:#10245e;">Order ID: ${escapeHtml(payment.paymentOrderId)}</div>`
          : "",
      ].join("")
    : `<div style="margin-top:8px;font-size:14px;color:#10245e;">Entry fee: No online payment was required for this tournament join.</div>`;

  await sendEmail({
    to: team.owner.email,
    subject: `Tournament entry confirmed on PlayArena: ${team.tournament.title}`,
    text: `Hi ${userName},\n\nYour tournament entry is confirmed.\n\nTournament: ${team.tournament.title}\nTeam: ${team.name}\nVenue: ${venueLine || "PlayArena venue"}\nStart: ${team.tournament.startDate ? formatDateForEmail(team.tournament.startDate) : "To be announced"}\n${paymentText}\n\nOpen tournament:\n${tournamentLink}\n\n- PlayArena`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
        <p style="margin:0 0 8px;">Hi ${escapeHtml(userName)},</p>
        <h2 style="margin:0 0 12px;">Your tournament entry is confirmed</h2>
        <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
          <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(team.tournament.title)}</div>
          <div style="margin-top:6px;font-size:14px;color:#5f6f92;">Team: ${escapeHtml(team.name)}</div>
          <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(venueLine || "PlayArena venue")}</div>
          <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(team.tournament.startDate ? formatDateForEmail(team.tournament.startDate) : "Start date to be announced")}</div>
        </div>
        <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
          <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Payment details</div>
          ${paymentHtml}
        </div>
        <p style="margin:0 0 18px;">
          <a href="${tournamentLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
            Open Tournament
          </a>
        </p>
        <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
      </div>
    `,
  });
};

const sendTournamentEntryRefundEmail = async (paymentId) => {
  const payment = await prisma.tournamentEntryPayment.findUnique({
    where: { id: paymentId },
    include: {
      tournament: { include: { turf: true } },
      team: true,
      payer: true,
      refunds: { orderBy: { requestedAt: "desc" } },
    },
  });

  if (!payment?.payer?.email) return;

  const payerName = [payment.payer.firstName, payment.payer.lastName].filter(Boolean).join(" ").trim() || payment.payer.email;
  const tournamentLink = `${appBaseUrl.replace(/\/$/, "")}/user/tournaments/${payment.tournamentId}`;
  const refund = payment.refunds?.[0] ?? null;
  const venueLine = [payment.tournament?.turf?.name, payment.tournament?.turf?.city, payment.tournament?.turf?.state].filter(Boolean).join(", ");
  const statusLine =
    payment.payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUNDED
      ? `Refund of ${formatCurrencyInr(payment.finalEntryFee)} has been completed.`
      : payment.payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED
        ? payment.payoutFailureReason || "Refund could not be completed yet."
        : `Refund of ${formatCurrencyInr(payment.finalEntryFee)} is being processed.`;

  try {
    await sendEmail({
      to: payment.payer.email,
      subject:
        payment.payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUNDED
          ? `Your tournament refund is confirmed: ${payment.tournament?.title ?? "Tournament entry"}`
          : `Your tournament refund needs attention: ${payment.tournament?.title ?? "Tournament entry"}`,
      text: `Hi ${payerName},\n\n${statusLine}\n\nTournament: ${payment.tournament?.title ?? "Tournament"}\nTeam: ${payment.team?.name ?? "Your team"}\nVenue: ${venueLine || "PlayArena venue"}\nRefund amount: ${formatCurrencyInr(payment.finalEntryFee)}\n${refund?.razorpayRefundId ? `Refund reference: ${refund.razorpayRefundId}\n` : ""}Open tournament:\n${tournamentLink}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(payerName)},</p>
          <h2 style="margin:0 0 12px;">${payment.payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUNDED ? "Your tournament refund is confirmed" : "Your tournament refund needs attention"}</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(payment.tournament?.title ?? "Tournament")}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">Team: ${escapeHtml(payment.team?.name ?? "Your team")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(venueLine || "PlayArena venue")}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Refund details</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">${escapeHtml(statusLine)}</div>
            <div style="margin-top:4px;font-size:14px;color:#10245e;">Refund amount: ${escapeHtml(formatCurrencyInr(payment.finalEntryFee))}</div>
            ${refund?.razorpayRefundId ? `<div style="margin-top:6px;font-size:13px;color:#5f6f92;">Refund reference: ${escapeHtml(refund.razorpayRefundId)}</div>` : ""}
          </div>
          <p style="margin:0 0 18px;">
            <a href="${tournamentLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Tournament
            </a>
          </p>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ error, paymentId: payment.id, email: payment.payer.email }, "Tournament refund email failed");
  }
};

const sendTournamentPayoutEmail = async (paymentId, payoutStatus, payoutAmount) => {
  const payment = await prisma.tournamentEntryPayment.findUnique({
    where: { id: paymentId },
    include: {
      tournament: { include: { turf: true } },
      team: true,
      payoutRecipient: true,
    },
  });

  if (!payment?.payoutRecipient?.email) return;

  const recipientName =
    [payment.payoutRecipient.firstName, payment.payoutRecipient.lastName].filter(Boolean).join(" ").trim() ||
    payment.payoutRecipient.email;
  const venueLine = [payment.tournament?.turf?.name, payment.tournament?.turf?.city, payment.tournament?.turf?.state].filter(Boolean).join(", ");
  const tournamentLink = `${appBaseUrl.replace(/\/$/, "")}/owner/tournaments/${payment.tournamentId}`;
  const statusLine =
    payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_SENT
      ? `Payout of ${formatCurrencyInr(payoutAmount)} has been sent to your account.`
      : payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_REVERSED
        ? `Payout of ${formatCurrencyInr(payoutAmount)} was reversed.`
        : payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_FAILED
          ? `Payout of ${formatCurrencyInr(payoutAmount)} failed and needs attention.`
          : payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_REJECTED
            ? `Payout of ${formatCurrencyInr(payoutAmount)} was rejected by the payout provider.`
        : `Payout of ${formatCurrencyInr(payoutAmount)} could not be completed yet.`;

  try {
    await sendEmail({
      to: payment.payoutRecipient.email,
      subject: `Tournament payout update: ${payment.tournament?.title ?? "Tournament"}`,
      text: `Hi ${recipientName},\n\n${statusLine}\n\nTournament: ${payment.tournament?.title ?? "Tournament"}\nTeam: ${payment.team?.name ?? "Team"}\nVenue: ${venueLine || "PlayArena venue"}\nPayout status: ${payoutStatus}\n\nOpen tournament ledger:\n${tournamentLink}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(recipientName)},</p>
          <h2 style="margin:0 0 12px;">Tournament payout update</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(payment.tournament?.title ?? "Tournament")}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">Team: ${escapeHtml(payment.team?.name ?? "Team")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(venueLine || "PlayArena venue")}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Payout details</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">${escapeHtml(statusLine)}</div>
            <div style="margin-top:4px;font-size:14px;color:#10245e;">Current status: ${escapeHtml(payoutStatus)}</div>
          </div>
          <p style="margin:0 0 18px;">
            <a href="${tournamentLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Tournament Ledger
            </a>
          </p>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ error, paymentId: payment.id, email: payment.payoutRecipient.email }, "Tournament payout email failed");
  }
};

const parseMatchStage = (resultNote) => {
  if (!resultNote?.startsWith(PLAYOFF_STAGE_PREFIX)) {
    return { stage: null, userNote: resultNote ?? null };
  }

  const [markerLine, ...rest] = resultNote.split("\n");
  return {
    stage: markerLine.slice(PLAYOFF_STAGE_PREFIX.length) || null,
    userNote: rest.join("\n").trim() || null,
  };
};

const buildMatchResultNote = (stage, userNote) => {
  if (!stage) return userNote ?? null;
  const trimmedNote = userNote?.trim();
  return trimmedNote ? `${PLAYOFF_STAGE_PREFIX}${stage}\n${trimmedNote}` : `${PLAYOFF_STAGE_PREFIX}${stage}`;
};

const normalizeSportKey = (value = "") => value.trim().toUpperCase();
const isCricketSport = (value = "") => normalizeSportKey(value) === "CRICKET";
const isSharedPointsOutcome = (matchOutcome) =>
  matchOutcome === CRICKET_MATCH_OUTCOMES.ABANDONED || matchOutcome === CRICKET_MATCH_OUTCOMES.NO_RESULT;

const getCricketMatchOutcomeLabel = (matchOutcome = CRICKET_MATCH_OUTCOMES.NORMAL) => {
  switch (matchOutcome) {
    case CRICKET_MATCH_OUTCOMES.ABANDONED:
      return "Abandoned";
    case CRICKET_MATCH_OUTCOMES.NO_RESULT:
      return "No result";
    case CRICKET_MATCH_OUTCOMES.RAIN_AFFECTED:
      return "Rain affected";
    case CRICKET_MATCH_OUTCOMES.SUPER_OVER:
      return "Super over";
    default:
      return "Result confirmed";
  }
};

const formatCricketInningsScore = (runs, wickets, overs) => {
  if (runs === null || runs === undefined) return null;
  const wicketPart = wickets === null || wickets === undefined ? "" : `/${wickets}`;
  const oversPart = overs ? ` (${overs})` : "";
  return `${runs}${wicketPart}${oversPart}`;
};

const getCricketResultSummary = (match, teamSize = 11) => {
  if (!isCricketSport(match?.sport)) return null;
  if (match.matchOutcome === CRICKET_MATCH_OUTCOMES.ABANDONED) return "Match abandoned";
  if (match.matchOutcome === CRICKET_MATCH_OUTCOMES.NO_RESULT) return "No result";
  if (match.homeScore === null || match.homeScore === undefined || match.awayScore === null || match.awayScore === undefined) {
    return null;
  }
  if (match.homeScore === match.awayScore) return "Match tied";

  const winnerSide = match.homeScore > match.awayScore ? "HOME" : "AWAY";
  const winnerName = winnerSide === "HOME" ? match.homeTeam?.name : match.awayTeam?.name;
  const margin = Math.abs(match.homeScore - match.awayScore);
  if (!winnerName) return null;

  if (match.matchOutcome === CRICKET_MATCH_OUTCOMES.SUPER_OVER) {
    return `${winnerName} won in super over`;
  }

  if (!match.battingFirstSide) {
    return `${winnerName} won`;
  }

  if (winnerSide === match.battingFirstSide) {
    const summary = `${winnerName} won by ${margin} ${margin === 1 ? "run" : "runs"}`;
    return match.matchOutcome === CRICKET_MATCH_OUTCOMES.RAIN_AFFECTED ? `${summary} (rain affected)` : summary;
  }

  const wicketsLost = winnerSide === "HOME" ? match.homeWickets : match.awayWickets;
  const maxWickets = Math.max((teamSize ?? 11) - 1, 0);
  const wicketsRemaining = typeof wicketsLost === "number" ? Math.max(maxWickets - wicketsLost, 0) : null;
  if (typeof wicketsRemaining === "number" && wicketsRemaining > 0) {
    const summary = `${winnerName} won by ${wicketsRemaining} ${wicketsRemaining === 1 ? "wicket" : "wickets"}`;
    return match.matchOutcome === CRICKET_MATCH_OUTCOMES.RAIN_AFFECTED ? `${summary} (rain affected)` : summary;
  }

  return `${winnerName} won`;
};

const normalizeCricketResultInput = (tournament, input) => {
  if (!isCricketSport(tournament?.sport)) return null;
  const matchOutcome = input.matchOutcome ?? CRICKET_MATCH_OUTCOMES.NORMAL;
  if (isSharedPointsOutcome(matchOutcome)) {
    return {
      homeScore: 0,
      awayScore: 0,
      homeWickets: null,
      awayWickets: null,
      homeOvers: null,
      awayOvers: null,
      battingFirstSide: null,
      matchOutcome,
    };
  }

  const homeOvers = input.homeOvers?.trim?.() ?? null;
  const awayOvers = input.awayOvers?.trim?.() ?? null;
  const hasAllFields =
    typeof input.homeWickets === "number" &&
    typeof input.awayWickets === "number" &&
    Boolean(homeOvers) &&
    Boolean(awayOvers) &&
    Boolean(input.battingFirstSide);

  if (!hasAllFields) {
    throw AppError.validation("Enter runs, wickets, overs, and who batted first for both teams");
  }

  if (!CRICKET_OVERS_PATTERN.test(homeOvers) || !CRICKET_OVERS_PATTERN.test(awayOvers)) {
    throw AppError.validation("Enter overs like 20 or 18.3");
  }

  const maxWickets = Math.max((tournament.teamSize ?? 11) - 1, 0);
  if (input.homeWickets > maxWickets || input.awayWickets > maxWickets) {
    throw AppError.validation(`Wickets cannot be more than ${maxWickets} for this tournament`);
  }

  return {
    homeScore: input.homeScore,
    awayScore: input.awayScore,
    homeWickets: input.homeWickets,
    awayWickets: input.awayWickets,
    homeOvers,
    awayOvers,
    battingFirstSide: input.battingFirstSide,
    matchOutcome,
  };
};

const otherTournamentSide = (side) => (side === "HOME" ? "AWAY" : "HOME");
const formatBallsAsOvers = (legalBalls = 0) => `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
const toOneDecimal = (value) => (Number.isFinite(value) ? Number(value).toFixed(2) : null);

const createEmptyCricketInnings = ({ battingSide, bowlingSide, target = null, battingLineup = [] }) => ({
  battingSide,
  bowlingSide,
  target,
  battingLineup,
  events: [],
  currentPlayers: {
    strikerName: "",
    nonStrikerName: "",
    bowlerName: "",
  },
  completed: false,
  completedAt: null,
});

const createCricketLiveScorecard = (tournament, match, input) => {
  const tossWinnerSide = input.tossWinnerSide;
  const tossDecision = input.tossDecision;
  const firstBattingSide = tossDecision === "BAT" ? tossWinnerSide : otherTournamentSide(tossWinnerSide);
  const secondBattingSide = otherTournamentSide(firstBattingSide);
  const homeLineup = (match?.homeTeam?.players ?? []).map((player) => player.displayName).filter(Boolean);
  const awayLineup = (match?.awayTeam?.players ?? []).map((player) => player.displayName).filter(Boolean);
  const innings = [
    createEmptyCricketInnings({
      battingSide: firstBattingSide,
      bowlingSide: secondBattingSide,
      battingLineup: firstBattingSide === "HOME" ? homeLineup : awayLineup,
    }),
    createEmptyCricketInnings({
      battingSide: secondBattingSide,
      bowlingSide: firstBattingSide,
      target: null,
      battingLineup: secondBattingSide === "HOME" ? homeLineup : awayLineup,
    }),
  ];
  innings[0].currentPlayers = {
    strikerName: input.strikerName?.trim() ?? "",
    nonStrikerName: input.nonStrikerName?.trim() ?? "",
    bowlerName: input.bowlerName?.trim() ?? "",
  };

  return {
    status: "LIVE",
    formatOvers: tournament.oversPerInnings ?? null,
    tossWinnerSide,
    tossDecision,
    innings,
    activeInningsIndex: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

const buildCricketBallDisplay = (event) => {
  switch (event.type) {
    case "RUN":
      return `${event.batRuns ?? event.runs ?? 0}`;
    case "WICKET":
      if (event.dismissalType === CRICKET_DISMISSAL_TYPES.RETIRED_HURT) return "RH";
      if (event.dismissalType === CRICKET_DISMISSAL_TYPES.RETIRED_OUT) return "RO";
      return "W";
    case "WIDE":
      return event.totalRuns > 1 ? `WD${event.totalRuns}` : "WD";
    case "NO_BALL":
      return event.batRuns > 0 ? `NB+${event.batRuns}` : "NB";
    case "BYE":
      return `B${event.totalRuns ?? 0}`;
    case "LEG_BYE":
      return `LB${event.totalRuns ?? 0}`;
    default:
      return `${event.totalRuns ?? 0}`;
  }
};

const buildCricketDismissalText = (event) => {
  const dismissedPlayerName = event.dismissedPlayerName ?? event.strikerName ?? "Batter";
  switch (event.dismissalType) {
    case CRICKET_DISMISSAL_TYPES.CAUGHT:
      return `${dismissedPlayerName} c ${event.fielderName ?? "fielder"} b ${event.bowlerName ?? "bowler"}`;
    case CRICKET_DISMISSAL_TYPES.LBW:
      return `${dismissedPlayerName} lbw b ${event.bowlerName ?? "bowler"}`;
    case CRICKET_DISMISSAL_TYPES.RUN_OUT:
      return `${dismissedPlayerName} run out (${event.fielderName ?? "fielder"})`;
    case CRICKET_DISMISSAL_TYPES.STUMPED:
      return `${dismissedPlayerName} st ${event.fielderName ?? "keeper"} b ${event.bowlerName ?? "bowler"}`;
    case CRICKET_DISMISSAL_TYPES.HIT_WICKET:
      return `${dismissedPlayerName} hit wicket b ${event.bowlerName ?? "bowler"}`;
    case CRICKET_DISMISSAL_TYPES.RETIRED_OUT:
      return `${dismissedPlayerName} retired out`;
    case CRICKET_DISMISSAL_TYPES.RETIRED_HURT:
      return `${dismissedPlayerName} retired hurt`;
    case CRICKET_DISMISSAL_TYPES.BOWLED:
    default:
      return `${dismissedPlayerName} b ${event.bowlerName ?? "bowler"}`;
  }
};

const buildCricketCommentaryText = (event) => {
  switch (event.type) {
    case "RUN":
      return `${event.runs} ${event.runs === 1 ? "run" : "runs"} to ${event.strikerName}`;
    case "WICKET":
      return `Wicket! ${buildCricketDismissalText(event)}`;
    case "WIDE":
      return event.totalRuns > 1 ? `${event.totalRuns} wides from ${event.bowlerName}` : `Wide ball from ${event.bowlerName}`;
    case "NO_BALL":
      return event.batRuns > 0 ? `No ball and ${event.batRuns} off the bat to ${event.strikerName}` : `No ball by ${event.bowlerName}`;
    case "BYE":
      return `${event.totalRuns} ${event.totalRuns === 1 ? "bye" : "byes"}`;
    case "LEG_BYE":
      return `${event.totalRuns} leg bye${event.totalRuns === 1 ? "" : "s"}`;
    default:
      return "Ball recorded";
  }
};

const normalizeCricketBallEvent = (input, currentPlayers) => {
  const type = input.eventType;
  if (!type) throw AppError.validation("Choose a scoring event");
  const baseEvent = {
    id: randomUUID(),
    type,
    strikerName: currentPlayers.strikerName,
    bowlerName: currentPlayers.bowlerName,
    createdAt: new Date().toISOString(),
  };

  if (type === "RUN") {
    const runs = input.runs ?? 0;
    return { ...baseEvent, runs, batRuns: runs, totalRuns: runs, legalBall: true, wicket: false, extraType: null };
  }

  if (type === "WICKET") {
    const dismissalType = input.dismissalType ?? CRICKET_DISMISSAL_TYPES.BOWLED;
    const dismissedPlayerName = input.dismissedPlayerName?.trim() || currentPlayers.strikerName;
    const fielderName = input.fielderName?.trim() || null;
    const nextBatterName = input.nextBatterName?.trim() || null;
    const isRetiredHurt = dismissalType === CRICKET_DISMISSAL_TYPES.RETIRED_HURT;
    const isRetiredOut = dismissalType === CRICKET_DISMISSAL_TYPES.RETIRED_OUT;
    if (!dismissedPlayerName) {
      throw AppError.validation("Choose which batter got out");
    }
    if (CRICKET_DISMISSAL_TYPES_WITH_FIELDER.has(dismissalType) && !fielderName) {
      throw AppError.validation("Enter the fielder or keeper involved in the dismissal");
    }
    return {
      ...baseEvent,
      runs: 0,
      batRuns: 0,
      totalRuns: 0,
      legalBall: !(isRetiredHurt || isRetiredOut),
      wicket: !isRetiredHurt,
      extraType: null,
      dismissalType,
      dismissedPlayerName,
      fielderName,
      nextBatterName,
      bowlerGetsCredit: CRICKET_BOWLER_WICKET_TYPES.has(dismissalType),
    };
  }

  if (type === "WIDE") {
    const totalRuns = Math.max(1, input.totalRuns ?? input.runs ?? 1);
    return { ...baseEvent, runs: totalRuns, batRuns: 0, totalRuns, legalBall: false, wicket: false, extraType: "WD" };
  }

  if (type === "NO_BALL") {
    const batRuns = Math.max(0, input.batRuns ?? input.runs ?? 0);
    const totalRuns = Math.max(1, input.totalRuns ?? batRuns + 1);
    if (totalRuns < batRuns + 1) {
      throw AppError.validation("No ball total should include the automatic extra run");
    }
    return { ...baseEvent, runs: totalRuns, batRuns, totalRuns, legalBall: false, wicket: false, extraType: "NB" };
  }

  if (type === "BYE") {
    const totalRuns = Math.max(0, input.totalRuns ?? input.runs ?? 1);
    return { ...baseEvent, runs: totalRuns, batRuns: 0, totalRuns, legalBall: true, wicket: false, extraType: "B" };
  }

  const totalRuns = Math.max(0, input.totalRuns ?? input.runs ?? 1);
  return { ...baseEvent, runs: totalRuns, batRuns: 0, totalRuns, legalBall: true, wicket: false, extraType: "LB" };
};

const groupCricketEventsByOver = (events = []) => {
  const overs = [];
  let current = { overNumber: 1, balls: [] };
  let legalBallCount = 0;

  for (const event of events) {
    current.balls.push({
      id: event.id,
      label: buildCricketBallDisplay(event),
      commentary: event.commentary ?? buildCricketCommentaryText(event),
      legalBall: Boolean(event.legalBall),
      over: event.overLabel ?? null,
      totalRuns: event.totalRuns ?? 0,
    });

    if (event.legalBall) {
      legalBallCount += 1;
    }

    if (legalBallCount === 6) {
      overs.push(current);
      current = { overNumber: overs.length + 1, balls: [] };
      legalBallCount = 0;
    }
  }

  if (current.balls.length) {
    overs.push(current);
  }

  return overs;
};

const deriveCricketInningsSummary = (innings, formatOvers, teamSize = 11) => {
  const battingMap = new Map();
  const bowlingMap = new Map();
  const extras = { wide: 0, noBall: 0, bye: 0, legBye: 0, total: 0 };
  const fallOfWickets = [];
  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;

  for (const event of innings.events ?? []) {
    runs += Number(event.totalRuns ?? 0);
    if (event.legalBall) {
      legalBalls += 1;
    }
    if (event.wicket) {
      wickets += 1;
      fallOfWickets.push({
        wicketNumber: wickets,
        score: runs,
        over: formatBallsAsOvers(legalBalls),
        batterName: event.dismissedPlayerName ?? event.strikerName ?? "Batter",
        dismissalText: buildCricketDismissalText(event),
      });
    }

    if (event.extraType === "WD") extras.wide += event.totalRuns;
    if (event.extraType === "NB") extras.noBall += event.totalRuns;
    if (event.extraType === "B") extras.bye += event.totalRuns;
    if (event.extraType === "LB") extras.legBye += event.totalRuns;
    extras.total = extras.wide + extras.noBall + extras.bye + extras.legBye;

    if (event.strikerName) {
      const batting = battingMap.get(event.strikerName) ?? {
        name: event.strikerName,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        dismissalText: null,
        status: "Not out",
      };
      batting.runs += Number(event.batRuns ?? 0);
      if (event.legalBall) batting.balls += 1;
      if (event.batRuns === 4) batting.fours += 1;
      if (event.batRuns === 6) batting.sixes += 1;
      battingMap.set(event.strikerName, batting);
    }

    if (event.dismissedPlayerName && event.dismissalType) {
      const dismissed = battingMap.get(event.dismissedPlayerName) ?? {
        name: event.dismissedPlayerName,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        dismissalText: null,
        status: "Not out",
      };
      dismissed.dismissalText = buildCricketDismissalText(event);
      dismissed.status =
        event.dismissalType === CRICKET_DISMISSAL_TYPES.RETIRED_HURT
          ? "Retired hurt"
          : event.dismissalType === CRICKET_DISMISSAL_TYPES.RETIRED_OUT
            ? "Retired out"
            : "Out";
      battingMap.set(event.dismissedPlayerName, dismissed);
    }

    if (event.bowlerName) {
      const bowling = bowlingMap.get(event.bowlerName) ?? {
        name: event.bowlerName,
        legalBalls: 0,
        runs: 0,
        wickets: 0,
      };
      bowling.runs += Number(event.totalRuns ?? 0);
      if (event.legalBall) bowling.legalBalls += 1;
      if (event.wicket && event.bowlerGetsCredit !== false) bowling.wickets += 1;
      bowlingMap.set(event.bowlerName, bowling);
    }
  }

  const batting = [...battingMap.values()].map((player) => ({
    ...player,
    strikeRate: player.balls ? toOneDecimal((player.runs / player.balls) * 100) : null,
  }));
  const bowling = [...bowlingMap.values()].map((player) => ({
    name: player.name,
    overs: formatBallsAsOvers(player.legalBalls),
    runs: player.runs,
    wickets: player.wickets,
    economy: player.legalBalls ? toOneDecimal(player.runs / (player.legalBalls / 6)) : null,
  }));

  const currentPlayers = innings.currentPlayers ?? { strikerName: "", nonStrikerName: "", bowlerName: "" };
  batting.forEach((player) => {
    if ((player.name === currentPlayers.strikerName || player.name === currentPlayers.nonStrikerName) && player.status !== "Out") {
      player.status = "Batting";
    }
  });
  const didNotBat = (innings.battingLineup ?? []).filter((name) => name && !battingMap.has(name));

  const oversBreakdown = groupCricketEventsByOver(innings.events ?? []);

  return {
    battingSide: innings.battingSide,
    bowlingSide: innings.bowlingSide,
    target: innings.target ?? null,
    runs,
    wickets,
    overs: formatBallsAsOvers(legalBalls),
    legalBalls,
    ballsRemaining: Math.max((Number(formatOvers ?? 0) * 6) - legalBalls, 0),
    runRate: legalBalls ? toOneDecimal(runs / (legalBalls / 6)) : null,
    requiredRuns:
      innings.target && innings.target > runs
        ? innings.target - runs
        : 0,
    requiredRate:
      innings.target && innings.target > runs && Math.max((Number(formatOvers ?? 0) * 6) - legalBalls, 0) > 0
        ? toOneDecimal((innings.target - runs) / (Math.max((Number(formatOvers ?? 0) * 6) - legalBalls, 0) / 6))
        : null,
    allOut: wickets >= Math.max((teamSize ?? 11) - 1, 0),
    completed: Boolean(innings.completed),
    currentPlayers,
    batting,
    extras,
    fallOfWickets,
    didNotBat,
    bowling,
    oversBreakdown,
    currentOverBalls: oversBreakdown.at(-1)?.balls ?? [],
    commentary: [...(innings.events ?? [])]
      .slice(-18)
      .reverse()
      .map((event, index) => ({
        id: event.id ?? `${event.createdAt}-${index}`,
        text: event.commentary ?? buildCricketCommentaryText(event),
        over: event.overLabel ?? null,
        timestamp: event.createdAt,
      })),
  };
};

const deriveCricketLiveScore = (tournament, match) => {
  if (!isCricketSport(tournament?.sport) || !match?.liveScorecard) return null;
  const raw = match.liveScorecard;
  const formatOvers = Number(raw.formatOvers ?? tournament.oversPerInnings ?? 0);
  const innings = (raw.innings ?? []).map((inningsState) =>
    deriveCricketInningsSummary(inningsState, formatOvers, tournament.teamSize),
  );
  const teamScores = { HOME: null, AWAY: null };
  innings.forEach((inningsState) => {
    teamScores[inningsState.battingSide] = formatCricketInningsScore(inningsState.runs, inningsState.wickets, inningsState.overs);
  });

  const activeInningsIndex =
    typeof raw.activeInningsIndex === "number" && innings[raw.activeInningsIndex]
      ? raw.activeInningsIndex
      : innings.findIndex((inningsState) => !inningsState.completed);
  const currentInnings =
    activeInningsIndex >= 0 ? innings[activeInningsIndex] : innings.filter(Boolean).at(-1) ?? null;
  const battingTeamName =
    currentInnings?.battingSide === "HOME" ? match.homeTeam?.name : currentInnings?.battingSide === "AWAY" ? match.awayTeam?.name : null;
  const headline =
    battingTeamName && currentInnings
      ? `${battingTeamName} ${formatCricketInningsScore(currentInnings.runs, currentInnings.wickets, currentInnings.overs)}`
      : null;
  const summaryText = currentInnings
    ? currentInnings.target
      ? currentInnings.requiredRuns > 0
        ? `Need ${currentInnings.requiredRuns} from ${currentInnings.ballsRemaining} balls`
        : `Target ${currentInnings.target} chased`
      : currentInnings.runRate
        ? `CRR ${currentInnings.runRate}`
        : `${formatOvers}-over innings`
    : null;

  const firstInnings = innings[0];
  const secondInnings = innings[1];
  const finalResultCandidate =
    firstInnings?.completed && secondInnings?.completed
      ? {
          homeScore: firstInnings.battingSide === "HOME" ? firstInnings.runs : secondInnings.runs,
          awayScore: firstInnings.battingSide === "AWAY" ? firstInnings.runs : secondInnings.runs,
          homeWickets: firstInnings.battingSide === "HOME" ? firstInnings.wickets : secondInnings.wickets,
          awayWickets: firstInnings.battingSide === "AWAY" ? firstInnings.wickets : secondInnings.wickets,
          homeOvers: firstInnings.battingSide === "HOME" ? firstInnings.overs : secondInnings.overs,
          awayOvers: firstInnings.battingSide === "AWAY" ? firstInnings.overs : secondInnings.overs,
          battingFirstSide: firstInnings.battingSide,
          matchOutcome: CRICKET_MATCH_OUTCOMES.NORMAL,
        }
      : null;

  return {
    status: raw.status ?? "LIVE",
    formatOvers,
    tossWinnerSide: raw.tossWinnerSide ?? null,
    tossDecision: raw.tossDecision ?? null,
    activeInningsIndex: activeInningsIndex >= 0 ? activeInningsIndex : null,
    innings,
    currentInnings,
    teamScores,
    headline,
    summaryText,
    finalResultCandidate,
    updatedAt: raw.updatedAt ?? null,
  };
};

const ensureLiveScoringPlayers = (innings) => {
  const currentPlayers = innings.currentPlayers ?? {};
  if (!currentPlayers.strikerName || !currentPlayers.nonStrikerName || !currentPlayers.bowlerName) {
    throw AppError.validation("Set striker, non-striker, and bowler before scoring the next ball");
  }
  return currentPlayers;
};

const mutateCricketLiveScorecard = (tournament, match, input) => {
  if (!isCricketSport(tournament?.sport)) {
    throw AppError.validation("Live scorer is available only for cricket tournaments");
  }

  if (input.action === "INIT") {
    if (!input.tossWinnerSide || !input.tossDecision || !input.strikerName || !input.nonStrikerName || !input.bowlerName) {
      throw AppError.validation("Enter toss details and current striker, non-striker, and bowler");
    }
    return {
      scorecard: createCricketLiveScorecard(tournament, match, input),
      matchStatus: "LIVE",
    };
  }

  const scorecard = match.liveScorecard ? structuredClone(match.liveScorecard) : null;
  if (!scorecard) {
    throw AppError.validation("Start live scoring first");
  }

  const inningsList = scorecard.innings ?? [];
  const activeIndex =
    typeof scorecard.activeInningsIndex === "number" && inningsList[scorecard.activeInningsIndex]
      ? scorecard.activeInningsIndex
      : 0;
  const activeInnings = inningsList[activeIndex];
  if (!activeInnings) throw AppError.validation("Active innings is not available");

  if (input.action === "SET_PLAYERS") {
    if (!input.strikerName || !input.nonStrikerName || !input.bowlerName) {
      throw AppError.validation("Enter striker, non-striker, and bowler");
    }
    activeInnings.currentPlayers = {
      strikerName: input.strikerName.trim(),
      nonStrikerName: input.nonStrikerName.trim(),
      bowlerName: input.bowlerName.trim(),
    };
    scorecard.status = "LIVE";
    scorecard.updatedAt = new Date().toISOString();
    return { scorecard, matchStatus: "LIVE" };
  }

  if (input.action === "UNDO_BALL") {
    const inningsWithEventsIndex =
      (inningsList[activeIndex]?.events?.length ?? 0) > 0
        ? activeIndex
        : inningsList.findLastIndex((item) => (item.events?.length ?? 0) > 0);
    if (inningsWithEventsIndex < 0) {
      throw AppError.validation("No scored ball is available to undo");
    }
    const targetInnings = inningsList[inningsWithEventsIndex];
    targetInnings.events.pop();
    targetInnings.completed = false;
    targetInnings.completedAt = null;
    scorecard.activeInningsIndex = inningsWithEventsIndex;
    scorecard.status = "LIVE";
    scorecard.updatedAt = new Date().toISOString();
    return { scorecard, matchStatus: "LIVE" };
  }

  if (input.action === "END_INNINGS") {
    const summary = deriveCricketInningsSummary(activeInnings, scorecard.formatOvers, tournament.teamSize);
    activeInnings.completed = true;
    activeInnings.completedAt = new Date().toISOString();

    if (activeIndex === 0 && inningsList[1]) {
      inningsList[1].target = summary.runs + 1;
      scorecard.activeInningsIndex = 1;
      scorecard.status = "INNINGS_BREAK";
    } else {
      scorecard.activeInningsIndex = null;
      scorecard.status = "READY_TO_PUBLISH";
    }

    scorecard.updatedAt = new Date().toISOString();
    return { scorecard, matchStatus: "LIVE" };
  }

  if (input.action === "ADD_BALL") {
    const currentPlayers = ensureLiveScoringPlayers(activeInnings);
    const event = normalizeCricketBallEvent(input, currentPlayers);
    const legalBallsBefore = activeInnings.events.filter((item) => item.legalBall).length;
    const legalBallsAfter = legalBallsBefore + (event.legalBall ? 1 : 0);
    event.overLabel = event.legalBall ? formatBallsAsOvers(legalBallsAfter) : formatBallsAsOvers(legalBallsBefore);
    event.commentary = buildCricketCommentaryText(event);
    activeInnings.events.push(event);

    const nextPlayers = { ...currentPlayers };
    const overCompleted = event.legalBall && legalBallsAfter % 6 === 0;
    const oddRunsRotate = ["RUN", "BYE", "LEG_BYE"].includes(event.type) && event.totalRuns % 2 === 1;

    if (event.type === "WICKET") {
      const dismissedIsStriker = event.dismissedPlayerName === currentPlayers.strikerName;
      const dismissedIsNonStriker = event.dismissedPlayerName === currentPlayers.nonStrikerName;

      if (dismissedIsStriker) {
        if (overCompleted) {
          nextPlayers.strikerName = currentPlayers.nonStrikerName;
          nextPlayers.nonStrikerName = event.nextBatterName ?? "";
          nextPlayers.bowlerName = "";
        } else {
          nextPlayers.strikerName = event.nextBatterName ?? "";
        }
      } else if (dismissedIsNonStriker) {
        if (overCompleted) {
          nextPlayers.strikerName = event.nextBatterName ?? "";
          nextPlayers.nonStrikerName = currentPlayers.strikerName;
          nextPlayers.bowlerName = "";
        } else {
          nextPlayers.nonStrikerName = event.nextBatterName ?? "";
        }
      } else if (overCompleted) {
        nextPlayers.strikerName = currentPlayers.nonStrikerName;
        nextPlayers.nonStrikerName = event.nextBatterName ?? "";
        nextPlayers.bowlerName = "";
      } else {
        nextPlayers.strikerName = event.nextBatterName ?? "";
      }
    } else {
      if (oddRunsRotate) {
        [nextPlayers.strikerName, nextPlayers.nonStrikerName] = [nextPlayers.nonStrikerName, nextPlayers.strikerName];
      }
      if (overCompleted) {
        [nextPlayers.strikerName, nextPlayers.nonStrikerName] = [nextPlayers.nonStrikerName, nextPlayers.strikerName];
        nextPlayers.bowlerName = "";
      }
    }

    activeInnings.currentPlayers = nextPlayers;
    const summary = deriveCricketInningsSummary(activeInnings, scorecard.formatOvers, tournament.teamSize);
    const oversBallLimit = Number(scorecard.formatOvers ?? tournament.oversPerInnings ?? 0) * 6;
    const firstInningsDone = summary.allOut || (oversBallLimit > 0 && summary.legalBalls >= oversBallLimit);
    const chaseDone =
      activeIndex === 1 &&
      (summary.allOut || (oversBallLimit > 0 && summary.legalBalls >= oversBallLimit) || (summary.target && summary.runs >= summary.target));

    if (activeIndex === 0 && firstInningsDone) {
      activeInnings.completed = true;
      activeInnings.completedAt = new Date().toISOString();
      if (inningsList[1]) {
        inningsList[1].target = summary.runs + 1;
      }
      scorecard.activeInningsIndex = 1;
      scorecard.status = "INNINGS_BREAK";
    } else if (activeIndex === 1 && chaseDone) {
      activeInnings.completed = true;
      activeInnings.completedAt = new Date().toISOString();
      scorecard.activeInningsIndex = null;
      scorecard.status = "READY_TO_PUBLISH";
    } else {
      scorecard.status = "LIVE";
    }

    scorecard.updatedAt = new Date().toISOString();
    return { scorecard, matchStatus: "LIVE" };
  }

  throw AppError.validation("Unsupported live scoring action");
};

const serializeTurf = (turf) =>
  turf
    ? {
        id: turf.id,
        turfName: turf.name,
        city: turf.city,
        address: turf.address,
      }
    : null;

const slugifyTournamentTitle = (value = "") =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tournament";

const buildTournamentSlug = (tournament) => `${slugifyTournamentTitle(tournament.title)}-${tournament.id}`;
const extractTournamentId = (value = "") => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const maybeId = trimmed.split("-").at(-1);
  return maybeId?.startsWith("cm") ? maybeId : trimmed;
};

const serializePlayer = (player) => ({
  id: player.id,
  userId: player.userId,
  displayName: player.displayName,
  email: player.email,
  isSubstitute: Boolean(player.isSubstitute),
  jerseyNo: player.jerseyNo,
  position: player.position,
  hp: player.hp,
  totalScore: player.totalScore,
});

const serializeTeam = (team) => ({
  id: team.id,
  userTeamId: team.userTeamId ?? null,
  logoUrl: team.userTeam?.logoUrl ?? null,
  name: team.name,
  status: team.status,
  seed: team.seed,
  registeredMainPlayerCount: team.registeredMainPlayerCount ?? 0,
  mainPlayerTarget: team.mainPlayerTarget ?? 0,
  discountPercentApplied: team.discountPercentApplied ?? 0,
  discountAmount: team.discountAmount ?? 0,
  finalEntryFee: team.finalEntryFee ?? 0,
  createdAt: team.createdAt,
  owner: team.owner
    ? {
        id: team.owner.id,
        firstName: team.owner.firstName,
        lastName: team.owner.lastName,
        email: team.owner.email,
        phone: team.owner.phone,
      }
    : undefined,
  players: team.players?.map(serializePlayer) ?? [],
});

const serializeTournamentRegistrationOffer = (offerSetting) =>
  offerSetting
    ? {
        isEnabled: offerSetting.isEnabled,
        discountPercent: offerSetting.discountPercent,
      }
    : null;

const resolveTournamentRegistrationOffer = (tournament, globalOfferSetting) => {
  if (!tournament) return null;

  if (tournament.registrationOfferMode === "CUSTOM") {
    return {
      source: "CUSTOM",
      isEnabled: Boolean(tournament.registrationOfferEnabled),
      discountPercent: tournament.registrationOfferEnabled ? tournament.registrationOfferDiscountPercent ?? 0 : 0,
    };
  }

  if (tournament.registrationOfferMode === "DISABLED") {
    return {
      source: "DISABLED",
      isEnabled: false,
      discountPercent: 0,
    };
  }

  return {
    source: "GLOBAL",
    ...(serializeTournamentRegistrationOffer(globalOfferSetting) ?? { isEnabled: false, discountPercent: 0 }),
  };
};

const serializeMatch = (match, tournament) => {
  const { stage, userNote } = parseMatchStage(match.resultNote);
  const sport = tournament?.sport ?? match.sport;
  const teamSize = tournament?.teamSize ?? 11;
  const liveScore = deriveCricketLiveScore(tournament, match);
  return {
    id: match.id,
    round: match.round,
    stage,
    scheduledAt: match.scheduledAt,
    status: match.status,
    matchOutcome: match.matchOutcome ?? CRICKET_MATCH_OUTCOMES.NORMAL,
    matchOutcomeLabel: isCricketSport(sport) ? getCricketMatchOutcomeLabel(match.matchOutcome) : null,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeWickets: match.homeWickets,
    awayWickets: match.awayWickets,
    homeOvers: match.homeOvers,
    awayOvers: match.awayOvers,
    battingFirstSide: match.battingFirstSide ?? null,
    resultNote: userNote,
    isCricket: isCricketSport(sport),
    homeScorecard:
      isCricketSport(sport) && !isSharedPointsOutcome(match.matchOutcome)
        ? formatCricketInningsScore(match.homeScore, match.homeWickets, match.homeOvers)
        : null,
    awayScorecard:
      isCricketSport(sport) && !isSharedPointsOutcome(match.matchOutcome)
        ? formatCricketInningsScore(match.awayScore, match.awayWickets, match.awayOvers)
        : null,
    resultSummary: getCricketResultSummary({ ...match, sport }, teamSize),
    liveScore,
    completedAt: match.completedAt,
    homeTeam: match.homeTeam
      ? { id: match.homeTeam.id, name: match.homeTeam.name, logoUrl: match.homeTeam.userTeam?.logoUrl ?? null }
      : undefined,
    awayTeam: match.awayTeam
      ? { id: match.awayTeam.id, name: match.awayTeam.name, logoUrl: match.awayTeam.userTeam?.logoUrl ?? null }
      : undefined,
  };
};

const serializeStanding = (standing) => ({
  id: standing.id,
  teamId: standing.teamId,
  teamName: standing.team?.name,
  logoUrl: standing.team?.userTeam?.logoUrl ?? null,
  played: standing.played,
  wins: standing.wins,
  draws: standing.draws,
  losses: standing.losses,
  points: standing.points,
  scoreFor: standing.scoreFor,
  scoreAgainst: standing.scoreAgainst,
  scoreDiff: standing.scoreDiff,
  updatedAt: standing.updatedAt,
});

const serializeTournament = (tournament, offerSetting = null) => ({
  champion: getTournamentChampion(tournament),
  id: tournament.id,
  slug: buildTournamentSlug(tournament),
  tournamentCode: tournament.tournamentCode,
  title: tournament.title,
  description: tournament.description,
  coverImageUrl: tournament.coverImageUrl,
  sport: tournament.sport,
  status: tournament.status,
  fixtureType: tournament.fixtureType,
  startDate: tournament.startDate,
  endDate: tournament.endDate,
  oversPerInnings: tournament.oversPerInnings ?? null,
  maxTeams: tournament.maxTeams,
  teamSize: tournament.teamSize,
  substituteCount: tournament.substituteCount ?? 0,
  entryFeePerTeam: tournament.entryFeePerTeam,
  registrationOfferMode: tournament.registrationOfferMode ?? "GLOBAL",
  pointsForWin: tournament.pointsForWin,
  pointsForDraw: tournament.pointsForDraw,
  createdAt: tournament.createdAt,
  updatedAt: tournament.updatedAt,
  registrationOffer: resolveTournamentRegistrationOffer(tournament, offerSetting),
  host: tournament.host
    ? {
        id: tournament.host.id,
        firstName: tournament.host.firstName,
        lastName: tournament.host.lastName,
        email: tournament.host.email,
        roles: tournament.host.roles?.map((item) => item.role.name) ?? [],
      }
    : undefined,
  turf: serializeTurf(tournament.turf),
  teams: tournament.teams?.map(serializeTeam) ?? [],
  joinedTeamCount: tournament.teams?.filter((team) => team.status === "JOINED").length ?? 0,
  draftTeamCount: tournament.teams?.filter((team) => team.status === "DRAFT").length ?? 0,
  matches: tournament.matches?.map((match) => serializeMatch(match, tournament)) ?? [],
  standings:
    sortStandingsTable(tournament.standings?.map(serializeStanding) ?? []),
});

const sortTeamsForFixtures = (teams) =>
  [...teams].sort(
    (a, b) =>
      (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      a.name.localeCompare(b.name),
  );

const sortStandingsTable = (standings = []) =>
  [...standings].sort(
    (a, b) =>
      b.points - a.points ||
      b.scoreDiff - a.scoreDiff ||
      b.scoreFor - a.scoreFor ||
      a.teamName?.localeCompare(b.teamName ?? "") ||
      0,
  );

const assertTournamentPlayersAvailable = async (transaction, { tournamentId, linkedRoster, excludeTeamId = null }) => {
  const emails = [...new Set(linkedRoster.map((player) => player.email).filter(Boolean))];
  const userIds = [...new Set(linkedRoster.map((player) => player.userId).filter(Boolean))];
  if (!emails.length && !userIds.length) return;

  const conflictingPlayer = await transaction.tournamentPlayer.findFirst({
    where: {
      team: {
        tournamentId,
        status: { in: ["JOINED", "DRAFT"] },
        ...(excludeTeamId ? { id: { not: excludeTeamId } } : {}),
      },
      OR: [
        ...(emails.length ? [{ email: { in: emails } }] : []),
        ...(userIds.length ? [{ userId: { in: userIds } }] : []),
      ],
    },
    include: { team: { select: { name: true } } },
  });

  if (conflictingPlayer) {
    throw AppError.conflict(`This player is already added to ${conflictingPlayer.team?.name ?? "another team"} in this tournament`);
  }
};

const nextPowerOfTwo = (value) => 2 ** Math.ceil(Math.log2(value));
const isPlayoffStage = (stage) => stage === PLAYOFF_STAGES.SEMIFINAL || stage === PLAYOFF_STAGES.FINAL;
const isPlayoffMatch = (match) => isPlayoffStage(parseMatchStage(match.resultNote).stage);

const buildChampionPayload = (team, source) =>
  team
    ? {
        teamId: team.id,
        teamName: team.name,
        source,
      }
    : null;

const getTournamentChampion = (tournament) => {
  if (!tournament || tournament.status !== "COMPLETED") return null;

  const finalPlayoffMatch = tournament.matches?.find(
    (match) => parseMatchStage(match.resultNote).stage === PLAYOFF_STAGES.FINAL && match.status === "COMPLETED",
  );
  if (finalPlayoffMatch) {
    const winnerId = getKnockoutWinnerId(finalPlayoffMatch);
    const winnerTeam = tournament.teams?.find((team) => team.id === winnerId);
    return buildChampionPayload(winnerTeam, PLAYOFF_STAGES.FINAL);
  }

  if (tournament.fixtureType === "KNOCKOUT" && tournament.matches?.length) {
    const finalKnockoutMatch = [...tournament.matches]
      .filter((match) => match.status === "COMPLETED")
      .sort((a, b) => (b.round ?? 0) - (a.round ?? 0))[0];
    if (finalKnockoutMatch) {
      const winnerId = getKnockoutWinnerId(finalKnockoutMatch);
      const winnerTeam = tournament.teams?.find((team) => team.id === winnerId);
      return buildChampionPayload(winnerTeam, "KNOCKOUT_FINAL");
    }
  }

  const topStanding = sortStandingsTable(tournament.standings?.map(serializeStanding) ?? [])[0];
  if (topStanding) {
    return buildChampionPayload({ id: topStanding.teamId, name: topStanding.teamName }, "LEAGUE_TOP");
  }

  return null;
};

const pairTeamsForMatch = (existingMatches, tournamentId, homeTeamId, awayTeamId, round, stage) => {
  const orderedPairExists = existingMatches.some(
    (match) => match.homeTeamId === homeTeamId && match.awayTeamId === awayTeamId,
  );
  const reversePairExists = existingMatches.some(
    (match) => match.homeTeamId === awayTeamId && match.awayTeamId === homeTeamId,
  );

  if (!orderedPairExists) {
    return {
      tournamentId,
      homeTeamId,
      awayTeamId,
      round,
      resultNote: buildMatchResultNote(stage),
    };
  }

  if (!reversePairExists) {
    return {
      tournamentId,
      homeTeamId: awayTeamId,
      awayTeamId: homeTeamId,
      round,
      resultNote: buildMatchResultNote(stage),
    };
  }

  throw AppError.conflict("A playoff rematch could not be created because both team orders already exist in this tournament");
};

const buildLeagueFixtures = (tournamentId, teams) => {
  const fixtures = [];
  let round = 1;
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      fixtures.push({
        tournamentId,
        homeTeamId: teams[i].id,
        awayTeamId: teams[j].id,
        round,
      });
      round += 1;
    }
  }
  return fixtures;
};

const buildKnockoutOpeningFixtures = (tournamentId, teams) => {
  const orderedTeams = sortTeamsForFixtures(teams);
  const byeCount = nextPowerOfTwo(orderedTeams.length) - orderedTeams.length;
  const openingRoundTeams = orderedTeams.slice(byeCount);
  const fixtures = [];

  for (let index = 0; index < openingRoundTeams.length; index += 2) {
    fixtures.push({
      tournamentId,
      homeTeamId: openingRoundTeams[index].id,
      awayTeamId: openingRoundTeams[index + 1].id,
      round: 1,
    });
  }

  return fixtures;
};

function getKnockoutWinnerId(match) {
  if (isSharedPointsOutcome(match.matchOutcome)) return null;
  if (match.homeScore === null || match.awayScore === null) return null;
  if (match.homeScore === match.awayScore) return null;
  return match.homeScore > match.awayScore ? match.homeTeamId : match.awayTeamId;
}

const tournamentInclude = {
  host: {
    include: {
      roles: {
        include: {
          role: true,
        },
      },
    },
  },
  turf: true,
  teams: {
    include: {
      owner: true,
      userTeam: true,
      players: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  },
  matches: {
    include: { homeTeam: { include: { userTeam: true } }, awayTeam: { include: { userTeam: true } } },
    orderBy: [{ round: "asc" }, { createdAt: "asc" }],
  },
  standings: {
    include: { team: { include: { userTeam: true } } },
    orderBy: [{ points: "desc" }, { scoreDiff: "desc" }, { scoreFor: "desc" }],
  },
};

const ensureTournament = async (tournamentId) => {
  const resolvedId = extractTournamentId(tournamentId);
  const tournament = await prisma.tournament.findUnique({
    where: { id: resolvedId },
    include: tournamentInclude,
  });
  if (!tournament) throw AppError.notFound("Tournament");
  return tournament;
};

const ensureHost = (tournament, userId) => {
  if (tournament.hostUserId !== userId) throw AppError.forbidden("Only the tournament host can do this");
};

export const listTournaments = async ({ sport, status, city }) => {
  const offerSetting = await getTournamentRegistrationOfferRecord();
  const tournaments = await prisma.tournament.findMany({
    where: {
      ...(sport ? { sport: { equals: sport, mode: "insensitive" } } : {}),
      ...(status ? { status } : {}),
      ...(city ? { turf: { city: { contains: city, mode: "insensitive" } } } : {}),
    },
    include: tournamentInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return tournaments.map((tournament) => serializeTournament(tournament, offerSetting));
};

export const listOwnerTournaments = async (ownerUserId, filters = {}) => {
  const offerSetting = await getTournamentRegistrationOfferRecord();
  const tournaments = await prisma.tournament.findMany({
    where: {
      hostUserId: ownerUserId,
      ...(filters.sport ? { sport: { equals: filters.sport, mode: "insensitive" } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: tournamentInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return tournaments.map((tournament) => serializeTournament(tournament, offerSetting));
};

const serializeTournamentEntryPayment = (payment) => ({
  id: payment.id,
  status: payment.status,
  amount: payment.amount,
  discountAmount: payment.discountAmount,
  finalEntryFee: payment.finalEntryFee,
  paymentProvider: payment.paymentProvider,
  paymentOrderId: payment.paymentOrderId,
  paymentId: payment.paymentId,
  paymentCapturedAt: payment.paymentCapturedAt,
  payoutTargetType: payment.payoutTargetType,
  payoutStatus: payment.payoutStatus,
  payoutMethod: payment.payoutMethod,
  payoutReference: payment.payoutReference,
  razorpayPayoutId: payment.razorpayPayoutId,
  payoutReleasedAt: payment.payoutReleasedAt,
  payoutFailureReason: payment.payoutFailureReason,
  refunds: (payment.refunds ?? []).map(serializeTournamentEntryRefund),
  createdAt: payment.createdAt,
  tournament: payment.tournament
    ? {
        id: payment.tournament.id,
        tournamentCode: payment.tournament.tournamentCode,
        title: payment.tournament.title,
        sport: payment.tournament.sport,
        status: payment.tournament.status,
        host: payment.tournament.host
          ? {
              id: payment.tournament.host.id,
              name: [payment.tournament.host.firstName, payment.tournament.host.lastName].filter(Boolean).join(" ").trim(),
              email: payment.tournament.host.email,
            }
          : null,
        turf: payment.tournament.turf
          ? {
              id: payment.tournament.turf.id,
              turfName: payment.tournament.turf.turfName,
              city: payment.tournament.turf.city,
            }
          : null,
      }
    : null,
  team: payment.team
    ? {
        id: payment.team.id,
        name: payment.team.name,
      }
    : null,
  payer: payment.payer
    ? {
        id: payment.payer.id,
        name: [payment.payer.firstName, payment.payer.lastName].filter(Boolean).join(" ").trim(),
        email: payment.payer.email,
        phone: payment.payer.phone,
      }
    : null,
  payoutRecipient: payment.payoutRecipient
    ? {
        id: payment.payoutRecipient.id,
        name: [payment.payoutRecipient.firstName, payment.payoutRecipient.lastName].filter(Boolean).join(" ").trim(),
        email: payment.payoutRecipient.email,
        payoutMethod: payment.payoutRecipient.payoutMethod,
        payoutUpiId: payment.payoutRecipient.payoutUpiId,
      }
    : null,
});

export const listTournamentEntryPayments = async ({
  page = 1,
  limit = 20,
  search,
  payoutTargetType,
  payoutStatus,
  ownerUserId,
} = {}) => {
  await syncTournamentEntryPaymentLifecycle({ ownerUserId });
  const trimmedSearch = search?.trim();
  const where = {
    ...(ownerUserId ? { payoutTargetType: "TURF_OWNER", payoutRecipientUserId: ownerUserId } : {}),
    ...(payoutTargetType && !ownerUserId ? { payoutTargetType } : {}),
    ...(payoutStatus ? { payoutStatus } : {}),
    ...(trimmedSearch
      ? {
          OR: [
            { paymentId: { contains: trimmedSearch, mode: "insensitive" } },
            { paymentOrderId: { contains: trimmedSearch, mode: "insensitive" } },
            { tournament: { title: { contains: trimmedSearch, mode: "insensitive" } } },
            { tournament: { tournamentCode: { contains: trimmedSearch, mode: "insensitive" } } },
            { team: { name: { contains: trimmedSearch, mode: "insensitive" } } },
            { payer: { email: { contains: trimmedSearch, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [payments, total, metrics] = await Promise.all([
    prisma.tournamentEntryPayment.findMany({
      where,
      include: {
        tournament: {
          include: {
            host: true,
            turf: true,
          },
        },
        team: true,
        payer: true,
        payoutRecipient: true,
        refunds: { orderBy: { requestedAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.tournamentEntryPayment.count({ where }),
    prisma.tournamentEntryPayment.aggregate({
      where,
      _sum: {
        amount: true,
        discountAmount: true,
        finalEntryFee: true,
      },
      _count: { id: true },
    }),
  ]);

  return {
    payments: payments.map(serializeTournamentEntryPayment),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    metrics: {
      count: metrics._count.id,
      grossAmount: metrics._sum.amount ?? 0,
      discountAmount: metrics._sum.discountAmount ?? 0,
      collectedAmount: metrics._sum.finalEntryFee ?? 0,
    },
  };
};

export const getTournament = async (tournamentId) =>
  serializeTournament(await ensureTournament(tournamentId), await getTournamentRegistrationOfferRecord());

export const createTournament = async (userId, input) => {
  if (input.turfId) {
    const turf = await prisma.turf.findFirst({
      where: { id: input.turfId, status: "APPROVED", isActive: true },
    });
    if (!turf) throw AppError.notFound("Approved turf");
    if (!turf.sports.some((sport) => sport.toLowerCase() === input.sport.toLowerCase())) {
      throw AppError.validation("Sport must be available at this venue");
    }
  }

  const tournament = await prisma.tournament.create({
    data: {
      tournamentCode: tournamentCode(),
      hostUserId: userId,
      turfId: input.turfId ?? null,
      title: input.title,
      description: input.description || null,
      coverImageUrl: input.coverImageUrl || null,
      sport: input.sport,
      fixtureType: input.fixtureType ?? "LEAGUE",
      startDate: input.startDate ? new Date(`${input.startDate}T00:00:00+05:30`) : null,
      endDate: input.endDate ? new Date(`${input.endDate}T00:00:00+05:30`) : null,
      oversPerInnings: isCricketSport(input.sport) ? input.oversPerInnings ?? null : null,
      maxTeams: input.maxTeams,
      teamSize: input.teamSize,
      substituteCount: input.substituteCount ?? 0,
      entryFeePerTeam: input.entryFeePerTeam ?? 0,
      registrationOfferMode: input.registrationOfferMode ?? "GLOBAL",
      registrationOfferEnabled:
        input.registrationOfferMode === "CUSTOM" ? Boolean(input.registrationOfferEnabled) : null,
      registrationOfferDiscountPercent:
        input.registrationOfferMode === "CUSTOM" && input.registrationOfferEnabled
          ? input.registrationOfferDiscountPercent ?? null
          : null,
      pointsForWin: input.pointsForWin ?? 3,
      pointsForDraw: input.pointsForDraw ?? 1,
    },
    include: tournamentInclude,
  });

  notifyUsersForTournament(tournament.id)
    .then((result) => logger.info({ tournamentId: tournament.id, ...result }, "Tournament notifications processed"))
    .catch((error) => logger.error({ error, tournamentId: tournament.id }, "Tournament notifications failed"));

  return serializeTournament(tournament, await getTournamentRegistrationOfferRecord());
};

export const createOwnerTournament = async (ownerUserId, input) => {
  const turf = await prisma.turf.findFirst({
    where: {
      id: input.turfId,
      ownerUserId,
      createdById: ownerUserId,
      status: "APPROVED",
      isActive: true,
    },
  });
  if (!turf) throw AppError.notFound("Owned approved turf");
  if (!turf.sports.some((sport) => sport.toLowerCase() === input.sport.toLowerCase())) {
    throw AppError.validation("Sport must be available at this venue");
  }

  return createTournament(ownerUserId, input);
};

const joinedTeamsCount = (tournament) => tournament.teams.filter((team) => team.status === "JOINED").length;
const countJoinedTeamsInTransaction = async (transaction, tournamentId, excludeTeamId = null) =>
  transaction.tournamentTeam.count({
    where: {
      tournamentId,
      status: "JOINED",
      ...(excludeTeamId ? { id: { not: excludeTeamId } } : {}),
    },
  });

const assertTournamentJoinWindow = async (
  transaction,
  { tournamentId, ownerUserId, maxTeams, excludeTeamId = null },
) => {
  const [joinedCount, existingOwnerJoin] = await Promise.all([
    countJoinedTeamsInTransaction(transaction, tournamentId, excludeTeamId),
    transaction.tournamentTeam.findFirst({
      where: {
        tournamentId,
        ownerUserId,
        status: "JOINED",
        ...(excludeTeamId ? { id: { not: excludeTeamId } } : {}),
      },
      select: { id: true },
    }),
  ]);

  if (existingOwnerJoin) {
    throw AppError.validation("You already joined this tournament");
  }
  if (joinedCount >= maxTeams) {
    throw AppError.conflict("Tournament team limit reached");
  }

  return joinedCount;
};

const isTeamOwnedByUser = (team, userId) =>
  team.ownerUserId === userId || team.players?.some((player) => player.userId === userId);
const hasUserJoinedTournament = (tournament, userId) =>
  tournament.teams.some(
    (team) =>
      team.status === "JOINED" &&
      isTeamOwnedByUser(team, userId),
  );

const normalizePlayerEmail = (email) => {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
};

const reusableTeamRoleOrder = {
  CAPTAIN: 0,
  VICE_CAPTAIN: 1,
  PLAYER: 2,
};

const getCheckoutCustomer = (userId) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });

const resolveTournamentPayoutTarget = (tournament) => {
  const hostRoles = tournament.host?.roles?.map((entry) => entry.role.name) ?? [];
  if (hostRoles.includes("TURF_OWNER")) {
    return {
      payoutTargetType: "TURF_OWNER",
      payoutRecipientUserId: tournament.hostUserId,
    };
  }
  return {
    payoutTargetType: "PLATFORM",
    payoutRecipientUserId: null,
  };
};

const mapTournamentRefundStatus = (status) => {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "processed") return "PROCESSED";
  if (normalized === "failed") return "FAILED";
  return "CREATED";
};

const serializeTournamentEntryRefund = (refund) => ({
  id: refund.id,
  amount: refund.amount,
  currency: refund.currency,
  receipt: refund.receipt,
  razorpayPaymentId: refund.razorpayPaymentId,
  razorpayRefundId: refund.razorpayRefundId,
  status: refund.status,
  failureReason: refund.failureReason,
  requestedAt: refund.requestedAt,
  processedAt: refund.processedAt,
  failedAt: refund.failedAt,
});

const mapTournamentPayoutResultStatus = (status) => {
  switch (String(status ?? "").toLowerCase()) {
    case "processed":
      return TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_SENT;
    case "queued":
    case "pending":
    case "processing":
      return TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_PROCESSING;
    case "reversed":
      return TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_REVERSED;
    case "rejected":
    case "failed":
      return TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_FAILED;
    default:
      return TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_PROCESSING;
  }
};

const getTournamentPayoutContactPayload = (payment) => {
  const recipient = payment.payoutRecipient;
  return {
    name: [recipient?.firstName, recipient?.lastName].filter(Boolean).join(" ").trim() || "Turf owner",
    email: recipient?.email?.trim() || undefined,
    phone: recipient?.phone?.trim() || undefined,
    referenceId: `tournament-owner-${recipient?.id ?? payment.payoutRecipientUserId}`.slice(0, 40),
  };
};

const getTournamentPayoutFundAccountPayload = (payment) => {
  const recipient = payment.payoutRecipient;
  return {
    payoutMethod: recipient?.payoutMethod,
    accountHolderName:
      recipient?.payoutAccountHolderName?.trim() ||
      [recipient?.firstName, recipient?.lastName].filter(Boolean).join(" ").trim() ||
      "Turf owner",
    bankName: recipient?.payoutBankName?.trim() || undefined,
    accountNumber: recipient?.payoutAccountNumber?.trim() || undefined,
    ifscCode: recipient?.payoutIfscCode?.trim() || undefined,
    upiId: recipient?.payoutUpiId?.trim() || undefined,
  };
};

const assertTournamentPayoutDetails = (payment) => {
  const recipient = payment.payoutRecipient;
  if (!recipient) throw AppError.validation("Turf owner payout recipient is missing");
  if (!recipient.payoutMethod) throw AppError.validation("Turf owner payout method is missing");
  if (recipient.payoutMethod === "UPI" && !recipient.payoutUpiId?.trim()) {
    throw AppError.validation("Turf owner UPI ID is missing");
  }
  if (
    recipient.payoutMethod === "BANK_ACCOUNT" &&
    (!recipient.payoutAccountHolderName?.trim() || !recipient.payoutAccountNumber?.trim() || !recipient.payoutIfscCode?.trim())
  ) {
    throw AppError.validation("Turf owner bank payout details are incomplete");
  }
};

const markTournamentEntryPaymentsForStatus = async (transaction, tournamentId, tournamentStatus) => {
  if (tournamentStatus === "ACTIVE") {
    await transaction.tournamentEntryPayment.updateMany({
      where: {
        tournamentId,
        payoutTargetType: "TURF_OWNER",
        payoutStatus: { in: ["PENDING", TOURNAMENT_ENTRY_PAYOUT_STATUS.HELD_IN_PLATFORM] },
      },
      data: { payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.LOCKED_AFTER_START },
    });
  }

  if (tournamentStatus === "COMPLETED") {
    await transaction.tournamentEntryPayment.updateMany({
      where: {
        tournamentId,
        payoutTargetType: "TURF_OWNER",
        payoutStatus: {
          in: [
            "PENDING",
            TOURNAMENT_ENTRY_PAYOUT_STATUS.HELD_IN_PLATFORM,
            TOURNAMENT_ENTRY_PAYOUT_STATUS.LOCKED_AFTER_START,
          ],
        },
      },
      data: { payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.READY_FOR_PAYOUT },
    });
  }

  if (tournamentStatus === "CANCELLED") {
    await transaction.tournamentEntryPayment.updateMany({
      where: {
        tournamentId,
        status: "PAID",
        payoutStatus: {
          in: [
            "PENDING",
            TOURNAMENT_ENTRY_PAYOUT_STATUS.HELD_IN_PLATFORM,
            TOURNAMENT_ENTRY_PAYOUT_STATUS.LOCKED_AFTER_START,
            TOURNAMENT_ENTRY_PAYOUT_STATUS.READY_FOR_PAYOUT,
          ],
        },
      },
      data: { payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED },
    });
  }
};

const syncTournamentEntryPaymentLifecycle = async ({ ownerUserId } = {}) => {
  const ownerFilter = ownerUserId ? { payoutRecipientUserId: ownerUserId } : {};
  await prisma.$transaction([
    prisma.tournamentEntryPayment.updateMany({
      where: {
        ...ownerFilter,
        payoutTargetType: "TURF_OWNER",
        tournament: { status: "ACTIVE" },
        payoutStatus: { in: ["PENDING", TOURNAMENT_ENTRY_PAYOUT_STATUS.HELD_IN_PLATFORM] },
      },
      data: { payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.LOCKED_AFTER_START },
    }),
    prisma.tournamentEntryPayment.updateMany({
      where: {
        ...ownerFilter,
        payoutTargetType: "TURF_OWNER",
        tournament: { status: "COMPLETED" },
        payoutStatus: {
          in: [
            "PENDING",
            TOURNAMENT_ENTRY_PAYOUT_STATUS.HELD_IN_PLATFORM,
            TOURNAMENT_ENTRY_PAYOUT_STATUS.LOCKED_AFTER_START,
          ],
        },
      },
      data: { payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.READY_FOR_PAYOUT },
    }),
    prisma.tournamentEntryPayment.updateMany({
      where: {
        ...ownerFilter,
        status: "PAID",
        tournament: { status: "CANCELLED" },
        payoutStatus: {
          in: [
            "PENDING",
            TOURNAMENT_ENTRY_PAYOUT_STATUS.HELD_IN_PLATFORM,
            TOURNAMENT_ENTRY_PAYOUT_STATUS.LOCKED_AFTER_START,
            TOURNAMENT_ENTRY_PAYOUT_STATUS.READY_FOR_PAYOUT,
          ],
        },
      },
      data: { payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED },
    }),
  ]);
};

const createTournamentEntryRefund = async (payment, { actorRole = "SYSTEM", reason } = {}) => {
  if (!payment?.id || !payment?.paymentId || Number(payment.finalEntryFee ?? 0) <= 0) return null;
  if (payment.status === "REFUNDED" || payment.payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUNDED) return null;

  const existingRefund = (payment.refunds ?? []).find((refund) => ["CREATED", "PROCESSED"].includes(refund.status));
  if (existingRefund) return existingRefund;

  const refundRecord = await prisma.tournamentEntryPaymentRefund.create({
    data: {
      tournamentId: payment.tournamentId,
      entryPaymentId: payment.id,
      payerUserId: payment.payerUserId,
      amount: Number(payment.finalEntryFee ?? 0),
      currency: "INR",
      receipt: tournamentRefundReceipt(payment),
      razorpayPaymentId: payment.paymentId,
      status: "CREATED",
    },
  });

  try {
    const refund = await createRazorpayRefund({
      paymentId: payment.paymentId,
      amount: Number(payment.finalEntryFee ?? 0),
      receipt: refundRecord.receipt,
      notes: {
        flow: "tournament_entry_refund",
        tournamentId: payment.tournamentId,
        entryPaymentId: payment.id,
        teamId: payment.teamId ?? "",
        actorRole,
        reason: reason?.trim() || "Tournament cancelled",
      },
    });
    const refundStatus = mapTournamentRefundStatus(refund.status);
    const now = new Date();

    await prisma.tournamentEntryPaymentRefund.update({
      where: { id: refundRecord.id },
      data: {
        razorpayRefundId: refund.id ?? null,
        status: refundStatus,
        failureReason: refund.error_description ?? null,
        ...(refundStatus === "PROCESSED" ? { processedAt: now } : {}),
        ...(refundStatus === "FAILED" ? { failedAt: now } : {}),
      },
    });

    await prisma.tournamentEntryPayment.update({
      where: { id: payment.id },
      data:
        refundStatus === "PROCESSED"
          ? {
              status: "REFUNDED",
              payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUNDED,
              payoutFailureReason: null,
            }
          : refundStatus === "FAILED"
            ? {
                payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED,
                payoutFailureReason: refund.error_description ?? "Refund failed",
              }
            : {
                payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED,
                payoutFailureReason: null,
              },
    });

    if (refundStatus === "PROCESSED" || refundStatus === "FAILED") {
      await sendTournamentEntryRefundEmail(payment.id);
    }
  } catch (error) {
    await prisma.tournamentEntryPaymentRefund.update({
      where: { id: refundRecord.id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        failureReason: error.message,
      },
    });
    await prisma.tournamentEntryPayment.update({
      where: { id: payment.id },
      data: {
        payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED,
        payoutFailureReason: error.message,
      },
    });
    await sendTournamentEntryRefundEmail(payment.id);
    logger.error({ err: error, paymentId: payment.id }, "Tournament entry refund failed");
  }

  return prisma.tournamentEntryPaymentRefund.findUnique({ where: { id: refundRecord.id } });
};

export const syncTournamentEntryRefundWebhook = async (refund) => {
  if (!refund?.id) return false;
  const record = await prisma.tournamentEntryPaymentRefund.findFirst({ where: { razorpayRefundId: refund.id } });
  if (!record) return false;
  const paymentBeforeUpdate = await prisma.tournamentEntryPayment.findUnique({
    where: { id: record.entryPaymentId },
    select: { payoutStatus: true, payoutReleasedAt: true },
  });

  const refundStatus = mapTournamentRefundStatus(refund.status);
  const now = new Date();
  await prisma.tournamentEntryPaymentRefund.update({
    where: { id: record.id },
    data: {
      status: refundStatus,
      failureReason: refund.error_description ?? null,
      ...(refundStatus === "PROCESSED" ? { processedAt: now } : {}),
      ...(refundStatus === "FAILED" ? { failedAt: now } : {}),
    },
  });

  await prisma.tournamentEntryPayment.update({
    where: { id: record.entryPaymentId },
    data:
      refundStatus === "PROCESSED"
        ? {
            status: "REFUNDED",
            payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUNDED,
            payoutFailureReason: null,
          }
        : refundStatus === "FAILED"
          ? {
              payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED,
              payoutFailureReason: refund.error_description ?? "Refund failed",
            }
            : {
                payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED,
                payoutFailureReason: null,
              },
  });

  if (
    (refundStatus === "PROCESSED" && !paymentBeforeUpdate?.payoutReleasedAt) ||
    (refundStatus === "FAILED" && paymentBeforeUpdate?.payoutStatus !== TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED)
  ) {
    await sendTournamentEntryRefundEmail(record.entryPaymentId);
  }

  return true;
};

export const syncTournamentEntryPayoutWebhook = async (payout) => {
  if (!payout?.id) return false;
  const record = await prisma.tournamentEntryPayment.findFirst({
    where: { razorpayPayoutId: payout.id },
    include: {
      tournament: { include: { host: true, turf: true } },
      team: true,
      payer: true,
      payoutRecipient: true,
      refunds: { orderBy: { requestedAt: "desc" } },
    },
  });
  if (!record) return false;

  const previousStatus = record.payoutStatus;
  const payoutStatus = mapTournamentPayoutResultStatus(payout.status);
  const now = new Date();

  await prisma.tournamentEntryPayment.update({
    where: { id: record.id },
    data: {
      payoutStatus,
      payoutReference: record.payoutReference ?? payout.id ?? payout.utr ?? null,
      payoutFailureReason: payout.failure_reason ?? null,
      ...(payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_SENT ? { payoutReleasedAt: now } : {}),
      ...(payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_FAILED || payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_REVERSED
        ? { payoutReleasedAt: null }
        : {}),
    },
  });

  if (
    payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_SENT ||
    payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_FAILED ||
    payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_REVERSED
  ) {
    const refreshedPayment = await prisma.tournamentEntryPayment.findUnique({
      where: { id: record.id },
      include: {
        tournament: { include: { host: true, turf: true } },
        team: true,
        payer: true,
        payoutRecipient: true,
        refunds: { orderBy: { requestedAt: "desc" } },
      },
    });
    if (refreshedPayment && previousStatus !== payoutStatus) {
      await sendTournamentPayoutEmail(refreshedPayment.id, payoutStatus, Number(refreshedPayment.finalEntryFee ?? 0));
    }
  }

  return true;
};

export const cancelTournament = async (userId, tournamentId, { reason, actorRole = "ADMIN", requireHost = true } = {}) => {
  const tournament = await ensureTournament(tournamentId);
  if (requireHost) ensureHost(tournament, userId);
  if (tournament.status === "COMPLETED") throw AppError.conflict("Completed tournaments cannot be cancelled");
  if (tournament.status === "CANCELLED") return getTournament(tournamentId);

  const payoutBlockedCount = await prisma.tournamentEntryPayment.count({
    where: {
      tournamentId: tournament.id,
      payoutStatus: {
        in: [
          TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_PROCESSING,
          TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_SENT,
        ],
      },
    },
  });
  if (payoutBlockedCount > 0) {
    throw AppError.conflict("This tournament already has payout release activity. Handle it manually before cancellation refunds");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.tournament.update({
      where: { id: tournament.id },
      data: { status: "CANCELLED" },
    });
    await transaction.tournamentMatch.updateMany({
      where: { tournamentId: tournament.id, status: { in: ["SCHEDULED", "LIVE"] } },
      data: { status: "CANCELLED" },
    });
    await markTournamentEntryPaymentsForStatus(transaction, tournament.id, "CANCELLED");
  });

  const refundablePayments = await prisma.tournamentEntryPayment.findMany({
    where: {
      tournamentId: tournament.id,
      status: "PAID",
      paymentId: { not: null },
      finalEntryFee: { gt: 0 },
      payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.REFUND_REQUIRED,
    },
    include: {
      tournament: true,
      refunds: { orderBy: { requestedAt: "desc" } },
    },
  });

  await Promise.allSettled(
    refundablePayments.map((payment) => createTournamentEntryRefund(payment, { actorRole, reason })),
  );

  return getTournament(tournamentId);
};

export const releaseTournamentEntryPayout = async (paymentId) => {
  const payment = await prisma.tournamentEntryPayment.findUnique({
    where: { id: paymentId },
    include: {
      tournament: true,
      payoutRecipient: true,
      team: true,
    },
  });
  if (!payment) throw AppError.notFound("Tournament payment");
  if (payment.payoutTargetType !== "TURF_OWNER") throw AppError.validation("Only owner-created tournament payments can be released");
  if (payment.payoutStatus !== TOURNAMENT_ENTRY_PAYOUT_STATUS.READY_FOR_PAYOUT) {
    throw AppError.conflict("Tournament payment is not ready for payout yet");
  }
  if (payment.tournament?.status !== "COMPLETED") {
    throw AppError.conflict("Tournament payout can be released only after completion");
  }
  assertTournamentPayoutDetails(payment);

  const referenceId = payment.payoutReference ?? tournamentPayoutReference(payment);
  try {
    const contact = payment.razorpayContactId
      ? { id: payment.razorpayContactId }
      : await createRazorpayXContact(getTournamentPayoutContactPayload(payment));
    const fundAccount = payment.razorpayFundAccountId
      ? { id: payment.razorpayFundAccountId }
      : await createRazorpayXFundAccount({
          contactId: contact.id,
          ...getTournamentPayoutFundAccountPayload(payment),
        });
    const payout = await createRazorpayXPayout({
      fundAccountId: fundAccount.id,
      payoutMethod: payment.payoutRecipient.payoutMethod,
      amount: Number(payment.finalEntryFee ?? 0),
      currency: "INR",
      referenceId,
      narration: `Tournament ${payment.tournament?.tournamentCode ?? payment.tournamentId}`,
      notes: {
        flow: "tournament_entry_payout",
        tournamentId: payment.tournamentId,
        paymentId: payment.id,
        teamId: payment.teamId ?? "",
      },
    });

    const payoutStatus = mapTournamentPayoutResultStatus(payout.status);
    const updatedPayment = await prisma.tournamentEntryPayment.update({
      where: { id: payment.id },
      data: {
        payoutStatus,
        payoutMethod: payment.payoutRecipient.payoutMethod,
        payoutReference: referenceId,
        razorpayContactId: contact.id,
        razorpayFundAccountId: fundAccount.id,
        razorpayPayoutId: payout.id ?? null,
        payoutReleasedAt: payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_SENT ? new Date() : null,
        payoutFailureReason: null,
      },
      include: {
        tournament: { include: { host: true, turf: true } },
        team: true,
        payer: true,
        payoutRecipient: true,
        refunds: { orderBy: { requestedAt: "desc" } },
      },
    });

    if (payoutStatus === TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_SENT) {
      await sendTournamentPayoutEmail(payment.id, payoutStatus, Number(payment.finalEntryFee ?? 0));
    }

    return serializeTournamentEntryPayment(updatedPayment);
  } catch (error) {
    logger.warn({ err: error, paymentId: payment.id }, "Tournament payout release failed");
    await prisma.tournamentEntryPayment.update({
      where: { id: payment.id },
      data: {
        payoutStatus: TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_FAILED,
        payoutReference: referenceId,
        payoutFailureReason: error.message,
      },
    });
    await sendTournamentPayoutEmail(payment.id, TOURNAMENT_ENTRY_PAYOUT_STATUS.PAYOUT_FAILED, Number(payment.finalEntryFee ?? 0));
    throw error;
  }
};

const previewTournamentEntryPayment = async (userId, tournamentId, input) => {
  const tournament = await ensureTournament(tournamentId);
  const offerSetting = await getTournamentRegistrationOfferRecord();
  const effectiveOffer = resolveTournamentRegistrationOffer(tournament, offerSetting);
  const reusableTeam = input.userTeamId
    ? await prisma.userTeam.findFirst({
        where: { id: input.userTeamId, ownerUserId: userId, isActive: true },
        include: { members: { orderBy: { createdAt: "asc" } } },
      })
    : null;
  if (input.userTeamId && !reusableTeam) {
    throw AppError.notFound("Team");
  }
  if (tournament.status !== "OPEN") throw AppError.conflict("This tournament is not open for teams");
  if (joinedTeamsCount(tournament) >= tournament.maxTeams) {
    throw AppError.conflict("Tournament team limit reached");
  }
  if (hasUserJoinedTournament(tournament, userId)) {
    throw AppError.validation("You already joined this tournament");
  }

  const players = input.players?.length
    ? input.players
    : reusableTeam
      ? [...reusableTeam.members]
          .sort(
            (left, right) =>
              (reusableTeamRoleOrder[left.role] ?? 99) - (reusableTeamRoleOrder[right.role] ?? 99) ||
              new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
          )
          .map((member) => ({
            userId: member.userId ?? undefined,
            displayName: member.displayName,
            email: member.email ?? undefined,
          }))
      : [{ displayName: input.captainName ?? "Captain", userId }];
  const teamName = input.teamName?.trim() || reusableTeam?.name;
  if (!teamName) throw AppError.validation("Team name is required");
  if (players.length > tournament.teamSize + (tournament.substituteCount ?? 0)) {
    throw AppError.validation("Players exceed this tournament squad limit");
  }

  const roster = players.map((player, index) => ({
    ...player,
    email: normalizePlayerEmail(player.email),
    isSubstitute: index >= tournament.teamSize,
  }));
  const duplicateEmails = roster
    .filter((player) => player.email)
    .map((player) => player.email)
    .filter((email, index, list) => list.indexOf(email) !== index);
  if (duplicateEmails.length) {
    throw AppError.validation("Each registered player email can be used only once in the team roster");
  }

  const emailList = [...new Set(roster.map((player) => player.email).filter(Boolean))];
  const usersByEmail = emailList.length
    ? new Map(
        (
          await prisma.user.findMany({
            where: { email: { in: emailList } },
            select: { id: true, email: true },
          })
        ).map((user) => [user.email.toLowerCase(), user]),
      )
    : new Map();

  const linkedRoster = roster.map((player) => {
    const userByEmail = player.email ? usersByEmail.get(player.email) : null;
    return {
      ...player,
      userId: player.userId ?? userByEmail?.id ?? null,
    };
  });

  const duplicateUserIds = linkedRoster
    .filter((player) => player.userId)
    .map((player) => player.userId)
    .filter((linkedUserId, index, list) => list.indexOf(linkedUserId) !== index);
  if (duplicateUserIds.length) {
    throw AppError.validation("The same app account cannot be added twice in one team");
  }

  const existingDraftTeam = await prisma.tournamentTeam.findFirst({
    where: {
      tournamentId: tournament.id,
      ownerUserId: userId,
      status: "DRAFT",
    },
    select: { id: true },
  });
  await assertTournamentPlayersAvailable(prisma, {
    tournamentId: tournament.id,
    linkedRoster,
    excludeTeamId: existingDraftTeam?.id ?? null,
  });

  const registeredMainPlayerCount = linkedRoster
    .slice(0, tournament.teamSize)
    .filter((player) => player.userId).length;
  const mainPlayerTarget = tournament.teamSize;
  if (linkedRoster.length < mainPlayerTarget) {
    throw AppError.validation(`Add all ${mainPlayerTarget} main players before final join`);
  }
  if (registeredMainPlayerCount < mainPlayerTarget) {
    throw AppError.validation("All main players must register in the app before final join");
  }
  const discountPercentApplied =
    effectiveOffer?.isEnabled &&
      linkedRoster.length >= mainPlayerTarget &&
      registeredMainPlayerCount >= mainPlayerTarget
        ? effectiveOffer.discountPercent
        : 0;
  const baseEntryFee = tournament.entryFeePerTeam ?? 0;
  const discountAmount = Math.floor((baseEntryFee * discountPercentApplied) / 100);
  const finalEntryFee = Math.max(0, baseEntryFee - discountAmount);

  return {
    tournament,
    baseEntryFee,
    discountAmount,
    finalEntryFee,
    payout: resolveTournamentPayoutTarget(tournament),
  };
};

export const createTournamentEntryPaymentOrder = async (userId, tournamentId, input) => {
  const preview = await previewTournamentEntryPayment(userId, tournamentId, { ...input, submissionType: "FINAL" });
  if (preview.finalEntryFee <= 0) {
    return {
      mode: "JOINED",
      team: await joinTournamentTeam(userId, tournamentId, { ...input, submissionType: "FINAL" }),
    };
  }

  const gateway = await getActiveBookingPaymentGatewayConfig();
  if (!gateway) {
    return {
      mode: "JOINED",
      team: await joinTournamentTeam(userId, tournamentId, { ...input, submissionType: "FINAL" }),
    };
  }

  const customer = await getCheckoutCustomer(userId);
  const order = await createRazorpayOrder({
    amount: preview.finalEntryFee * 100,
    receipt: tournamentPaymentReceipt(),
    notes: {
      flow: "tournament_entry",
      userId,
      tournamentId: preview.tournament.id,
      payoutTargetType: preview.payout.payoutTargetType,
      payoutRecipientUserId: preview.payout.payoutRecipientUserId ?? "",
    },
    customer,
    description: "Tournament entry payment",
  });

  return {
    mode: "PAYMENT_REQUIRED",
    payment: {
      provider: order.provider,
      keyId: order.keyId,
      currency: order.currency,
      amount: order.amount,
      orderId: order.orderId,
      name: order.checkout.name,
      description: order.checkout.description,
      prefill: order.checkout.prefill,
    },
    pricing: {
      baseEntryFee: preview.baseEntryFee,
      discountAmount: preview.discountAmount,
      finalEntryFee: preview.finalEntryFee,
      payoutTargetType: preview.payout.payoutTargetType,
    },
  };
};

export const verifyTournamentEntryPaymentAndJoin = async (
  userId,
  tournamentId,
  { razorpayOrderId, razorpayPaymentId, razorpaySignature, ...input },
) => {
  const preview = await previewTournamentEntryPayment(userId, tournamentId, {
    ...input,
    submissionType: "FINAL",
  });
  const payment = await verifyRazorpayPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
    expectedAmount: preview.finalEntryFee * 100,
  });

  const existingPayment = await prisma.tournamentEntryPayment.findFirst({
    where: {
      OR: [{ paymentOrderId: razorpayOrderId }, { paymentId: razorpayPaymentId }],
    },
    include: { team: { include: { owner: true, players: { orderBy: { createdAt: "asc" } }, standing: true } } },
  });
  if (existingPayment) {
    if (existingPayment.payerUserId !== userId) {
      throw AppError.conflict("This payment has already been used for another tournament entry");
    }
    return serializeTeam(existingPayment.team);
  }

  return joinTournamentTeam(userId, tournamentId, { ...input, submissionType: "FINAL" }, payment);
};

const recordTournamentEntryPayment = async (
  transaction,
  { tournament, teamId, userId, payment, baseEntryFee, discountAmount, finalEntryFee },
) => {
  if (!payment) return;
  const payout = resolveTournamentPayoutTarget(tournament);
  await transaction.tournamentEntryPayment.create({
    data: {
      tournamentId: tournament.id,
      teamId,
      payerUserId: userId,
      payoutTargetType: payout.payoutTargetType,
      payoutRecipientUserId: payout.payoutRecipientUserId,
      amount: baseEntryFee,
      discountAmount,
      finalEntryFee,
      paymentProvider: payment.provider,
      paymentOrderId: payment.paymentOrderId,
      paymentId: payment.paymentId,
      paymentSignature: payment.paymentSignature,
      paymentCapturedAt: payment.paymentCapturedAt,
      payoutStatus:
        payout.payoutTargetType === "PLATFORM"
          ? TOURNAMENT_ENTRY_PAYOUT_STATUS.PLATFORM_RETAINED
          : TOURNAMENT_ENTRY_PAYOUT_STATUS.HELD_IN_PLATFORM,
    },
  });
};

export const joinTournamentTeam = async (userId, tournamentId, input, payment = null) => {
  const tournament = await ensureTournament(tournamentId);
  const offerSetting = await getTournamentRegistrationOfferRecord();
  const effectiveOffer = resolveTournamentRegistrationOffer(tournament, offerSetting);
  const submissionType = input.submissionType ?? "FINAL";
  const isDraftSubmission = submissionType === "DRAFT";
  const reusableTeam = input.userTeamId
    ? await prisma.userTeam.findFirst({
        where: { id: input.userTeamId, ownerUserId: userId, isActive: true },
        include: { members: { orderBy: { createdAt: "asc" } } },
      })
    : null;
  if (input.userTeamId && !reusableTeam) {
    throw AppError.notFound("Team");
  }
  if (tournament.status !== "OPEN") throw AppError.conflict("This tournament is not open for teams");
  if (!isDraftSubmission && joinedTeamsCount(tournament) >= tournament.maxTeams) {
    throw AppError.conflict("Tournament team limit reached");
  }
  if (hasUserJoinedTournament(tournament, userId)) {
    throw AppError.validation("You already joined this tournament");
  }

  const players = input.players?.length
    ? input.players
    : reusableTeam
      ? [...reusableTeam.members]
          .sort(
            (left, right) =>
              (reusableTeamRoleOrder[left.role] ?? 99) - (reusableTeamRoleOrder[right.role] ?? 99) ||
              new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
          )
          .map((member) => ({
            userId: member.userId ?? undefined,
            displayName: member.displayName,
            email: member.email ?? undefined,
          }))
      : [{ displayName: input.captainName ?? "Captain", userId }];
  const teamName = input.teamName?.trim() || reusableTeam?.name;
  if (!teamName) throw AppError.validation("Team name is required");
  if (players.length > tournament.teamSize + (tournament.substituteCount ?? 0)) {
    throw AppError.validation("Players exceed this tournament squad limit");
  }

  const team = await prisma.$transaction(async (transaction) => {
    const existingTeam = await transaction.tournamentTeam.findFirst({
      where: {
        tournamentId,
        ownerUserId: userId,
        status: "DRAFT",
      },
      include: { standing: true },
    });

    const roster = players.map((player, index) => ({
      ...player,
      email: normalizePlayerEmail(player.email),
      isSubstitute: index >= tournament.teamSize,
    }));
    const duplicateEmails = roster
      .filter((player) => player.email)
      .map((player) => player.email)
      .filter((email, index, list) => list.indexOf(email) !== index);
    if (duplicateEmails.length) {
      throw AppError.validation("Each registered player email can be used only once in the team roster");
    }

    const emailList = [...new Set(roster.map((player) => player.email).filter(Boolean))];
    const usersByEmail = emailList.length
      ? new Map(
          (
            await transaction.user.findMany({
              where: { email: { in: emailList } },
              select: { id: true, email: true },
            })
          ).map((user) => [user.email.toLowerCase(), user]),
        )
      : new Map();

    const linkedRoster = roster.map((player) => {
      const userByEmail = player.email ? usersByEmail.get(player.email) : null;
      return {
        ...player,
        userId: player.userId ?? userByEmail?.id ?? null,
      };
    });

    const duplicateUserIds = linkedRoster
      .filter((player) => player.userId)
      .map((player) => player.userId)
      .filter((linkedUserId, index, list) => list.indexOf(linkedUserId) !== index);
    if (duplicateUserIds.length) {
      throw AppError.validation("The same app account cannot be added twice in one team");
    }

    await assertTournamentPlayersAvailable(transaction, {
      tournamentId,
      linkedRoster,
      excludeTeamId: existingTeam?.id ?? null,
    });

    const registeredMainPlayerCount = linkedRoster
      .slice(0, tournament.teamSize)
      .filter((player) => player.userId).length;
    const mainPlayerTarget = tournament.teamSize;
    if (!isDraftSubmission && linkedRoster.length < mainPlayerTarget) {
      throw AppError.validation(`Add all ${mainPlayerTarget} main players before final join`);
    }
    if (!isDraftSubmission && registeredMainPlayerCount < mainPlayerTarget) {
      throw AppError.validation("All main players must register in the app before final join");
    }
    const discountPercentApplied =
      effectiveOffer?.isEnabled &&
      linkedRoster.length >= mainPlayerTarget &&
      registeredMainPlayerCount >= mainPlayerTarget
        ? effectiveOffer.discountPercent
        : 0;
    const baseEntryFee = tournament.entryFeePerTeam ?? 0;
    const discountAmount = Math.floor((baseEntryFee * discountPercentApplied) / 100);
    const finalEntryFee = Math.max(0, baseEntryFee - discountAmount);
    const targetStatus = isDraftSubmission ? "DRAFT" : "JOINED";
    const gateway = !isDraftSubmission && finalEntryFee > 0 ? await getActiveBookingPaymentGatewayConfig() : null;
    if (gateway && !payment) {
      throw AppError.conflict("Tournament entry payment is required before final join");
    }

    const teamNameConflict = await transaction.tournamentTeam.findFirst({
      where: {
        tournamentId,
        name: teamName,
        ...(existingTeam ? { id: { not: existingTeam.id } } : {}),
        status: { in: ["JOINED", "DRAFT"] },
      },
      select: { id: true },
    });
    if (teamNameConflict) {
      throw AppError.conflict("A team with this name already exists in this tournament");
    }

    let joinedCountBefore = 0;
    if (targetStatus === "JOINED") {
      joinedCountBefore = await assertTournamentJoinWindow(transaction, {
        tournamentId,
        ownerUserId: userId,
        maxTeams: tournament.maxTeams,
        excludeTeamId: existingTeam?.id ?? null,
      });
    }

    if (existingTeam) {
      await transaction.tournamentPlayer.deleteMany({
        where: { teamId: existingTeam.id },
      });

      const updatedTeam = await transaction.tournamentTeam.update({
        where: { id: existingTeam.id },
        data: {
          name: teamName,
          userTeamId: reusableTeam?.id ?? null,
          status: targetStatus,
          registeredMainPlayerCount,
          mainPlayerTarget,
          discountPercentApplied,
          discountAmount,
          finalEntryFee,
          players: {
            create: linkedRoster.map((player) => ({
              userId: player.userId ?? null,
              displayName: player.displayName,
              email: player.email ?? null,
              isSubstitute: player.isSubstitute,
              jerseyNo: player.jerseyNo ?? null,
              position: player.position ?? null,
            })),
          },
        },
        include: {
          owner: true,
          players: { orderBy: { createdAt: "asc" } },
          standing: true,
        },
      });

      if (targetStatus === "JOINED" && !existingTeam.standing) {
        await transaction.tournamentStanding.create({
          data: { tournamentId, teamId: existingTeam.id },
        });
      }

      if (targetStatus === "JOINED") {
        await recordTournamentEntryPayment(transaction, {
          tournament,
          teamId: updatedTeam.id,
          userId,
          payment,
          baseEntryFee,
          discountAmount,
          finalEntryFee,
        });
      }

      if (targetStatus === "JOINED" && joinedCountBefore + 1 >= tournament.maxTeams) {
        await transaction.tournament.update({
          where: { id: tournamentId },
          data: { status: "FULL" },
        });
      }

      return updatedTeam;
    }

    const createdTeam = await transaction.tournamentTeam.create({
      data: {
        tournamentId,
        ownerUserId: userId,
        userTeamId: reusableTeam?.id ?? null,
        name: teamName,
        status: targetStatus,
        registeredMainPlayerCount,
        mainPlayerTarget,
        discountPercentApplied,
        discountAmount,
        finalEntryFee,
        players: {
          create: linkedRoster.map((player) => ({
            userId: player.userId ?? null,
            displayName: player.displayName,
            email: player.email ?? null,
            isSubstitute: player.isSubstitute,
            jerseyNo: player.jerseyNo ?? null,
            position: player.position ?? null,
          })),
        },
      },
      include: {
        owner: true,
        players: { orderBy: { createdAt: "asc" } },
        standing: true,
      },
    });

    if (targetStatus === "JOINED") {
      await transaction.tournamentStanding.create({
        data: { tournamentId, teamId: createdTeam.id },
      });
      await recordTournamentEntryPayment(transaction, {
        tournament,
        teamId: createdTeam.id,
        userId,
        payment,
        baseEntryFee,
        discountAmount,
        finalEntryFee,
      });
    }

    if (targetStatus === "JOINED" && joinedCountBefore + 1 >= tournament.maxTeams) {
      await transaction.tournament.update({
        where: { id: tournamentId },
        data: { status: "FULL" },
      });
    }

    return createdTeam;
  });

  if (team.status === "JOINED") {
    sendTournamentEntryConfirmationEmail(team.id).catch((error) => {
      logger.error({ error, teamId: team.id }, "Tournament entry confirmation email failed");
    });
  }

  return serializeTeam(team);
};

export const checkTournamentPlayerEmailStatus = async (_userId, tournamentId, email) => {
  await ensureTournament(tournamentId);

  const normalizedEmail = normalizePlayerEmail(email);
  if (!normalizedEmail) throw AppError.validation("Enter a valid player email");

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
    },
  });

  return {
    email: normalizedEmail,
    isRegistered: Boolean(user?.isActive),
    userId: user?.isActive ? user.id : null,
    displayName:
      user?.isActive
        ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email
        : null,
  };
};

export const sendTournamentPlayerInvite = async (userId, tournamentId, { email, displayName }) => {
  const tournament = await ensureTournament(tournamentId);
  const normalizedEmail = normalizePlayerEmail(email);
  if (!normalizedEmail) throw AppError.validation("Enter a valid player email");

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, isActive: true },
  });
  if (existingUser?.isActive) {
    throw AppError.conflict("This email is already registered");
  }

  const captain = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  const captainName =
    [captain?.firstName, captain?.lastName].filter(Boolean).join(" ").trim() ||
    captain?.email ||
    "Your teammate";
  const inviteUrl = `${appBaseUrl.replace(/\/$/, "")}/signup?email=${encodeURIComponent(normalizedEmail)}&tournamentId=${encodeURIComponent(tournament.id)}`;
  const teammateName = displayName?.trim() || "player";

  const emailResult = await sendEmail({
    to: normalizedEmail,
    subject: `${captainName} invited you to join ${tournament.title} on PlayArena`,
    text: `Hi ${teammateName},\n\n${captainName} added you to the ${tournament.title} tournament team on PlayArena.\n\nCreate your account here:\n${inviteUrl}\n\nOnce you register, your captain can verify your email inside the tournament roster.\n\n- PlayArena`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #10245e; line-height: 1.6;">
        <p style="margin:0 0 8px;">Hi ${teammateName},</p>
        <h2 style="margin:0 0 12px;">Join your team on PlayArena</h2>
        <p style="margin:0 0 12px;">
          <strong>${captainName}</strong> added you to the <strong>${tournament.title}</strong> tournament team.
        </p>
        <p style="margin:0 0 16px;">Create your account to confirm your place and help unlock the team discount.</p>
        <p style="margin:0 0 18px;">
          <a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
            Create account
          </a>
        </p>
        <p style="margin:0 0 10px;color:#5f6f92;">If the button does not open, use this link:</p>
        <p style="margin:0;color:#1646d8;word-break:break-all;">${inviteUrl}</p>
        <p style="margin:18px 0 0;color:#5f6f92;">- PlayArena no-reply</p>
      </div>
    `,
  });

  if (emailResult?.skipped) {
    throw AppError.conflict("Invite email is not configured yet");
  }

  return {
    email: normalizedEmail,
    invited: true,
  };
};

export const createTournamentManualMatch = async (userId, tournamentId, input, { requireHost = true } = {}) => {
  const tournament = await ensureTournament(tournamentId);
  if (requireHost) ensureHost(tournament, userId);
  if (tournament.fixtureType !== "MANUAL") {
    throw AppError.validation("Manual match creation is available only for manual tournaments");
  }
  if (tournament.status === "COMPLETED") throw AppError.conflict("This tournament is already completed");
  if (tournament.status === "CANCELLED") throw AppError.conflict("Cancelled tournaments cannot add matches");

  const joinedTeams = sortTeamsForFixtures(tournament.teams.filter((team) => team.status === "JOINED"));
  if (joinedTeams.length < 2) throw AppError.validation("Add at least two joined teams before creating a match");

  const validTeamIds = new Set(joinedTeams.map((team) => team.id));
  if (!validTeamIds.has(input.homeTeamId) || !validTeamIds.has(input.awayTeamId)) {
    throw AppError.validation("Select teams that joined this tournament");
  }
  if (input.homeTeamId === input.awayTeamId) {
    throw AppError.validation("Choose two different teams");
  }

  const duplicateMatch = tournament.matches.find(
    (match) =>
      (match.homeTeam?.id === input.homeTeamId && match.awayTeam?.id === input.awayTeamId) ||
      (match.homeTeam?.id === input.awayTeamId && match.awayTeam?.id === input.homeTeamId),
  );
  if (duplicateMatch) {
    throw AppError.conflict("A match between these teams already exists");
  }

  const round =
    input.round ??
    tournament.matches.reduce((maxRound, match) => Math.max(maxRound, match.round ?? 0), 0) + 1;

  await prisma.$transaction(async (transaction) => {
    await transaction.tournamentMatch.create({
      data: {
        tournamentId,
        homeTeamId: input.homeTeamId,
        awayTeamId: input.awayTeamId,
        round,
        scheduledAt: input.scheduledAt ? new Date(`${input.scheduledAt}:00+05:30`) : null,
      },
    });

    if (tournament.status !== "ACTIVE") {
      await transaction.tournament.update({
        where: { id: tournamentId },
        data: { status: "ACTIVE" },
      });
      await markTournamentEntryPaymentsForStatus(transaction, tournamentId, "ACTIVE");
    }
  });

  return getTournament(tournamentId);
};

export const generateTournamentFixtures = async (userId, tournamentId, { requireHost = true } = {}) => {
  const tournament = await ensureTournament(tournamentId);
  if (requireHost) ensureHost(tournament, userId);
  if (tournament.status === "ACTIVE") throw AppError.conflict("Fixtures already generated for this tournament");
  if (tournament.status === "COMPLETED") throw AppError.conflict("This tournament is already completed");
  if (tournament.status === "CANCELLED") throw AppError.conflict("Cancelled tournaments cannot generate fixtures");
  if (tournament.fixtureType === "MANUAL") {
    throw AppError.validation("Manual tournaments need manual fixture creation. Auto generation is not available yet");
  }

  const teams = sortTeamsForFixtures(tournament.teams.filter((team) => team.status === "JOINED"));
  if (teams.length < 2) throw AppError.validation("Add at least two teams before generating fixtures");
  if (teams.length < tournament.maxTeams) throw AppError.validation("Wait until all teams join before generating fixtures");

  const fixtures =
    tournament.fixtureType === "KNOCKOUT"
      ? buildKnockoutOpeningFixtures(tournamentId, teams)
      : buildLeagueFixtures(tournamentId, teams);

  await prisma.$transaction(async (transaction) => {
    await transaction.tournamentMatch.createMany({ data: fixtures, skipDuplicates: true });
    await transaction.tournament.update({ where: { id: tournamentId }, data: { status: "ACTIVE" } });
    await markTournamentEntryPaymentsForStatus(transaction, tournamentId, "ACTIVE");
  });

  return getTournament(tournamentId);
};

const emptyStanding = (teamId) => ({
  teamId,
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  points: 0,
  scoreFor: 0,
  scoreAgainst: 0,
  scoreDiff: 0,
});

const applyResult = (standing, scored, conceded, didWin, didDraw, pointsForWin, pointsForDraw) => {
  standing.played += 1;
  standing.scoreFor += scored;
  standing.scoreAgainst += conceded;
  standing.scoreDiff = standing.scoreFor - standing.scoreAgainst;
  if (didDraw) {
    standing.draws += 1;
    standing.points += pointsForDraw;
  } else if (didWin) {
    standing.wins += 1;
    standing.points += pointsForWin;
  } else {
    standing.losses += 1;
  }
};

const recalculateStandings = async (transaction, tournamentId, tournament) => {
  const teams = await transaction.tournamentTeam.findMany({
    where: { tournamentId, status: "JOINED" },
    select: { id: true },
  });
  const standings = new Map(teams.map((team) => [team.id, emptyStanding(team.id)]));
  const matches = await transaction.tournamentMatch.findMany({
    where: { tournamentId, status: "COMPLETED" },
  });

  matches.forEach((match) => {
    if (isPlayoffMatch(match)) return;
    const home = standings.get(match.homeTeamId);
    const away = standings.get(match.awayTeamId);
    if (!home || !away || match.homeScore === null || match.awayScore === null) return;

    const isDraw = match.homeScore === match.awayScore;
    applyResult(home, match.homeScore, match.awayScore, match.homeScore > match.awayScore, isDraw, tournament.pointsForWin, tournament.pointsForDraw);
    applyResult(away, match.awayScore, match.homeScore, match.awayScore > match.homeScore, isDraw, tournament.pointsForWin, tournament.pointsForDraw);
  });

  await Promise.all(
    [...standings.values()].map((standing) =>
      transaction.tournamentStanding.upsert({
        where: { tournamentId_teamId: { tournamentId, teamId: standing.teamId } },
        update: standing,
        create: { tournamentId, ...standing },
      }),
    ),
  );
};

export const generateTournamentPlayoffs = async (userId, tournamentId, { requireHost = true } = {}) => {
  const tournament = await ensureTournament(tournamentId);
  if (requireHost) ensureHost(tournament, userId);
  if (!["LEAGUE", "MANUAL"].includes(tournament.fixtureType)) {
    throw AppError.validation("Playoffs are available only for league and manual tournaments");
  }
  if (tournament.status === "CANCELLED") throw AppError.conflict("Cancelled tournaments cannot generate playoffs");

  const joinedTeams = tournament.teams.filter((team) => team.status === "JOINED");
  if (joinedTeams.length < 4) throw AppError.validation("At least four joined teams are required to generate semifinals");

  const playoffMatches = tournament.matches.filter(isPlayoffMatch);
  if (playoffMatches.length) throw AppError.conflict("Playoffs are already generated for this tournament");

  if (tournament.matches.length === 0) {
    throw AppError.validation("Finish the first stage matches before generating semifinals");
  }
  if (tournament.matches.some((match) => match.status !== "COMPLETED")) {
    throw AppError.validation("Complete all current matches before generating semifinals");
  }

  const standings = sortStandingsTable(tournament.standings.map(serializeStanding));
  if (standings.length < 4) throw AppError.validation("At least four standings rows are required to seed the semifinals");

  const semifinalists = standings.slice(0, 4);
  const semifinalRound = tournament.matches.reduce((maxRound, match) => Math.max(maxRound, match.round ?? 0), 0) + 1;
  const fixtures = [
    pairTeamsForMatch(tournament.matches, tournamentId, semifinalists[0].teamId, semifinalists[3].teamId, semifinalRound, PLAYOFF_STAGES.SEMIFINAL),
    pairTeamsForMatch(tournament.matches, tournamentId, semifinalists[1].teamId, semifinalists[2].teamId, semifinalRound, PLAYOFF_STAGES.SEMIFINAL),
  ];

  await prisma.$transaction(async (transaction) => {
    await transaction.tournamentMatch.createMany({ data: fixtures });
    await transaction.tournament.update({ where: { id: tournamentId }, data: { status: "ACTIVE" } });
    await markTournamentEntryPaymentsForStatus(transaction, tournamentId, "ACTIVE");
  });

  return getTournament(tournamentId);
};

const advanceLeagueOrManualPlayoffs = async (transaction, tournamentId) => {
  const matches = await transaction.tournamentMatch.findMany({
    where: { tournamentId },
    orderBy: [{ round: "asc" }, { createdAt: "asc" }],
  });
  const playoffMatches = matches.filter(isPlayoffMatch);
  if (!playoffMatches.length) {
    const totalMatches = matches.length;
    const completedMatches = matches.filter((match) => match.status === "COMPLETED").length;
    return totalMatches > 0 && totalMatches === completedMatches ? "COMPLETED" : "ACTIVE";
  }

  const semifinalMatches = playoffMatches.filter((match) => parseMatchStage(match.resultNote).stage === PLAYOFF_STAGES.SEMIFINAL);
  const finalMatch = playoffMatches.find((match) => parseMatchStage(match.resultNote).stage === PLAYOFF_STAGES.FINAL);

  if (finalMatch) {
    return finalMatch.status === "COMPLETED" ? "COMPLETED" : "ACTIVE";
  }

  if (semifinalMatches.length !== 2) return "ACTIVE";
  if (semifinalMatches.some((match) => match.status !== "COMPLETED")) return "ACTIVE";

  const winnerIds = semifinalMatches.map((match) => {
    const winnerId = getKnockoutWinnerId(match);
    if (!winnerId) throw AppError.validation("Semifinal matches cannot end in a draw");
    return winnerId;
  });

  const nextRound = Math.max(...matches.map((match) => match.round ?? 0)) + 1;
  const finalFixture = pairTeamsForMatch(matches, tournamentId, winnerIds[0], winnerIds[1], nextRound, PLAYOFF_STAGES.FINAL);
  await transaction.tournamentMatch.create({ data: finalFixture });
  return "ACTIVE";
};

const advanceKnockoutBracket = async (transaction, tournamentId) => {
  const matches = await transaction.tournamentMatch.findMany({
    where: { tournamentId },
    orderBy: [{ round: "asc" }, { createdAt: "asc" }],
  });
  if (!matches.length) return "ACTIVE";

  const currentRound = Math.max(...matches.map((match) => match.round));
  const currentRoundMatches = matches.filter((match) => match.round === currentRound);
  if (currentRoundMatches.some((match) => match.status !== "COMPLETED")) return "ACTIVE";

  const winnerIds = currentRoundMatches.map((match) => {
    const winnerId = getKnockoutWinnerId(match);
    if (!winnerId) throw AppError.validation("Knockout matches cannot end in a draw");
    return winnerId;
  });

  const joinedTeams = sortTeamsForFixtures(
    await transaction.tournamentTeam.findMany({
      where: { tournamentId, status: "JOINED" },
      select: { id: true, name: true, seed: true, createdAt: true },
    }),
  );

  const playedTeamIds = new Set(
    matches
      .filter((match) => match.round <= currentRound)
      .flatMap((match) => [match.homeTeamId, match.awayTeamId]),
  );
  const byeTeamIds = joinedTeams.map((team) => team.id).filter((teamId) => !playedTeamIds.has(teamId));
  const nextRoundParticipants = joinedTeams.filter((team) => new Set([...winnerIds, ...byeTeamIds]).has(team.id));

  if (nextRoundParticipants.length === 1) {
    return "COMPLETED";
  }

  const nextRound = currentRound + 1;
  const nextRoundExists = matches.some((match) => match.round === nextRound);
  if (nextRoundExists) return "ACTIVE";

  const fixtures = [];
  for (let index = 0; index < nextRoundParticipants.length; index += 2) {
    const homeTeam = nextRoundParticipants[index];
    const awayTeam = nextRoundParticipants[index + 1];
    if (!awayTeam) throw AppError.validation("Unable to create the next knockout round");

    fixtures.push({
      tournamentId,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      round: nextRound,
    });
  }

  if (fixtures.length) {
    await transaction.tournamentMatch.createMany({ data: fixtures, skipDuplicates: true });
  }

  return "ACTIVE";
};

export const recordTournamentMatchResult = async (userId, tournamentId, matchId, input, { requireHost = true } = {}) => {
  const tournament = await ensureTournament(tournamentId);
  if (requireHost) ensureHost(tournament, userId);

  const match = tournament.matches.find((item) => item.id === matchId);
  if (!match) throw AppError.notFound("Tournament match");
  if (match.status === "CANCELLED") throw AppError.conflict("Cancelled matches cannot be scored");
  const cricketInput = normalizeCricketResultInput(tournament, input);
  const matchStage = parseMatchStage(match.resultNote).stage;
  const isEliminationMatch = tournament.fixtureType === "KNOCKOUT" || isPlayoffStage(matchStage);
  const resolvedHomeScore = cricketInput?.homeScore ?? input.homeScore;
  const resolvedAwayScore = cricketInput?.awayScore ?? input.awayScore;
  const resolvedOutcome = cricketInput?.matchOutcome ?? input.matchOutcome ?? CRICKET_MATCH_OUTCOMES.NORMAL;
  if (isEliminationMatch && isSharedPointsOutcome(resolvedOutcome)) {
    throw AppError.validation("Elimination matches need a winner. Use rain affected or super over after deciding the winner");
  }
  if (isEliminationMatch && resolvedHomeScore === resolvedAwayScore) {
    throw AppError.validation("Elimination matches cannot end in a draw");
  }
  if (
    tournament.fixtureType === "KNOCKOUT" &&
    match.status === "COMPLETED" &&
    tournament.matches.some((item) => item.round > match.round)
  ) {
    throw AppError.conflict("This knockout result cannot be changed after the next round has started");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.tournamentMatch.update({
      where: { id: matchId },
      data: {
        status: "COMPLETED",
        matchOutcome: isCricketSport(tournament.sport) ? resolvedOutcome : CRICKET_MATCH_OUTCOMES.NORMAL,
        homeScore: resolvedHomeScore,
        awayScore: resolvedAwayScore,
        homeWickets: cricketInput?.homeWickets ?? null,
        awayWickets: cricketInput?.awayWickets ?? null,
        homeOvers: cricketInput?.homeOvers ?? null,
        awayOvers: cricketInput?.awayOvers ?? null,
        battingFirstSide: cricketInput?.battingFirstSide ?? null,
        resultNote: buildMatchResultNote(matchStage, input.resultNote),
        completedAt: new Date(),
      },
    });

    await recalculateStandings(transaction, tournamentId, tournament);

    const nextStatus =
      tournament.fixtureType === "KNOCKOUT"
        ? await advanceKnockoutBracket(transaction, tournamentId)
        : await advanceLeagueOrManualPlayoffs(transaction, tournamentId);
    await transaction.tournament.update({
      where: { id: tournamentId },
      data: { status: nextStatus },
    });
    await markTournamentEntryPaymentsForStatus(transaction, tournamentId, nextStatus);
  });

  return getTournament(tournamentId);
};

export const updateTournamentMatchLiveScore = async (userId, tournamentId, matchId, input, { requireHost = true } = {}) => {
  const tournament = await ensureTournament(tournamentId);
  if (requireHost) ensureHost(tournament, userId);

  const match = tournament.matches.find((item) => item.id === matchId);
  if (!match) throw AppError.notFound("Tournament match");
  if (match.status === "COMPLETED") throw AppError.conflict("Completed matches cannot be scored live");
  if (match.status === "CANCELLED") throw AppError.conflict("Cancelled matches cannot be scored live");

  const { scorecard, matchStatus } = mutateCricketLiveScorecard(tournament, match, input);

  await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: {
      status: matchStatus,
      liveScorecard: scorecard,
      completedAt: null,
    },
  });

  return getTournament(tournamentId);
};

export const __testing = {
  formatCricketInningsScore,
  getCricketResultSummary,
  normalizeCricketResultInput,
  deriveCricketInningsSummary,
  mutateCricketLiveScorecard,
};
