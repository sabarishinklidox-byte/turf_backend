import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/utils/app-error.js";
import { __testing } from "../src/services/tournament.service.js";

test("formatCricketInningsScore returns Cricbuzz style innings text", () => {
  assert.equal(__testing.formatCricketInningsScore(176, 6, "20.0"), "176/6 (20.0)");
  assert.equal(__testing.formatCricketInningsScore(98, 2, "12.4"), "98/2 (12.4)");
});

test("getCricketResultSummary returns run margin when the batting first team wins", () => {
  const summary = __testing.getCricketResultSummary(
    {
      sport: "Cricket",
      homeScore: 164,
      awayScore: 157,
      homeWickets: 7,
      awayWickets: 8,
      battingFirstSide: "HOME",
      homeTeam: { name: "Warriors" },
      awayTeam: { name: "Titans" },
    },
    11,
  );

  assert.equal(summary, "Warriors won by 7 runs");
});

test("getCricketResultSummary returns wicket margin when the chasing team wins", () => {
  const summary = __testing.getCricketResultSummary(
    {
      sport: "Cricket",
      homeScore: 149,
      awayScore: 150,
      homeWickets: 9,
      awayWickets: 4,
      battingFirstSide: "HOME",
      homeTeam: { name: "Warriors" },
      awayTeam: { name: "Titans" },
    },
    11,
  );

  assert.equal(summary, "Titans won by 6 wickets");
});

test("getCricketResultSummary returns no result style summaries for special outcomes", () => {
  assert.equal(
    __testing.getCricketResultSummary({
      sport: "Cricket",
      matchOutcome: "ABANDONED",
      homeScore: 0,
      awayScore: 0,
    }),
    "Match abandoned",
  );

  assert.equal(
    __testing.getCricketResultSummary({
      sport: "Cricket",
      matchOutcome: "NO_RESULT",
      homeScore: 0,
      awayScore: 0,
    }),
    "No result",
  );
});

test("getCricketResultSummary returns super over summary", () => {
  const summary = __testing.getCricketResultSummary({
    sport: "Cricket",
    matchOutcome: "SUPER_OVER",
    homeScore: 18,
    awayScore: 15,
    homeTeam: { name: "Warriors" },
    awayTeam: { name: "Titans" },
  });

  assert.equal(summary, "Warriors won in super over");
});

test("normalizeCricketResultInput rejects missing innings details for cricket tournaments", () => {
  assert.throws(
    () =>
      __testing.normalizeCricketResultInput(
        { sport: "Cricket", teamSize: 11 },
        { homeScore: 120, awayScore: 119, homeWickets: 6, awayWickets: 8, homeOvers: "20.0" },
      ),
    (error) => error instanceof AppError && error.statusCode === 422 && error.message === "Enter runs, wickets, overs, and who batted first for both teams",
  );
});

test("normalizeCricketResultInput enforces tournament wicket limits", () => {
  assert.throws(
    () =>
      __testing.normalizeCricketResultInput(
        { sport: "Cricket", teamSize: 5 },
        {
          homeScore: 88,
          awayScore: 90,
          homeWickets: 5,
          awayWickets: 2,
          homeOvers: "10.0",
          awayOvers: "9.3",
          battingFirstSide: "HOME",
        },
      ),
    (error) => error instanceof AppError && error.statusCode === 422 && error.message === "Wickets cannot be more than 4 for this tournament",
  );
});

test("normalizeCricketResultInput allows no result outcomes without innings details", () => {
  assert.deepEqual(
    __testing.normalizeCricketResultInput(
      { sport: "Cricket", teamSize: 11 },
      {
        homeScore: 0,
        awayScore: 0,
        matchOutcome: "NO_RESULT",
      },
    ),
    {
      homeScore: 0,
      awayScore: 0,
      homeWickets: null,
      awayWickets: null,
      homeOvers: null,
      awayOvers: null,
      battingFirstSide: null,
      matchOutcome: "NO_RESULT",
    },
  );
});

test("mutateCricketLiveScorecard starts a live innings from toss details", () => {
  const result = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: null },
    {
      action: "INIT",
      tossWinnerSide: "HOME",
      tossDecision: "BAT",
      strikerName: "A",
      nonStrikerName: "B",
      bowlerName: "C",
    },
  );

  assert.equal(result.matchStatus, "LIVE");
  assert.equal(result.scorecard.activeInningsIndex, 0);
  assert.equal(result.scorecard.innings[0].battingSide, "HOME");
  assert.equal(result.scorecard.innings[0].currentPlayers.strikerName, "A");
});

test("mutateCricketLiveScorecard rotates strike after an odd run", () => {
  const started = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: null },
    {
      action: "INIT",
      tossWinnerSide: "HOME",
      tossDecision: "BAT",
      strikerName: "A",
      nonStrikerName: "B",
      bowlerName: "C",
    },
  );

  const updated = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: started.scorecard },
    {
      action: "ADD_BALL",
      eventType: "RUN",
      runs: 1,
    },
  );

  assert.equal(updated.scorecard.innings[0].currentPlayers.strikerName, "B");
  assert.equal(updated.scorecard.innings[0].currentPlayers.nonStrikerName, "A");
});

