import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/utils/app-error.js";
import { __testing } from "../src/services/user.service.js";

test("createConfirmedBooking marks the slot booked and stores payment metadata", async () => {
  let bookingCreatePayload = null;
  const transaction = {
    turfSlot: {
      async updateMany() {
        return { count: 1 };
      },
    },
    booking: {
      async create({ data, include }) {
        bookingCreatePayload = { data, include };
        return {
          id: "booking-1",
          ...data,
          slot: { id: data.slotId, turfId: data.turfId, startAt: new Date("2026-07-20T12:00:00.000Z"), endAt: new Date("2026-07-20T13:00:00.000Z"), price: data.price, status: "BOOKED" },
          turf: { id: data.turfId, registrationNumber: "REG-1", name: "Arena", description: "", address: "", city: "Coimbatore", state: "Tamil Nadu", postalCode: "641001", landmark: "", latitude: null, longitude: null, sports: ["Football"], surfaceType: "Grass", openingTime: "06:00", closingTime: "22:00", amenities: [], imageUrls: [], ownerName: "Owner", pricePerHour: 1000, _count: { slots: 4 } },
        };
      },
    },
  };

  const payment = {
    provider: "RAZORPAY",
    paymentOrderId: "order_1",
    paymentId: "pay_1",
    paymentSignature: "sig_1",
    paymentCapturedAt: new Date("2026-07-18T10:00:00.000Z"),
  };

  const result = await __testing.createConfirmedBooking(transaction, {
    userId: "user-1",
    slot: {
      id: "slot-1",
      turfId: "turf-1",
      price: 1400,
    },
    payment,
  });

  assert.equal(result.id, "booking-1");
  assert.equal(bookingCreatePayload.data.slotId, "slot-1");
  assert.equal(bookingCreatePayload.data.paymentOrderId, "order_1");
  assert.equal(bookingCreatePayload.data.paymentId, "pay_1");
  assert.deepEqual(bookingCreatePayload.include, { slot: true, turf: true });
});

test("createConfirmedBooking throws conflict when the slot is already reserved", async () => {
  const transaction = {
    turfSlot: {
      async updateMany() {
        return { count: 0 };
      },
    },
    booking: {
      async create() {
        throw new Error("booking.create should not run");
      },
    },
  };

  await assert.rejects(
    () =>
      __testing.createConfirmedBooking(transaction, {
        userId: "user-1",
        slot: { id: "slot-1", turfId: "turf-1", price: 1400 },
      }),
    (error) => error instanceof AppError && error.statusCode === 409 && error.message === "This slot is no longer available",
  );
});

test("reserveOpenMatchCapacity marks the match ready when the last spots are taken", async () => {
  let updatePayload = null;
  const transaction = {
    openMatch: {
      async updateMany(payload) {
        updatePayload = payload;
        return { count: 1 };
      },
    },
  };

  const nextFilled = await __testing.reserveOpenMatchCapacity(
    transaction,
    { id: "match-1", status: "OPEN", spotsFilled: 8, maxPlayers: 10 },
    2,
  );

  assert.equal(nextFilled, 10);
  assert.equal(updatePayload.where.id, "match-1");
  assert.deepEqual(updatePayload.where.spotsFilled, { lte: 8 });
  assert.equal(updatePayload.data.status, "READY");
  assert.deepEqual(updatePayload.data.spotsFilled, { increment: 2 });
});

test("reserveOpenMatchCapacity rejects when another join already used the last spot", async () => {
  const transaction = {
    openMatch: {
      async updateMany() {
        return { count: 0 };
      },
    },
  };

  await assert.rejects(
    () =>
      __testing.reserveOpenMatchCapacity(
        transaction,
        { id: "match-1", status: "OPEN", spotsFilled: 9, maxPlayers: 10 },
        1,
      ),
    (error) => error instanceof AppError && error.statusCode === 409 && error.message === "Not enough spots left in this match",
  );
});

