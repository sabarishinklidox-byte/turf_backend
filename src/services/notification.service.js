import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/app-error.js";
import { sendEmail } from "./email.service.js";
import { resolveCoordinatesFromAddress } from "./location.service.js";

const DEFAULT_NEARBY_RADIUS_KM = 25;
const appBaseUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173").trim();
const emailBatchLimit = () => Math.max(1, Math.min(Number(process.env.NOTIFICATION_EMAIL_LIMIT ?? 150), 500));

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const distanceKm = (from, to) => {
  const earthRadiusKm = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const latDistance = toRadians(to.latitude - from.latitude);
  const lonDistance = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(latDistance / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(lonDistance / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const hasCoordinates = (entity) =>
  Number.isFinite(entity?.latitude) && Number.isFinite(entity?.longitude);

const getTurfCoordinates = async (turf) => {
  if (hasCoordinates(turf)) {
    return { latitude: turf.latitude, longitude: turf.longitude, updated: false };
  }

  const resolved = await resolveCoordinatesFromAddress({
    address: turf.address,
    landmark: turf.landmark,
    city: turf.city,
    state: turf.state,
    postalCode: turf.postalCode,
  });

  if (!resolved) return null;

  try {
    await prisma.turf.update({
      where: { id: turf.id },
      data: {
        latitude: resolved.latitude,
        longitude: resolved.longitude,
      },
    });
  } catch {
    // If persistence fails, we can still use the resolved coordinates for this run.
  }

  return { ...resolved, updated: true };
};

const formatDateTime = (value) => {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
};

const getActiveUserRecipients = async ({ excludeUserIds = [], take = emailBatchLimit() } = {}) =>
  prisma.user.findMany({
    where: {
      isActive: true,
      id: { notIn: excludeUserIds },
      roles: { some: { role: { name: "USER" } } },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { createdAt: "desc" },
    take,
  });

const getNearbyUserRecipients = async ({ turf, excludeUserIds = [], radiusKm = DEFAULT_NEARBY_RADIUS_KM }) => {
  const turfPoint = await getTurfCoordinates(turf);
  if (!turfPoint) return null;

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { notIn: excludeUserIds },
      latitude: { not: null },
      longitude: { not: null },
      roles: { some: { role: { name: "USER" } } },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      latitude: true,
      longitude: true,
    },
    take: 500,
  });

  return users
    .map((user) => ({
      ...user,
      distance: distanceKm(turfPoint, { latitude: user.latitude, longitude: user.longitude }),
    }))
    .filter((user) => user.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, emailBatchLimit());
};

const serializeNotification = (notification) => ({
  id: notification.id,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  link: notification.link,
  readAt: notification.readAt,
  createdAt: notification.createdAt,
});

export const listNotifications = async (userId) => {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return notifications.map(serializeNotification);
};

export const markNotificationRead = async (userId, notificationId) => {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!notification) throw AppError.notFound("Notification");

  return serializeNotification(
    await prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: notification.readAt ?? new Date() },
    }),
  );
};

export const updateUserLocation = async (userId, { latitude, longitude }) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { latitude, longitude },
    select: { id: true, latitude: true, longitude: true },
  });

  return user;
};

