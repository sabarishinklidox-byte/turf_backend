-- CreateEnum
CREATE TYPE "OwnerVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TurfStatus" AS ENUM ('PENDING_REVIEW', 'DOCUMENTS_VERIFIED', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TurfSlotStatus" AS ENUM ('AVAILABLE', 'BLOCKED', 'BOOKED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingPaymentStatus" AS ENUM ('PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BookingRefundStatus" AS ENUM ('CREATED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "BookingCancellationActor" AS ENUM ('USER', 'TURF_OWNER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TournamentEntryPaymentStatus" AS ENUM ('PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentGatewayProvider" AS ENUM ('RAZORPAY');

-- CreateEnum
CREATE TYPE "TournamentPayoutTargetType" AS ENUM ('TURF_OWNER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BANK_ACCOUNT', 'UPI');

-- CreateEnum
CREATE TYPE "OpenMatchType" AS ENUM ('PLAYER_JOIN', 'TEAM_VS_TEAM', 'NEED_OPPONENT_TEAM');

-- CreateEnum
CREATE TYPE "OpenMatchStatus" AS ENUM ('OPEN', 'FILLING', 'MIN_READY', 'PAYMENT_PENDING', 'READY', 'FULL', 'CONFIRMED_PARTIAL', 'CONFIRMED_FULL', 'CANCELLED', 'CANCELLED_REFUND', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OpenMatchResultStatus" AS ENUM ('PENDING_RESULT', 'CAPTAIN_A_SUBMITTED', 'CAPTAIN_B_SUBMITTED', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "OpenMatchTeamResultOutcome" AS ENUM ('WIN', 'DRAW', 'LOSS');

-- CreateEnum
CREATE TYPE "OpenMatchParticipantKind" AS ENUM ('PLAYER', 'TEAM');

-- CreateEnum
CREATE TYPE "OpenMatchPayoutStatus" AS ENUM ('HELD', 'ELIGIBLE', 'RELEASED', 'REFUND_REQUIRED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OpenMatchRefundStatus" AS ENUM ('CREATED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "OpenMatchPayoutReleaseStatus" AS ENUM ('CREATED', 'QUEUED', 'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'REVERSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OpenMatchParticipantStatus" AS ENUM ('PAID', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "UserTeamMemberRole" AS ENUM ('CAPTAIN', 'VICE_CAPTAIN', 'PLAYER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('OPEN_MATCH_NEARBY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('OPEN', 'FULL', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentFixtureType" AS ENUM ('LEAGUE', 'KNOCKOUT', 'MANUAL');

-- CreateEnum
CREATE TYPE "TournamentRegistrationOfferMode" AS ENUM ('GLOBAL', 'CUSTOM', 'DISABLED');

-- CreateEnum
CREATE TYPE "TournamentTeamStatus" AS ENUM ('DRAFT', 'JOINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentMatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentBattingSide" AS ENUM ('HOME', 'AWAY');

-- CreateEnum
CREATE TYPE "TournamentMatchOutcome" AS ENUM ('NORMAL', 'ABANDONED', 'NO_RESULT', 'RAIN_AFFECTED', 'SUPER_OVER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "passwordResetTokenHash" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "payoutMethod" "PayoutMethod",
    "payoutAccountHolderName" TEXT,
    "payoutBankName" TEXT,
    "payoutAccountNumber" TEXT,
    "payoutIfscCode" TEXT,
    "payoutUpiId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurfOwnerVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OwnerVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurfOwnerVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turf" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "ownerPhone" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "landmark" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "sports" TEXT[],
    "surfaceType" TEXT NOT NULL,
    "pricePerHour" INTEGER,
    "openingTime" TEXT NOT NULL,
    "closingTime" TEXT NOT NULL,
    "amenities" TEXT[],
    "imageUrls" TEXT[],
    "payoutMethod" "PayoutMethod",
    "payoutAccountHolderName" TEXT,
    "payoutBankName" TEXT,
    "payoutAccountNumber" TEXT,
    "payoutIfscCode" TEXT,
    "payoutUpiId" TEXT,
    "bookingCancellationOverrideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingCancellationFullRefundHours" INTEGER,
    "bookingCancellationPartialRefundHours" INTEGER,
    "bookingCancellationPartialRefundPercent" INTEGER,
    "bookingCancellationNoRefundHours" INTEGER,
    "openMatchCancellationOverrideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "openMatchCancellationFullRefundHours" INTEGER,
    "openMatchCancellationPartialRefundHours" INTEGER,
    "openMatchCancellationPartialRefundPercent" INTEGER,
    "openMatchCancellationNoRefundHours" INTEGER,
    "status" "TurfStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "ownerUserId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "Turf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurfAvailabilityRule" (
    "id" TEXT NOT NULL,
    "turfId" TEXT NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "daysOfWeek" INTEGER[],
    "openingTime" TEXT NOT NULL,
    "closingTime" TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL,
    "pricePerSlot" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurfAvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurfSlot" (
    "id" TEXT NOT NULL,
    "turfId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "TurfSlotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurfSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "bookingCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "turfId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "paymentStatus" "BookingPaymentStatus" NOT NULL DEFAULT 'PAID',
    "paymentProvider" "PaymentGatewayProvider",
    "paymentOrderId" TEXT,
    "paymentId" TEXT,
    "paymentSignature" TEXT,
    "paymentCapturedAt" TIMESTAMP(3),
    "payoutStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "payoutMethod" "PayoutMethod",
    "payoutIdempotencyKey" TEXT,
    "payoutReference" TEXT,
    "razorpayContactId" TEXT,
    "razorpayFundAccountId" TEXT,
    "razorpayPayoutId" TEXT,
    "payoutReleasedAt" TIMESTAMP(3),
    "payoutFailureReason" TEXT,
    "refundStatus" "BookingRefundStatus",
    "refundedAt" TIMESTAMP(3),
    "refundFailureReason" TEXT,
    "cancellationReason" TEXT,
    "cancelledByRole" "BookingCancellationActor",
    "price" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingPaymentRefund" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "receipt" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "razorpayRefundId" TEXT,
    "status" "BookingRefundStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "BookingPaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenMatch" (
    "id" TEXT NOT NULL,
    "matchCode" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "hostTeamId" TEXT,
    "turfId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "matchType" "OpenMatchType" NOT NULL,
    "status" "OpenMatchStatus" NOT NULL DEFAULT 'OPEN',
    "teamSize" INTEGER NOT NULL,
    "minPlayers" INTEGER NOT NULL DEFAULT 2,
    "maxPlayers" INTEGER NOT NULL,
    "spotsFilled" INTEGER NOT NULL DEFAULT 1,
    "entryFeePerPlayer" INTEGER NOT NULL,
    "teamEntryFee" INTEGER,
    "sessionStartAt" TIMESTAMP(3),
    "sessionEndAt" TIMESTAMP(3),
    "totalSlotPrice" INTEGER,
    "offlineCollectionAmount" INTEGER NOT NULL DEFAULT 0,
    "offlineCollectionConfirmedAt" TIMESTAMP(3),
    "offlineCollectionNote" TEXT,
    "payoutStatus" "OpenMatchPayoutStatus" NOT NULL DEFAULT 'HELD',
    "payoutEligibleAt" TIMESTAMP(3),
    "payoutReleasedAt" TIMESTAMP(3),
    "payoutReference" TEXT,
    "reservedSlotCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenMatchResult" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "status" "OpenMatchResultStatus" NOT NULL DEFAULT 'PENDING_RESULT',
    "confirmedWinnerTeamId" TEXT,
    "lastSubmittedByTeamId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenMatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenMatchResultSubmission" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "captainUserId" TEXT NOT NULL,
    "outcome" "OpenMatchTeamResultOutcome" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenMatchResultSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenMatchSlot" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenMatchSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenMatchParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userTeamId" TEXT,
    "kind" "OpenMatchParticipantKind" NOT NULL,
    "status" "OpenMatchParticipantStatus" NOT NULL DEFAULT 'PAID',
    "teamName" TEXT,
    "playerCount" INTEGER NOT NULL DEFAULT 1,
    "selectedMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amountPaid" INTEGER NOT NULL,
    "paymentProvider" "PaymentGatewayProvider",
    "paymentOrderId" TEXT,
    "paymentId" TEXT,
    "paymentSignature" TEXT,
    "paymentCapturedAt" TIMESTAMP(3),
    "refundStatus" "OpenMatchRefundStatus",
    "refundedAt" TIMESTAMP(3),
    "refundFailureReason" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "OpenMatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenMatchPaymentRefund" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "receipt" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "razorpayRefundId" TEXT,
    "status" "OpenMatchRefundStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenMatchPaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenMatchPayoutRelease" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "payoutMethod" "PayoutMethod" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "razorpayContactId" TEXT,
    "razorpayFundAccountId" TEXT,
    "razorpayPayoutId" TEXT,
    "status" "OpenMatchPayoutReleaseStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "utr" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenMatchPayoutRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "tournamentCode" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "turfId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "sport" TEXT NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'OPEN',
    "fixtureType" "TournamentFixtureType" NOT NULL DEFAULT 'LEAGUE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "oversPerInnings" INTEGER,
    "maxTeams" INTEGER NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "substituteCount" INTEGER NOT NULL DEFAULT 0,
    "entryFeePerTeam" INTEGER NOT NULL DEFAULT 0,
    "registrationOfferMode" "TournamentRegistrationOfferMode" NOT NULL DEFAULT 'GLOBAL',
    "registrationOfferEnabled" BOOLEAN,
    "registrationOfferDiscountPercent" INTEGER,
    "pointsForWin" INTEGER NOT NULL DEFAULT 3,
    "pointsForDraw" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentRegistrationOfferSetting" (
    "id" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "discountPercent" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentRegistrationOfferSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingPaymentGatewaySetting" (
    "id" TEXT NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL DEFAULT 'RAZORPAY',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "razorpayKeyId" TEXT,
    "razorpayKeySecret" TEXT,
    "razorpayWebhookSecret" TEXT,
    "razorpayXKeyId" TEXT,
    "razorpayXKeySecret" TEXT,
    "razorpayXSourceAccountNumber" TEXT,
    "autoRefundsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingPaymentGatewaySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationPolicySetting" (
    "id" TEXT NOT NULL,
    "bookingFullRefundHours" INTEGER NOT NULL DEFAULT 24,
    "bookingPartialRefundHours" INTEGER NOT NULL DEFAULT 6,
    "bookingPartialRefundPercent" INTEGER NOT NULL DEFAULT 50,
    "bookingNoRefundHours" INTEGER NOT NULL DEFAULT 1,
    "openMatchFullRefundHours" INTEGER NOT NULL DEFAULT 24,
    "openMatchPartialRefundHours" INTEGER NOT NULL DEFAULT 6,
    "openMatchPartialRefundPercent" INTEGER NOT NULL DEFAULT 50,
    "openMatchNoRefundHours" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationPolicySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeam" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "userTeamId" TEXT,
    "name" TEXT NOT NULL,
    "status" "TournamentTeamStatus" NOT NULL DEFAULT 'JOINED',
    "seed" INTEGER,
    "registeredMainPlayerCount" INTEGER NOT NULL DEFAULT 0,
    "mainPlayerTarget" INTEGER NOT NULL DEFAULT 0,
    "discountPercentApplied" INTEGER NOT NULL DEFAULT 0,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "finalEntryFee" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTeam" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "sport" TEXT,
    "sports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "mobileNumber" TEXT,
    "role" "UserTeamMemberRole" NOT NULL DEFAULT 'PLAYER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentPlayer" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "isSubstitute" BOOLEAN NOT NULL DEFAULT false,
    "jerseyNo" TEXT,
    "position" TEXT,
    "hp" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "status" "TournamentMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "matchOutcome" "TournamentMatchOutcome" NOT NULL DEFAULT 'NORMAL',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "homeWickets" INTEGER,
    "awayWickets" INTEGER,
    "homeOvers" TEXT,
    "awayOvers" TEXT,
    "battingFirstSide" "TournamentBattingSide",
    "liveScorecard" JSONB,
    "resultNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentStanding" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "scoreFor" INTEGER NOT NULL DEFAULT 0,
    "scoreAgainst" INTEGER NOT NULL DEFAULT 0,
    "scoreDiff" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentStanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentEntryPayment" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "teamId" TEXT,
    "payerUserId" TEXT NOT NULL,
    "payoutTargetType" "TournamentPayoutTargetType" NOT NULL,
    "payoutRecipientUserId" TEXT,
    "status" "TournamentEntryPaymentStatus" NOT NULL DEFAULT 'PAID',
    "amount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "finalEntryFee" INTEGER NOT NULL,
    "paymentProvider" "PaymentGatewayProvider",
    "paymentOrderId" TEXT,
    "paymentId" TEXT,
    "paymentSignature" TEXT,
    "paymentCapturedAt" TIMESTAMP(3),
    "payoutStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "payoutMethod" "PayoutMethod",
    "payoutReference" TEXT,
    "razorpayContactId" TEXT,
    "razorpayFundAccountId" TEXT,
    "razorpayPayoutId" TEXT,
    "payoutReleasedAt" TIMESTAMP(3),
    "payoutFailureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentEntryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentEntryPaymentRefund" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "entryPaymentId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "receipt" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "razorpayRefundId" TEXT,
    "status" "BookingRefundStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentEntryPaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "TurfOwnerVerification_userId_key" ON "TurfOwnerVerification"("userId");

-- CreateIndex
CREATE INDEX "TurfOwnerVerification_status_submittedAt_idx" ON "TurfOwnerVerification"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Turf_registrationNumber_key" ON "Turf"("registrationNumber");

-- CreateIndex
CREATE INDEX "Turf_status_createdAt_idx" ON "Turf"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Turf_name_idx" ON "Turf"("name");

-- CreateIndex
CREATE INDEX "Turf_ownerName_idx" ON "Turf"("ownerName");

-- CreateIndex
CREATE INDEX "Turf_city_idx" ON "Turf"("city");

-- CreateIndex
CREATE INDEX "Turf_ownerUserId_idx" ON "Turf"("ownerUserId");

-- CreateIndex
CREATE INDEX "Turf_ownerEmail_idx" ON "Turf"("ownerEmail");

-- CreateIndex
CREATE INDEX "Turf_ownerPhone_idx" ON "Turf"("ownerPhone");

-- CreateIndex
CREATE INDEX "Turf_latitude_longitude_idx" ON "Turf"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "TurfAvailabilityRule_turfId_isActive_idx" ON "TurfAvailabilityRule"("turfId", "isActive");

-- CreateIndex
CREATE INDEX "TurfSlot_turfId_startAt_status_idx" ON "TurfSlot"("turfId", "startAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TurfSlot_turfId_startAt_key" ON "TurfSlot"("turfId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_bookingCode_key" ON "Booking"("bookingCode");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_slotId_key" ON "Booking"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_paymentOrderId_key" ON "Booking"("paymentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_paymentId_key" ON "Booking"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_razorpayPayoutId_key" ON "Booking"("razorpayPayoutId");

-- CreateIndex
CREATE INDEX "Booking_userId_createdAt_idx" ON "Booking"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_turfId_createdAt_idx" ON "Booking"("turfId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_status_createdAt_idx" ON "Booking"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_payoutStatus_createdAt_idx" ON "Booking"("payoutStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingPaymentRefund_receipt_key" ON "BookingPaymentRefund"("receipt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingPaymentRefund_razorpayRefundId_key" ON "BookingPaymentRefund"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "BookingPaymentRefund_bookingId_requestedAt_idx" ON "BookingPaymentRefund"("bookingId", "requestedAt");

-- CreateIndex
CREATE INDEX "BookingPaymentRefund_razorpayPaymentId_idx" ON "BookingPaymentRefund"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatch_matchCode_key" ON "OpenMatch"("matchCode");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatch_slotId_key" ON "OpenMatch"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatch_bookingId_key" ON "OpenMatch"("bookingId");

-- CreateIndex
CREATE INDEX "OpenMatch_status_sport_createdAt_idx" ON "OpenMatch"("status", "sport", "createdAt");

-- CreateIndex
CREATE INDEX "OpenMatch_turfId_createdAt_idx" ON "OpenMatch"("turfId", "createdAt");

-- CreateIndex
CREATE INDEX "OpenMatch_hostUserId_createdAt_idx" ON "OpenMatch"("hostUserId", "createdAt");

-- CreateIndex
CREATE INDEX "OpenMatch_hostTeamId_createdAt_idx" ON "OpenMatch"("hostTeamId", "createdAt");

-- CreateIndex
CREATE INDEX "OpenMatch_sessionStartAt_sessionEndAt_idx" ON "OpenMatch"("sessionStartAt", "sessionEndAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchResult_matchId_key" ON "OpenMatchResult"("matchId");

-- CreateIndex
CREATE INDEX "OpenMatchResult_status_updatedAt_idx" ON "OpenMatchResult"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "OpenMatchResultSubmission_teamId_createdAt_idx" ON "OpenMatchResultSubmission"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchResultSubmission_resultId_teamId_key" ON "OpenMatchResultSubmission"("resultId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchSlot_slotId_key" ON "OpenMatchSlot"("slotId");

-- CreateIndex
CREATE INDEX "OpenMatchSlot_matchId_position_idx" ON "OpenMatchSlot"("matchId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchSlot_matchId_slotId_key" ON "OpenMatchSlot"("matchId", "slotId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchParticipant_paymentOrderId_key" ON "OpenMatchParticipant"("paymentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchParticipant_paymentId_key" ON "OpenMatchParticipant"("paymentId");

-- CreateIndex
CREATE INDEX "OpenMatchParticipant_userId_joinedAt_idx" ON "OpenMatchParticipant"("userId", "joinedAt");

-- CreateIndex
CREATE INDEX "OpenMatchParticipant_matchId_status_idx" ON "OpenMatchParticipant"("matchId", "status");

-- CreateIndex
CREATE INDEX "OpenMatchParticipant_userTeamId_joinedAt_idx" ON "OpenMatchParticipant"("userTeamId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchParticipant_matchId_userId_key" ON "OpenMatchParticipant"("matchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchPaymentRefund_receipt_key" ON "OpenMatchPaymentRefund"("receipt");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchPaymentRefund_razorpayRefundId_key" ON "OpenMatchPaymentRefund"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "OpenMatchPaymentRefund_matchId_status_requestedAt_idx" ON "OpenMatchPaymentRefund"("matchId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "OpenMatchPaymentRefund_participantId_status_idx" ON "OpenMatchPaymentRefund"("participantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchPayoutRelease_matchId_key" ON "OpenMatchPayoutRelease"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchPayoutRelease_idempotencyKey_key" ON "OpenMatchPayoutRelease"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchPayoutRelease_referenceId_key" ON "OpenMatchPayoutRelease"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenMatchPayoutRelease_razorpayPayoutId_key" ON "OpenMatchPayoutRelease"("razorpayPayoutId");

-- CreateIndex
CREATE INDEX "OpenMatchPayoutRelease_status_requestedAt_idx" ON "OpenMatchPayoutRelease"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_createdAt_idx" ON "Notification"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_tournamentCode_key" ON "Tournament"("tournamentCode");

-- CreateIndex
CREATE INDEX "Tournament_status_sport_createdAt_idx" ON "Tournament"("status", "sport", "createdAt");

-- CreateIndex
CREATE INDEX "Tournament_hostUserId_createdAt_idx" ON "Tournament"("hostUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Tournament_turfId_createdAt_idx" ON "Tournament"("turfId", "createdAt");

-- CreateIndex
CREATE INDEX "TournamentTeam_ownerUserId_createdAt_idx" ON "TournamentTeam"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TournamentTeam_userTeamId_idx" ON "TournamentTeam"("userTeamId");

-- CreateIndex
CREATE INDEX "TournamentTeam_tournamentId_status_idx" ON "TournamentTeam"("tournamentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeam_tournamentId_name_key" ON "TournamentTeam"("tournamentId", "name");

-- CreateIndex
CREATE INDEX "UserTeam_ownerUserId_createdAt_idx" ON "UserTeam"("ownerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserTeam_ownerUserId_name_key" ON "UserTeam"("ownerUserId", "name");

-- CreateIndex
CREATE INDEX "UserTeamMember_teamId_role_idx" ON "UserTeamMember"("teamId", "role");

-- CreateIndex
CREATE INDEX "UserTeamMember_userId_idx" ON "UserTeamMember"("userId");

-- CreateIndex
CREATE INDEX "TournamentPlayer_userId_idx" ON "TournamentPlayer"("userId");

-- CreateIndex
CREATE INDEX "TournamentPlayer_teamId_idx" ON "TournamentPlayer"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPlayer_teamId_userId_key" ON "TournamentPlayer"("teamId", "userId");

-- CreateIndex
CREATE INDEX "TournamentMatch_tournamentId_round_idx" ON "TournamentMatch"("tournamentId", "round");

-- CreateIndex
CREATE INDEX "TournamentMatch_status_scheduledAt_idx" ON "TournamentMatch"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_tournamentId_homeTeamId_awayTeamId_key" ON "TournamentMatch"("tournamentId", "homeTeamId", "awayTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStanding_teamId_key" ON "TournamentStanding"("teamId");

-- CreateIndex
CREATE INDEX "TournamentStanding_tournamentId_points_scoreDiff_idx" ON "TournamentStanding"("tournamentId", "points", "scoreDiff");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStanding_tournamentId_teamId_key" ON "TournamentStanding"("tournamentId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentEntryPayment_teamId_key" ON "TournamentEntryPayment"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentEntryPayment_paymentOrderId_key" ON "TournamentEntryPayment"("paymentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentEntryPayment_paymentId_key" ON "TournamentEntryPayment"("paymentId");

-- CreateIndex
CREATE INDEX "TournamentEntryPayment_tournamentId_createdAt_idx" ON "TournamentEntryPayment"("tournamentId", "createdAt");

-- CreateIndex
CREATE INDEX "TournamentEntryPayment_payerUserId_createdAt_idx" ON "TournamentEntryPayment"("payerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TournamentEntryPayment_payoutTargetType_payoutStatus_idx" ON "TournamentEntryPayment"("payoutTargetType", "payoutStatus");

-- CreateIndex
CREATE INDEX "TournamentEntryPayment_payoutRecipientUserId_createdAt_idx" ON "TournamentEntryPayment"("payoutRecipientUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentEntryPaymentRefund_receipt_key" ON "TournamentEntryPaymentRefund"("receipt");

-- CreateIndex
CREATE INDEX "TournamentEntryPaymentRefund_tournamentId_status_requestedA_idx" ON "TournamentEntryPaymentRefund"("tournamentId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "TournamentEntryPaymentRefund_entryPaymentId_status_idx" ON "TournamentEntryPaymentRefund"("entryPaymentId", "status");

-- CreateIndex
CREATE INDEX "TournamentEntryPaymentRefund_payerUserId_requestedAt_idx" ON "TournamentEntryPaymentRefund"("payerUserId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- AddForeignKey
ALTER TABLE "TurfOwnerVerification" ADD CONSTRAINT "TurfOwnerVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turf" ADD CONSTRAINT "Turf_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turf" ADD CONSTRAINT "Turf_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurfAvailabilityRule" ADD CONSTRAINT "TurfAvailabilityRule_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "Turf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurfSlot" ADD CONSTRAINT "TurfSlot_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "Turf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "Turf"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TurfSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPaymentRefund" ADD CONSTRAINT "BookingPaymentRefund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatch" ADD CONSTRAINT "OpenMatch_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatch" ADD CONSTRAINT "OpenMatch_hostTeamId_fkey" FOREIGN KEY ("hostTeamId") REFERENCES "UserTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatch" ADD CONSTRAINT "OpenMatch_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "Turf"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatch" ADD CONSTRAINT "OpenMatch_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TurfSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatch" ADD CONSTRAINT "OpenMatch_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchResult" ADD CONSTRAINT "OpenMatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "OpenMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchResultSubmission" ADD CONSTRAINT "OpenMatchResultSubmission_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "OpenMatchResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchSlot" ADD CONSTRAINT "OpenMatchSlot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "OpenMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchSlot" ADD CONSTRAINT "OpenMatchSlot_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TurfSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchParticipant" ADD CONSTRAINT "OpenMatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "OpenMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchParticipant" ADD CONSTRAINT "OpenMatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchParticipant" ADD CONSTRAINT "OpenMatchParticipant_userTeamId_fkey" FOREIGN KEY ("userTeamId") REFERENCES "UserTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchPaymentRefund" ADD CONSTRAINT "OpenMatchPaymentRefund_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "OpenMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchPaymentRefund" ADD CONSTRAINT "OpenMatchPaymentRefund_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "OpenMatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenMatchPayoutRelease" ADD CONSTRAINT "OpenMatchPayoutRelease_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "OpenMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "Turf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_userTeamId_fkey" FOREIGN KEY ("userTeamId") REFERENCES "UserTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeamMember" ADD CONSTRAINT "UserTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "UserTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeamMember" ADD CONSTRAINT "UserTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "TournamentTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "TournamentTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStanding" ADD CONSTRAINT "TournamentStanding_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStanding" ADD CONSTRAINT "TournamentStanding_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntryPayment" ADD CONSTRAINT "TournamentEntryPayment_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntryPayment" ADD CONSTRAINT "TournamentEntryPayment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntryPayment" ADD CONSTRAINT "TournamentEntryPayment_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntryPayment" ADD CONSTRAINT "TournamentEntryPayment_payoutRecipientUserId_fkey" FOREIGN KEY ("payoutRecipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntryPaymentRefund" ADD CONSTRAINT "TournamentEntryPaymentRefund_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntryPaymentRefund" ADD CONSTRAINT "TournamentEntryPaymentRefund_entryPaymentId_fkey" FOREIGN KEY ("entryPaymentId") REFERENCES "TournamentEntryPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntryPaymentRefund" ADD CONSTRAINT "TournamentEntryPaymentRefund_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
