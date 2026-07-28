  import { prisma } from "../config/prisma.js";

const TOURNAMENT_REGISTRATION_OFFER_ID = "tournament-registration-offer";

const serializeTournamentRegistrationOffer = (setting) => ({
  isEnabled: setting.isEnabled,
  discountPercent: setting.discountPercent,
});

export const getTournamentRegistrationOfferRecord = async () =>
  prisma.tournamentRegistrationOfferSetting.upsert({
    where: { id: TOURNAMENT_REGISTRATION_OFFER_ID },
    update: {},
    create: {
      id: TOURNAMENT_REGISTRATION_OFFER_ID,
      isEnabled: false,
      discountPercent: 10,
    },
  });

export const getTournamentRegistrationOffer = async () =>
  serializeTournamentRegistrationOffer(await getTournamentRegistrationOfferRecord());

export const updateTournamentRegistrationOffer = async (input) =>
  serializeTournamentRegistrationOffer(
    await prisma.tournamentRegistrationOfferSetting.upsert({
      where: { id: TOURNAMENT_REGISTRATION_OFFER_ID },
      update: {
        isEnabled: input.isEnabled,
        discountPercent: input.discountPercent,
      },
      create: {
        id: TOURNAMENT_REGISTRATION_OFFER_ID,
        isEnabled: input.isEnabled,
        discountPercent: input.discountPercent,
      },
    }),
  );

