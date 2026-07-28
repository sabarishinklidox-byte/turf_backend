import { z } from "zod";

const latitudeSchema = z.coerce.number().min(-90).max(90);
const longitudeSchema = z.coerce.number().min(-180).max(180);
const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
}, z.boolean());
const formBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
}, z.boolean());

export const listPublicTurfsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
    search: z.string().trim().max(100).optional(),
    city: z.string().trim().max(80).optional(),
    sport: z.string().trim().max(60).optional(),
  }),
});

export const publicTurfIdSchema = z.object({
  params: z.object({ turfId: z.string().trim().min(1) }),
});

export const listPublicSlotsSchema = z.object({
  params: z.object({ turfId: z.string().trim().min(1) }),
  query: z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    includeUnavailable: queryBooleanSchema.default(false),
  }),
});

export const createBookingSchema = z.object({
  body: z.object({
    slotId: z.string().trim().min(1),
  }),
});

export const createBookingPaymentOrderSchema = z.object({
  body: z.object({
    slotId: z.string().trim().min(1),
  }),
});

export const verifyBookingPaymentSchema = z.object({
  body: z.object({
    slotId: z.string().trim().min(1),
    razorpayOrderId: z.string().trim().min(1),
    razorpayPaymentId: z.string().trim().min(1),
    razorpaySignature: z.string().trim().min(1),
  }),
});

export const bookingIdSchema = z.object({
  params: z.object({ bookingId: z.string().trim().min(1) }),
});

export const listOpenMatchesSchema = z.object({
  query: z.object({
    sport: z.string().trim().max(60).optional(),
    city: z.string().trim().max(80).optional(),
    status: z.enum(["OPEN", "READY", "FULL", "CANCELLED", "COMPLETED"]).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    radiusKm: z.coerce.number().min(1).max(100).optional(),
  }),
});

const optionalMobileNumberSchema = z.preprocess(
  (value) => (value === undefined || value === null || value === "" ? undefined : value),
  z.string().trim().regex(/^[0-9]{10}$/, "Enter a valid 10 digit mobile number").optional(),
);
const parseJsonField = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const userTeamMemberSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120).optional(),
  mobileNumber: optionalMobileNumberSchema,
  role: z.enum(["CAPTAIN", "VICE_CAPTAIN", "PLAYER"]).default("PLAYER"),
});

const userTeamBodySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    sport: z.string().trim().min(2).max(60).optional(),
    sports: z.preprocess(parseJsonField, z.array(z.string().trim().min(2).max(60)).min(1).max(8).optional()),
    members: z.preprocess(parseJsonField, z.array(userTeamMemberSchema).min(2).max(20)),
  })
  .superRefine(({ sport, sports, members }, context) => {
    if (!sport && (!sports || sports.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["sports"],
        message: "Select at least one sport",
      });
    }

    const captainCount = members.filter((member) => member.role === "CAPTAIN").length;
    const viceCaptainCount = members.filter((member) => member.role === "VICE_CAPTAIN").length;

    if (captainCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "Select exactly one captain",
      });
    }

    if (viceCaptainCount > 1) {
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "Select only one vice captain",
      });
    }

    if (members.length < 2 || members.length > 20) {
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "Team should have 2 to 20 members",
      });
    }

    members.forEach((member, index) => {
      if (!member.email && !member.mobileNumber) {
        context.addIssue({
          code: "custom",
          path: ["members", index],
          message: "Every team member needs email or mobile number",
        });
      }
    });
  });

export const createUserTeamSchema = z.object({
  body: userTeamBodySchema,
});

export const updateUserTeamSchema = z.object({
  params: z.object({ teamId: z.string().trim().min(1) }),
  body: userTeamBodySchema,
});