export const notifyNearbyUsersForOpenMatch = async (matchId) => {
  const radiusKm = Number(process.env.NEARBY_MATCH_RADIUS_KM ?? DEFAULT_NEARBY_RADIUS_KM);
  const match = await prisma.openMatch.findUnique({
    where: { id: matchId },
    include: {
      host: true,
      turf: true,
      slot: true,
      participants: { select: { userId: true } },
    },
  });

  if (!match || match.status !== "OPEN") return { notified: 0, emailed: 0 };
  const turfPoint = await getTurfCoordinates(match.turf);
  if (!turfPoint) {
    logger.info({ matchId, turfId: match.turfId }, "Nearby match notification skipped because turf coordinates could not be resolved");
    return { notified: 0, emailed: 0 };
  }

  const excludedUserIds = new Set([match.hostUserId, ...match.participants.map((participant) => participant.userId)]);
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { notIn: [...excludedUserIds] },
      latitude: { not: null },
      longitude: { not: null },
      roles: { some: { role: { name: "USER" } } },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      latitude: true,
      longitude: true,
    },
    take: 500,
  });

  const nearbyUsers = users
    .map((user) => ({
      ...user,
      distance: distanceKm(turfPoint, { latitude: user.latitude, longitude: user.longitude }),
    }))
    .filter((user) => user.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 75);

  if (nearbyUsers.length === 0) {
    logger.info(
      {
        matchId,
        turfId: match.turfId,
        radiusKm,
        eligibleUsers: users.length,
      },
      "Nearby match notification found no users within radius",
    );
    return { notified: 0, emailed: 0 };
  }

  const startTime = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(match.sessionStartAt ?? match.slot.startAt);
  const title = `${match.sport} match near you`;
  const message = `A ${match.sport} match is open at ${match.turf.name} on ${startTime}.`;
  const link = `/user/turfs/${match.turfId}?matchId=${match.id}`;
  const websiteLink = `${appBaseUrl.replace(/\/$/, "")}${link}`;
  const venueAddress = [match.turf.address, match.turf.city, match.turf.state].filter(Boolean).join(", ");
  const callToAction = `Open the app to pay and join this match.`;
  const spotsLeft = Math.max(0, Number(match.maxPlayers ?? 0) - Number(match.spotsFilled ?? 0));
  const spotsFilled = Number(match.spotsFilled ?? 0);
  const matchTypeLabel =
    match.matchType === "PLAYER_JOIN"
      ? "Player join"
      : match.matchType === "TEAM_VS_TEAM"
        ? "Team vs team"
        : "Need opponent team";

  await prisma.notification.createMany({
    data: nearbyUsers.map((user) => ({
      userId: user.id,
      type: "OPEN_MATCH_NEARBY",
      title,
      message,
      link,
    })),
  });

  const emailResults = await Promise.allSettled(
    nearbyUsers.map((user) =>
      sendEmail({
        to: user.email,
        subject: `PlayArena alert: ${title}`,
        text: `${message}\nVenue: ${venueAddress || match.turf.name}\n\n${callToAction}\n${websiteLink}`,
        html: `
          <div style="margin:0;padding:0;background:#f4f7fc;">
            <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:Arial,sans-serif;color:#10245e;">
              <div style="border-radius:22px;overflow:hidden;background:linear-gradient(135deg,#0b1b38 0%,#1646d8 55%,#1f3fb7 100%);box-shadow:0 18px 40px rgba(22,70,216,0.18);">
                <div style="padding:22px 22px 18px;border-bottom:1px solid rgba(255,255,255,0.14);">
                  <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.7);font-weight:700;">PlayArena match alert</div>
                  <div style="margin-top:10px;font-size:26px;line-height:1.15;font-weight:800;color:#ffffff;">${escapeHtml(title)}</div>
                  <div style="margin-top:8px;font-size:15px;line-height:1.5;color:rgba(255,255,255,0.88);">${escapeHtml(message)}</div>
                </div>
                <div style="padding:18px 22px 22px;background:#ffffff;">
                  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
                    <span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#eaf0ff;color:#1646d8;font-size:12px;font-weight:700;">${escapeHtml(matchTypeLabel)}</span>
                    <span style="display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:#ecfdf3;color:#0f8a3d;font-size:12px;font-weight:700;">
                      <span style="width:8px;height:8px;border-radius:999px;background:#14b86a;display:inline-block;"></span>
                      Open now
                    </span>
                  </div>

                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:18px;">
                    <div style="padding:14px;border-radius:16px;background:#f7f9ff;border:1px solid #dbe5ff;">
                      <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6f7fa4;font-weight:700;">Spots left</div>
                      <div style="margin-top:6px;font-size:28px;line-height:1;color:#1646d8;font-weight:800;">${spotsLeft}</div>
                    </div>
                    <div style="padding:14px;border-radius:16px;background:#f7f9ff;border:1px solid #dbe5ff;">
                      <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6f7fa4;font-weight:700;">Joined</div>
                      <div style="margin-top:6px;font-size:28px;line-height:1;color:#10245e;font-weight:800;">${spotsFilled}</div>
                    </div>
                  </div>

                  <div style="padding:14px 16px;border-radius:16px;background:#f8fbff;border:1px solid #dbe5ff;margin-bottom:14px;">
                    <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6f7fa4;font-weight:700;">Venue</div>
                    <div style="margin-top:5px;font-size:14px;line-height:1.5;color:#10245e;font-weight:700;">${escapeHtml(venueAddress || match.turf.name)}</div>
                  </div>

                  <div style="padding:14px 16px;border-radius:16px;background:#f8fbff;border:1px solid #dbe5ff;margin-bottom:18px;">
                    <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6f7fa4;font-weight:700;">When</div>
                    <div style="margin-top:5px;font-size:14px;line-height:1.5;color:#10245e;font-weight:700;">${escapeHtml(startTime)}</div>
                  </div>

                  <div style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#10245e;">${escapeHtml(callToAction)}</div>

                  <div style="margin-bottom:12px;">
                    <a href="${websiteLink}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;box-shadow:0 12px 24px rgba(22,70,216,0.22);">
                      Open PlayArena
                    </a>
                  </div>

                  <div style="font-size:12px;line-height:1.5;color:#6f7fa4;">
                    If the button does not open, use this link: <a href="${websiteLink}" style="color:#1646d8;word-break:break-all;">${websiteLink}</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `,
      }),
    ),
  );

  return {
    notified: nearbyUsers.length,
    emailed: emailResults.filter((result) => result.status === "fulfilled" && !result.value?.skipped).length,
  };
};