test("createOpenMatchForSession stores only the host share on the host participant", async () => {
  const bookingRows = [];
  let matchCreatePayload = null;
  const transaction = {
    turfSlot: {
      async updateMany() {
        return { count: 2 };
      },
    },
    booking: {
      async create({ data }) {
        bookingRows.push(data);
        return { id: `booking-${bookingRows.length}`, ...data };
      },
    },
    openMatch: {
      async create({ data }) {
        matchCreatePayload = data;
        return { id: "match-created" };
      },
      async findUnique() {
        return { id: "match-created", participants: [], reservedSlots: [] };
      },
    },
  };

  await __testing.createOpenMatchForSession(
    transaction,
    "user-1",
    {
      title: "Night football",
      sport: "Football",
      matchType: "PLAYER_JOIN",
      maxPlayers: 10,
    },
    {
      hostTeam: null,
      orderedSlots: [
        { id: "slot-1", turfId: "turf-1", price: 1000, startAt: new Date("2026-07-20T12:00:00.000Z"), endAt: new Date("2026-07-20T13:00:00.000Z") },
        { id: "slot-2", turfId: "turf-1", price: 1000, startAt: new Date("2026-07-20T13:00:00.000Z"), endAt: new Date("2026-07-20T14:00:00.000Z") },
      ],
      resolvedTeamSize: 10,
      startingSpots: 1,
      totalSlotPrice: 2000,
      fees: { entryFeePerPlayer: 200, teamEntryFee: null },
      hostPaymentAmount: 200,
    },
    {
      provider: "RAZORPAY",
      paymentOrderId: "order_1",
      paymentId: "pay_1",
      paymentSignature: "sig_1",
      paymentCapturedAt: new Date("2026-07-18T10:00:00.000Z"),
    },
  );

  assert.equal(bookingRows.length, 2);
  assert.equal(matchCreatePayload.participants.create.amountPaid, 200);
  assert.equal(matchCreatePayload.totalSlotPrice, 2000);
  assert.equal(matchCreatePayload.entryFeePerPlayer, 200);
});

test("joinOpenMatchWithPrepared adds one participant and keeps the match open when spots remain", async () => {
  let participantPayload = null;
  let reservePayload = null;
  const transaction = {
    openMatch: {
      async updateMany(payload) {
        reservePayload = payload;
        return { count: 1 };
      },
      async findUnique() {
        return { id: "match-1", participants: [], reservedSlots: [] };
      },
    },
    openMatchParticipant: {
      async create({ data }) {
        participantPayload = data;
        return { id: "participant-1", ...data };
      },
    },
  };

  await __testing.joinOpenMatchWithPrepared(
    transaction,
    "user-2",
    {
      match: { id: "match-1", status: "OPEN", spotsFilled: 4, maxPlayers: 10 },
      isTeamJoin: false,
      linkedTeam: null,
      playerCount: 1,
      amountPaid: 200,
    },
    { participantKind: "PLAYER" },
    {
      provider: "RAZORPAY",
      paymentOrderId: "order_2",
      paymentId: "pay_2",
      paymentSignature: "sig_2",
      paymentCapturedAt: new Date("2026-07-18T10:00:00.000Z"),
    },
  );

  assert.equal(reservePayload.data.status, "OPEN");
  assert.equal(participantPayload.userId, "user-2");
  assert.equal(participantPayload.amountPaid, 200);
  assert.equal(participantPayload.paymentOrderId, "order_2");
});

test("joinOpenMatchWithPrepared rejects duplicate participant inserts with a friendly conflict", async () => {
  const transaction = {
    openMatch: {
      async updateMany() {
        return { count: 1 };
      },
      async findUnique() {
        return { id: "match-1", participants: [], reservedSlots: [] };
      },
    },
    openMatchParticipant: {
      async create() {
        const error = new Error("duplicate");
        error.code = "P2002";
        throw error;
      },
    },
  };

  await assert.rejects(
    () =>
      __testing.joinOpenMatchWithPrepared(
        transaction,
        "user-2",
        {
          match: { id: "match-1", status: "OPEN", spotsFilled: 4, maxPlayers: 10 },
          isTeamJoin: false,
          linkedTeam: null,
          playerCount: 1,
          amountPaid: 200,
        },
        { participantKind: "PLAYER" },
      ),
    (error) => error instanceof AppError && error.statusCode === 409 && error.message === "You have already joined this match",
  );
});

test("serializeOpenMatchFinancials reports outstanding collection until the slot value is fully covered", () => {
  const financials = __testing.serializeOpenMatchFinancials({
    status: "OPEN",
    totalSlotPrice: 2000,
    sessionEndAt: new Date("2026-07-20T14:00:00.000Z"),
    participants: [
      { status: "PAID", amountPaid: 200 },
      { status: "PAID", amountPaid: 200 },
      { status: "CANCELLED", amountPaid: 200 },
    ],
  });

  assert.equal(financials.totalCollectedAmount, 400);
  assert.equal(financials.outstandingCollectionAmount, 1600);
  assert.equal(financials.ownerPayoutAmount, 2000);
  assert.equal(financials.hostPayoutAmount, 0);
});