export const createOpenMatchSchema = z.object({
  body: z
    .object({
      slotId: z.string().trim().min(1).optional(),
      slotIds: z.array(z.string().trim().min(1)).min(1).optional(),
      hostTeamId: z.string().trim().min(1).optional(),
      hostMemberIds: z.array(z.string().trim().min(1)).max(30).optional(),
      title: z.string().trim().min(3).max(100).optional(),
      sport: z.string().trim().min(2).max(60),
      matchType: z.enum(["PLAYER_JOIN", "TEAM_VS_TEAM", "NEED_OPPONENT_TEAM"]),
      teamSize: z.coerce.number().int().min(1).max(30),
      minPlayers: z.coerce.number().int().min(2).max(60).optional(),
      maxPlayers: z.coerce.number().int().min(2).max(60),
      entryFeePerPlayer: z.coerce.number().int().min(0).max(100000),
      teamEntryFee: z.coerce.number().int().min(0).max(1000000).optional(),
    })
    .superRefine(({ slotId, slotIds, matchType, minPlayers, maxPlayers }, context) => {
      if (!slotId && (!slotIds || slotIds.length === 0)) {
        context.addIssue({ code: "custom", path: ["slotId"], message: "Select at least one slot" });
      }
      if (matchType === "PLAYER_JOIN" && minPlayers && minPlayers > maxPlayers) {
        context.addIssue({ code: "custom", path: ["minPlayers"], message: "Minimum players cannot be more than total players" });
      }
    }),
});

export const createOpenMatchPaymentOrderSchema = createOpenMatchSchema;

export const verifyOpenMatchPaymentSchema = z.object({
  body: createOpenMatchSchema.shape.body.extend({
    razorpayOrderId: z.string().trim().min(1),
    razorpayPaymentId: z.string().trim().min(1),
    razorpaySignature: z.string().trim().min(1),
  }),
});

export const openMatchIdSchema = z.object({
  params: z.object({ matchId: z.string().trim().min(1) }),
});

export const joinOpenMatchSchema = z.object({
  params: z.object({ matchId: z.string().trim().min(1) }),
  body: z.object({
    participantKind: z.enum(["PLAYER", "TEAM"]).default("PLAYER"),
    teamName: z.string().trim().min(2).max(80).optional(),
    userTeamId: z.string().trim().min(1).optional(),
    memberIds: z.array(z.string().trim().min(1)).max(30).optional(),
    playerCount: z.coerce.number().int().min(1).max(60).optional(),
  }),
});

export const createOpenMatchJoinPaymentOrderSchema = joinOpenMatchSchema;

export const verifyOpenMatchJoinPaymentSchema = z.object({
  params: z.object({ matchId: z.string().trim().min(1) }),
  body: joinOpenMatchSchema.shape.body.extend({
    razorpayOrderId: z.string().trim().min(1),
    razorpayPaymentId: z.string().trim().min(1),
    razorpaySignature: z.string().trim().min(1),
  }),
});

export const submitOpenMatchResultSchema = z.object({
  params: z.object({ matchId: z.string().trim().min(1) }),
  body: z.object({
    outcome: z.enum(["WIN", "DRAW", "LOSS"]),
    note: z.string().trim().max(300).optional(),
  }),
});

export const notificationIdSchema = z.object({
  params: z.object({ notificationId: z.string().trim().min(1) }),
});

export const updateUserLocationSchema = z.object({
  body: z.object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
  }),
});

export const listTournamentsSchema = z.object({
  query: z.object({
    sport: z.string().trim().max(60).optional(),
    city: z.string().trim().max(80).optional(),
    status: z.enum(["OPEN", "FULL", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  }),
});

export const listTournamentPaymentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
    payoutTargetType: z.enum(["TURF_OWNER", "PLATFORM"]).optional(),
    payoutStatus: z.string().trim().max(40).optional(),
  }),
});

export const tournamentIdSchema = z.object({
  params: z.object({ tournamentId: z.string().trim().min(1) }),
});

export const cancelTournamentSchema = z.object({
  params: z.object({ tournamentId: z.string().trim().min(1) }),
  body: z.object({
    reason: z.string().trim().min(3).max(300),
  }),
});

export const tournamentPlayerEmailStatusSchema = z.object({
  params: z.object({ tournamentId: z.string().trim().min(1) }),
  query: z.object({
    email: z.string().trim().email().max(120),
  }),
});