export const notifyUsersForTournament = async (tournamentId) => {
  const radiusKm = Number(process.env.NEARBY_TOURNAMENT_RADIUS_KM ?? process.env.NEARBY_MATCH_RADIUS_KM ?? DEFAULT_NEARBY_RADIUS_KM);
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      host: true,
      turf: true,
      teams: { select: { id: true } },
    },
  });

  if (!tournament || !["OPEN", "ACTIVE"].includes(tournament.status)) return { notified: 0, emailed: 0 };

  const excludeUserIds = [tournament.hostUserId].filter(Boolean);
  const nearbyUsers = tournament.turf
    ? await getNearbyUserRecipients({ turf: tournament.turf, excludeUserIds, radiusKm })
    : null;
  const recipients = nearbyUsers?.length
    ? nearbyUsers
    : await getActiveUserRecipients({ excludeUserIds });

  if (recipients.length === 0) {
    logger.info({ tournamentId, radiusKm }, "Tournament notification found no eligible users");
    return { notified: 0, emailed: 0 };
  }

  const link = `/user/tournaments/${tournament.id}`;
  const websiteLink = `${appBaseUrl.replace(/\/$/, "")}${link}`;
  const venueName = tournament.turf?.name ?? tournament.turf?.turfName ?? "PlayArena";
  const venueAddress = tournament.turf
    ? [tournament.turf.address, tournament.turf.city, tournament.turf.state].filter(Boolean).join(", ")
    : "Online tournament listing";
  const startTime = formatDateTime(tournament.startDate);
  const endTime = formatDateTime(tournament.endDate);
  const dateText = startTime && endTime ? `${startTime} - ${endTime}` : startTime ?? "Date will be announced";
  const entryFee = Number(tournament.entryFeePerTeam ?? 0);
  const joinedTeams = tournament.teams.length;
  const availableTeams = Math.max(0, Number(tournament.maxTeams ?? 0) - joinedTeams);
  const title = `${tournament.sport} tournament is open`;
  const message = `${tournament.title} is open for team registration${tournament.turf ? ` at ${venueName}` : ""}.`;

  await prisma.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      type: "SYSTEM",
      title,
      message,
      link,
    })),
  });

  const emailResults = await Promise.allSettled(
    recipients.map((user) =>
      sendEmail({
        to: user.email,
        subject: `PlayArena tournament: ${tournament.title}`,
        text: `${message}\nSport: ${tournament.sport}\nVenue: ${venueAddress}\nDate: ${dateText}\nEntry fee: Rs. ${entryFee}\nSlots left: ${availableTeams}\n\nOpen tournament:\n${websiteLink}`,
        html: `
          <div style="margin:0;padding:0;background:#f4f7fc;">
            <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:Arial,sans-serif;color:#10245e;">
              <div style="border-radius:22px;overflow:hidden;background:#ffffff;box-shadow:0 18px 40px rgba(22,70,216,0.14);border:1px solid #dbe5ff;">
                <div style="padding:24px;background:linear-gradient(135deg,#071a44 0%,#1646d8 60%,#0f766e 100%);">
                  <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.74);font-weight:700;">PlayArena tournament alert</div>
                  <div style="margin-top:10px;font-size:28px;line-height:1.12;font-weight:900;color:#ffffff;">${escapeHtml(tournament.title)}</div>
                  <div style="margin-top:8px;font-size:15px;line-height:1.5;color:rgba(255,255,255,0.88);">${escapeHtml(message)}</div>
                </div>
                <div style="padding:20px 22px 24px;">
                  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
                    <span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#eaf0ff;color:#1646d8;font-size:12px;font-weight:800;">${escapeHtml(tournament.sport)}</span>
                    <span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#ecfdf3;color:#0f8a3d;font-size:12px;font-weight:800;">Registration open</span>
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:16px;">
                    <div style="padding:14px;border-radius:16px;background:#f8fbff;border:1px solid #dbe5ff;">
                      <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6f7fa4;font-weight:800;">Entry fee</div>
                      <div style="margin-top:6px;font-size:22px;line-height:1;color:#1646d8;font-weight:900;">Rs. ${entryFee}</div>
                    </div>
                    <div style="padding:14px;border-radius:16px;background:#f8fbff;border:1px solid #dbe5ff;">
                      <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6f7fa4;font-weight:800;">Team slots left</div>
                      <div style="margin-top:6px;font-size:22px;line-height:1;color:#10245e;font-weight:900;">${availableTeams}</div>
                    </div>
                  </div>
                  <div style="padding:14px 16px;border-radius:16px;background:#f8fbff;border:1px solid #dbe5ff;margin-bottom:12px;">
                    <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6f7fa4;font-weight:800;">Venue</div>
                    <div style="margin-top:5px;font-size:14px;line-height:1.5;color:#10245e;font-weight:800;">${escapeHtml(venueAddress || venueName)}</div>
                  </div>
                  <div style="padding:14px 16px;border-radius:16px;background:#f8fbff;border:1px solid #dbe5ff;margin-bottom:18px;">
                    <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6f7fa4;font-weight:800;">Schedule</div>
                    <div style="margin-top:5px;font-size:14px;line-height:1.5;color:#10245e;font-weight:800;">${escapeHtml(dateText)}</div>
                  </div>
                  <a href="${websiteLink}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:900;font-size:14px;box-shadow:0 12px 24px rgba(22,70,216,0.22);">Open tournament</a>
                  <div style="margin-top:14px;font-size:12px;line-height:1.5;color:#6f7fa4;">If the button does not open, use this link: <a href="${websiteLink}" style="color:#1646d8;word-break:break-all;">${websiteLink}</a></div>
                </div>
              </div>
            </div>
          </div>
        `,
      }),
    ),
  );

  return {
    notified: recipients.length,
    emailed: emailResults.filter((result) => result.status === "fulfilled" && !result.value?.skipped).length,
  };
};
