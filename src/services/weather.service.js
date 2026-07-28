import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";
import { resolveCoordinatesFromAddress } from "./location.service.js";

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const weatherCache = new Map();

const getLocationLabel = (turf) =>
  [turf?.city, turf?.state].filter(Boolean).join(", ") ||
  [turf?.address, turf?.city, turf?.state].filter(Boolean).join(", ") ||
  "Venue location";

const describeWeatherCode = (code) => {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Partly cloudy";
  if ([45, 48].includes(code)) return "Mist";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Live weather";
};

const getWeatherCacheKey = (turf, latitude, longitude) =>
  `${turf.id}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;

const getTurfWithWeather = async (turfId) => {
  const turf = await prisma.turf.findFirst({
    where: { id: turfId, status: "APPROVED", isActive: true },
  });

  if (!turf) throw AppError.notFound("Turf");
  return turf;
};

const resolveTurfCoordinates = async (turf) => {
  if (Number.isFinite(turf.latitude) && Number.isFinite(turf.longitude)) {
    return { latitude: turf.latitude, longitude: turf.longitude, updated: false };
  }

  const coordinates = await resolveCoordinatesFromAddress({
    address: turf.address,
    landmark: turf.landmark,
    city: turf.city,
    state: turf.state,
    postalCode: turf.postalCode,
  });

  if (!coordinates) return null;

  try {
    await prisma.turf.update({
      where: { id: turf.id },
      data: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      },
    });
  } catch {
    // If persistence fails, we can still serve the live weather result.
  }

  return { ...coordinates, updated: true };
};

const fetchWeather = async (latitude, longitude) => {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("hourly", "relativehumidity_2m");
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Weather lookup failed");
  }

  const data = await response.json();
  const current = data?.current_weather;
  const humidityIndex = Array.isArray(data?.hourly?.time) ? data.hourly.time.indexOf(current?.time) : -1;
  const humidity = humidityIndex >= 0 ? data?.hourly?.relativehumidity_2m?.[humidityIndex] : null;
  const weatherCode = Number(current?.weathercode);

  return {
    temperature: Number.isFinite(Number(current?.temperature)) ? Number(current.temperature) : null,
    humidity: Number.isFinite(Number(humidity)) ? Number(humidity) : null,
    windSpeed: Number.isFinite(Number(current?.windspeed)) ? Number(current.windspeed) : null,
    weatherCode: Number.isFinite(weatherCode) ? weatherCode : null,
    weatherLabel: Number.isFinite(weatherCode) ? describeWeatherCode(weatherCode) : "Live weather",
    fetchedAt: new Date().toISOString(),
  };
};

export const getVenueWeather = async (turfId) => {
  const turf = await getTurfWithWeather(turfId);
  const coordinates = await resolveTurfCoordinates(turf);

  const locationLabel = getLocationLabel(turf);
  if (!coordinates) {
    return {
      locationLabel,
      temperature: null,
      humidity: null,
      windSpeed: null,
      weatherCode: null,
      weatherLabel: "Live weather unavailable",
      fetchedAt: null,
      source: "unavailable",
    };
  }

  const cacheKey = getWeatherCacheKey(turf, coordinates.latitude, coordinates.longitude);
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const payload = await fetchWeather(coordinates.latitude, coordinates.longitude);
    const data = {
      locationLabel,
      ...payload,
      source: coordinates.updated ? "geocoded" : "coordinates",
      stale: false,
    };
    weatherCache.set(cacheKey, { data, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
    return data;
  } catch {
    if (cached?.data) {
      return {
        ...cached.data,
        source: `${cached.data.source ?? "coordinates"}-cached`,
        stale: true,
      };
    }

    return {
      locationLabel,
      temperature: null,
      humidity: null,
      windSpeed: null,
      weatherCode: null,
      weatherLabel: "Live weather unavailable",
      fetchedAt: null,
      source: "unavailable",
      stale: true,
    };
  }
};