export const teamMemberStatusSchema = z.object({
  query: z
    .object({
      email: z.string().trim().email().max(120).optional(),
      mobileNumber: optionalMobileNumberSchema,
    })
    .superRefine(({ email, mobileNumber }, context) => {
      if (!email && !mobileNumber) {
        context.addIssue({
          code: "custom",
          path: ["email"],
          message: "Enter an email or mobile number",
        });
      }
    }),
});

export const inviteTeamMemberSchema = z.object({
  body: z.object({
    email: z.string().trim().email().max(120),
    displayName: z.string().trim().min(2).max(80).optional(),
    teamName: z.string().trim().min(2).max(80).optional(),
  }),
});

export const createTournamentSchema = z.object({
  body: z
    .object({
      turfId: z.string().trim().min(1).optional(),
      title: z.string().trim().min(3).max(120),
      description: z.string().trim().max(1200).optional().or(z.literal("")),
      coverImageUrl: z.string().trim().max(300).optional(),
      sport: z.string().trim().min(2).max(60),
      fixtureType: z.enum(["LEAGUE", "KNOCKOUT", "MANUAL"]).default("LEAGUE"),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      oversPerInnings: z.coerce.number().int().min(1).max(100).optional(),
      maxTeams: z.coerce.number().int().min(2).max(64),
      teamSize: z.coerce.number().int().min(1).max(30),
      substituteCount: z.coerce.number().int().min(0).max(20).default(0),
      entryFeePerTeam: z.coerce.number().int().min(0).max(1000000).default(0),
      registrationOfferMode: z.enum(["GLOBAL", "CUSTOM", "DISABLED"]).default("GLOBAL"),
      registrationOfferEnabled: formBooleanSchema.optional(),
      registrationOfferDiscountPercent: z.coerce.number().int().min(1).max(100).optional(),
      pointsForWin: z.coerce.number().int().min(1).max(20).default(3),
      pointsForDraw: z.coerce.number().int().min(0).max(20).default(1),
    })
    .superRefine(({ startDate, endDate, sport, oversPerInnings, registrationOfferMode, registrationOfferEnabled, registrationOfferDiscountPercent }, context) => {
      if (startDate && endDate && endDate < startDate) {
        context.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date" });
      }
      if (sport?.trim().toLowerCase() === "cricket" && oversPerInnings === undefined) {
        context.addIssue({ code: "custom", path: ["oversPerInnings"], message: "Enter overs per innings for cricket tournaments" });
      }
      if (registrationOfferMode === "CUSTOM") {
        if (registrationOfferEnabled === undefined) {
          context.addIssue({ code: "custom", path: ["registrationOfferEnabled"], message: "Choose whether the custom offer is enabled" });
        }
        if (registrationOfferEnabled && registrationOfferDiscountPercent === undefined) {
          context.addIssue({ code: "custom", path: ["registrationOfferDiscountPercent"], message: "Enter a custom discount percent" });
        }
      }
    }),
});

const joinTournamentBodySchema = z.object({
  submissionType: z.enum(["DRAFT", "FINAL"]).default("FINAL"),
  userTeamId: z.string().trim().min(1).optional(),
  teamName: z.string().trim().min(2).max(80),
  captainName: z.string().trim().min(2).max(80).optional(),
  players: z
    .array(
      z.object({
        userId: z.string().trim().min(1).optional(),
        displayName: z.string().trim().min(2).max(80),
        email: z.string().trim().email().max(120).optional(),
        jerseyNo: z.string().trim().max(12).optional(),
        position: z.string().trim().max(40).optional(),
      }),
    )
    .max(30)
    .optional(),
});

export const joinTournamentSchema = z.object({
  params: z.object({ tournamentId: z.string().trim().min(1) }),
  body: joinTournamentBodySchema,
});

export const createTournamentEntryPaymentOrderSchema = joinTournamentSchema;

