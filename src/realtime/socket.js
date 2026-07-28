import { Server } from "socket.io";
import { corsOptions } from "../config/cors.js";

let io;

const tournamentRoom = (tournamentId) => `tournament:${tournamentId}`;
const turfRoom = (turfId) => `turf:${turfId}`;

export const attachSocketServer = (server) => {
  io = new Server(server, {
    cors: corsOptions,
  });

  io.on("connection", (socket) => {
    socket.on("tournament:join", ({ tournamentId } = {}) => {
      if (!tournamentId) return;
      socket.join(tournamentRoom(tournamentId));
    });

    socket.on("tournament:leave", ({ tournamentId } = {}) => {
      if (!tournamentId) return;
      socket.leave(tournamentRoom(tournamentId));
    });

    socket.on("turf:join", ({ turfId } = {}) => {
      if (!turfId) return;
      socket.join(turfRoom(turfId));
    });

    socket.on("turf:leave", ({ turfId } = {}) => {
      if (!turfId) return;
      socket.leave(turfRoom(turfId));
    });
  });

  return io;
};

export const emitTournamentUpdated = (tournamentId, reason = "updated") => {
  if (!io || !tournamentId) return;
  io.to(tournamentRoom(tournamentId)).emit("tournament:updated", {
    tournamentId,
    reason,
    emittedAt: new Date().toISOString(),
  });
};

export const emitTurfSlotsUpdated = (turfId, reason = "updated") => {
  if (!io || !turfId) return;
  io.to(turfRoom(turfId)).emit("turf:slots_updated", {
    turfId,
    reason,
    emittedAt: new Date().toISOString(),
  });
};

export const closeSocketServer = async () => {
  if (!io) return;
  await io.close();
  io = undefined;
};