test("mutateCricketLiveScorecard keeps the over open for wides", () => {
  const started = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: null },
    {
      action: "INIT",
      tossWinnerSide: "HOME",
      tossDecision: "BAT",
      strikerName: "A",
      nonStrikerName: "B",
      bowlerName: "C",
    },
  );

  const updated = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: started.scorecard },
    {
      action: "ADD_BALL",
      eventType: "WIDE",
      totalRuns: 2,
    },
  );

  assert.equal(updated.scorecard.innings[0].events[0].legalBall, false);
  const summary = __testing.deriveCricketInningsSummary(updated.scorecard.innings[0], 20, 11);
  assert.equal(summary.overs, "0.0");
  assert.equal(summary.currentOverBalls[0].label, "WD2");
});

test("mutateCricketLiveScorecard records no-ball plus bat runs without counting a legal ball", () => {
  const started = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: null },
    {
      action: "INIT",
      tossWinnerSide: "HOME",
      tossDecision: "BAT",
      strikerName: "A",
      nonStrikerName: "B",
      bowlerName: "C",
    },
  );

  const updated = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: started.scorecard },
    {
      action: "ADD_BALL",
      eventType: "NO_BALL",
      batRuns: 4,
      totalRuns: 5,
    },
  );

  const summary = __testing.deriveCricketInningsSummary(updated.scorecard.innings[0], 20, 11);
  assert.equal(summary.overs, "0.0");
  assert.equal(summary.runs, 5);
  assert.equal(summary.batting[0].runs, 4);
  assert.equal(summary.currentOverBalls[0].label, "NB+4");
});

test("deriveCricketInningsSummary tracks wicket details and did not bat list", () => {
  const started = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    {
      liveScorecard: null,
      homeTeam: { players: [{ displayName: "A" }, { displayName: "B" }, { displayName: "C" }] },
      awayTeam: { players: [{ displayName: "X" }, { displayName: "Y" }, { displayName: "Z" }] },
    },
    {
      action: "INIT",
      tossWinnerSide: "HOME",
      tossDecision: "BAT",
      strikerName: "A",
      nonStrikerName: "B",
      bowlerName: "X",
    },
  );

  const updated = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: started.scorecard },
    {
      action: "ADD_BALL",
      eventType: "WICKET",
      dismissalType: "CAUGHT",
      dismissedPlayerName: "A",
      fielderName: "Y",
      nextBatterName: "C",
    },
  );

  const summary = __testing.deriveCricketInningsSummary(updated.scorecard.innings[0], 20, 11);
  assert.equal(summary.batting[0].dismissalText, "A c Y b X");
  assert.equal(summary.bowling[0].wickets, 1);
  assert.deepEqual(summary.didNotBat, []);
});

test("retired hurt does not count as wicket or legal ball", () => {
  const started = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: null },
    {
      action: "INIT",
      tossWinnerSide: "HOME",
      tossDecision: "BAT",
      strikerName: "A",
      nonStrikerName: "B",
      bowlerName: "X",
    },
  );

  const updated = __testing.mutateCricketLiveScorecard(
    { sport: "Cricket", oversPerInnings: 20, teamSize: 11 },
    { liveScorecard: started.scorecard },
    {
      action: "ADD_BALL",
      eventType: "WICKET",
      dismissalType: "RETIRED_HURT",
      dismissedPlayerName: "A",
      nextBatterName: "C",
    },
  );

  const summary = __testing.deriveCricketInningsSummary(updated.scorecard.innings[0], 20, 11);
  assert.equal(summary.wickets, 0);
  assert.equal(summary.overs, "0.0");
  assert.equal(summary.currentOverBalls[0].label, "RH");
  assert.equal(summary.batting.find((player) => player.name === "A")?.status, "Retired hurt");
});

test("deriveCricketInningsSummary aggregates batting and commentary", () => {
  const summary = __testing.deriveCricketInningsSummary(
    {
      battingSide: "HOME",
      bowlingSide: "AWAY",
      events: [
        {
          id: "1",
          type: "RUN",
          runs: 4,
          batRuns: 4,
          totalRuns: 4,
          legalBall: true,
          wicket: false,
          strikerName: "A",
          bowlerName: "C",
          commentary: "4 runs to A",
          overLabel: "0.1",
          createdAt: new Date("2026-07-18T08:00:00.000Z").toISOString(),
        },
      ],
      currentPlayers: {
        strikerName: "A",
        nonStrikerName: "B",
        bowlerName: "C",
      },
      completed: false,
    },
    20,
    11,
  );

  assert.equal(summary.runs, 4);
  assert.equal(summary.overs, "0.1");
  assert.equal(summary.batting[0].fours, 1);
  assert.equal(summary.commentary[0].over, "0.1");
});