export const verifyTournamentEntryPaymentSchema = z.object({
  params: z.object({ tournamentId: z.string().trim().min(1) }),
  body: joinTournamentBodySchema.extend({
    razorpayOrderId: z.string().trim().min(1),
    razorpayPaymentId: z.string().trim().min(1),
    razorpaySignature: z.string().trim().min(1),
  }),
});

export const inviteTournamentPlayerSchema = z.object({
  params: z.object({ tournamentId: z.string().trim().min(1) }),
  body: z.object({
    email: z.string().trim().email().max(120),
    displayName: z.string().trim().min(2).max(80).optional(),
  }),
});

export const tournamentMatchIdSchema = z.object({
  params: z.object({
    tournamentId: z.string().trim().min(1),
    matchId: z.string().trim().min(1),
  }),
});

export const tournamentMatchResultSchema = z.object({
  params: z.object({
    tournamentId: z.string().trim().min(1),
    matchId: z.string().trim().min(1),
  }),
  body: z.object({
    homeScore: z.coerce.number().int().min(0).max(100000),
    awayScore: z.coerce.number().int().min(0).max(100000),
    homeWickets: z.coerce.number().int().min(0).max(50).optional(),
    awayWickets: z.coerce.number().int().min(0).max(50).optional(),
    homeOvers: z
      .preprocess((value) => (value === undefined || value === null || value === "" ? undefined : String(value).trim()), z.string().regex(/^\d{1,3}(\.[0-5])?$/, "Enter overs like 20 or 18.3").optional()),
    awayOvers: z
      .preprocess((value) => (value === undefined || value === null || value === "" ? undefined : String(value).trim()), z.string().regex(/^\d{1,3}(\.[0-5])?$/, "Enter overs like 20 or 18.3").optional()),
    battingFirstSide: z.enum(["HOME", "AWAY"]).optional(),
    matchOutcome: z.enum(["NORMAL", "ABANDONED", "NO_RESULT", "RAIN_AFFECTED", "SUPER_OVER"]).optional(),
    resultNote: z.string().trim().max(300).optional(),
  }),
});

export const tournamentMatchLiveScoreSchema = z.object({
  params: z.object({
    tournamentId: z.string().trim().min(1),
    matchId: z.string().trim().min(1),
  }),
  body: z.object({
    action: z.enum(["INIT", "SET_PLAYERS", "ADD_BALL", "UNDO_BALL", "END_INNINGS"]),
    tossWinnerSide: z.enum(["HOME", "AWAY"]).optional(),
    tossDecision: z.enum(["BAT", "BOWL"]).optional(),
    strikerName: z.string().trim().min(1).max(80).optional(),
    nonStrikerName: z.string().trim().min(1).max(80).optional(),
    bowlerName: z.string().trim().min(1).max(80).optional(),
    eventType: z.enum(["RUN", "WICKET", "WIDE", "NO_BALL", "BYE", "LEG_BYE"]).optional(),
    dismissalType: z.enum(["BOWLED", "CAUGHT", "LBW", "RUN_OUT", "STUMPED", "HIT_WICKET", "RETIRED_OUT", "RETIRED_HURT"]).optional(),
    dismissedPlayerName: z.string().trim().min(1).max(80).optional(),
    fielderName: z.string().trim().min(1).max(80).optional(),
    nextBatterName: z.string().trim().min(1).max(80).optional(),
    runs: z.coerce.number().int().min(0).max(6).optional(),
    batRuns: z.coerce.number().int().min(0).max(6).optional(),
    totalRuns: z.coerce.number().int().min(0).max(10).optional(),
  }),
});

export const createTournamentManualMatchSchema = z.object({
  params: z.object({
    tournamentId: z.string().trim().min(1),
  }),
  body: z
    .object({
      homeTeamId: z.string().trim().min(1),
      awayTeamId: z.string().trim().min(1),
      round: z.coerce.number().int().min(1).max(100).optional(),
      scheduledAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
    })
    .superRefine(({ homeTeamId, awayTeamId }, context) => {
      if (homeTeamId === awayTeamId) {
        context.addIssue({ code: "custom", path: ["awayTeamId"], message: "Choose two different teams" });
      }
    }),
});
