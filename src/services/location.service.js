const DEFAULT_USER_AGENT = "TurfArena/1.0 (address-geocoder)";
const GEONAMES_BASE_URL = "https://secure.geonames.org";
const INDIA_GEONAME_ID = "1269750";
const geonamesUsername = () =>
  process.env.GEONAMES_USERNAME?.trim() ||
  process.env.GEONAMES_USER?.trim() ||
  (process.env.NODE_ENV === "production" ? "" : "demo");

const compactParts = (parts = []) =>
  parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);

export const buildAddressQuery = (input = {}) => {
  const parts = compactParts([
    input.address,
    input.landmark,
    input.city,
    input.state,
    input.postalCode,
    "India",
  ]);

  return parts.join(", ");
};

export const resolveCoordinatesFromAddress = async (input = {}) => {
  const query = buildAddressQuery(input);
  if (!query) return null;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "in");
    url.searchParams.set("q", query);

    const response = await fetch(url, {
      headers: {
        "User-Agent": process.env.GEOCODER_USER_AGENT ?? DEFAULT_USER_AGENT,
        "Accept-Language": "en",
      },
    });

    if (!response.ok) return null;

    const results = await response.json();
    const firstResult = Array.isArray(results) ? results[0] : null;
    const latitude = Number(firstResult?.lat);
    const longitude = Number(firstResult?.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return { latitude, longitude };
  } catch {
    return null;
  }
};

const normalizeLocationText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const compactAddressLine = (parts = []) =>
  parts
    .map(normalizeLocationText)
    .filter(Boolean)
    .join(", ");

const geonamesRequest = async (path, params = {}) => {
  const username = geonamesUsername();
  if (!username) return null;

  const url = new URL(`${GEONAMES_BASE_URL}/${path}`);
  Object.entries({ ...params, username }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": process.env.GEOCODER_USER_AGENT ?? DEFAULT_USER_AGENT,
        "Accept-Language": "en",
      },
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
};

const geonamesArray = (payload) => (Array.isArray(payload?.geonames) ? payload.geonames : []);
const geonamesStatusMessage = (payload) => normalizeLocationText(payload?.status?.message);
const geonamesHasError = (payload) => Boolean(payload?.status?.value);

const buildGeoNamesAddressFromCoordinates = async ({ latitude, longitude }) => {
  const [placePayload, subdivisionPayload, postalPayload] = await Promise.all([
    geonamesRequest("findNearbyPlaceNameJSON", {
      lat: latitude,
      lng: longitude,
      localCountry: true,
      cities: "cities1000",
      maxRows: 1,
      lang: "en",
    }),
    geonamesRequest("countrySubdivisionJSON", {
      lat: latitude,
      lng: longitude,
      localCountry: true,
      lang: "en",
    }),
    geonamesRequest("findNearbyPostalCodesJSON", {
      lat: latitude,
      lng: longitude,
      localCountry: true,
      country: "IN",
      radius: 10,
      maxRows: 1,
    }),
  ]);

  const place = geonamesArray(placePayload)[0] ?? null;
  const subdivision = subdivisionPayload ?? {};
  const postal = geonamesArray(postalPayload)[0] ?? null;

  const city =
    normalizeLocationText(postal?.placeName) ??
    normalizeLocationText(place?.name) ??
    normalizeLocationText(subdivision?.placeName);
  const state =
    normalizeLocationText(subdivision?.adminName1) ??
    normalizeLocationText(postal?.adminName1) ??
    normalizeLocationText(place?.adminName1);
  const postalCode = normalizeLocationText(postal?.postalCode);
  const countryName = normalizeLocationText(subdivision?.countryName) ?? "India";

  if (!city && !state && !postalCode) return null;

  return {
    latitude,
    longitude,
    address: null,
    city,
    state,
    postalCode,
    landmark: null,
    displayName: compactAddressLine([city, state, countryName]),
  };
};

export const resolveAddressFromCoordinates = async ({ latitude, longitude } = {}) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const geonamesResolved = await buildGeoNamesAddressFromCoordinates({ latitude, longitude });
  if (geonamesResolved) return geonamesResolved;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url, {
      headers: {
        "User-Agent": process.env.GEOCODER_USER_AGENT ?? DEFAULT_USER_AGENT,
        "Accept-Language": "en",
      },
    });

    if (!response.ok) return null;

    const result = await response.json();
    const address = result?.address ?? {};
    const city =
      normalizeLocationText(address.city) ??
      normalizeLocationText(address.town) ??
      normalizeLocationText(address.village) ??
      normalizeLocationText(address.municipality) ??
      normalizeLocationText(address.county);
    const state = normalizeLocationText(address.state) ?? normalizeLocationText(address.state_district);
    const postalCode = normalizeLocationText(address.postcode);
    const landmark =
      normalizeLocationText(address.suburb) ??
      normalizeLocationText(address.neighbourhood) ??
      normalizeLocationText(address.quarter) ??
      normalizeLocationText(address.hamlet);
    const addressLine = compactAddressLine([
      address.house_number,
      address.building,
      address.road,
      address.residential,
      address.suburb,
    ]);

    return {
      latitude,
      longitude,
      address: addressLine,
      city,
      state,
      postalCode,
      landmark,
      displayName: normalizeLocationText(result?.display_name),
    };
  } catch {
    return null;
  }
};

const buildGeoNamesSuggestion = (item) => {
  const city = normalizeLocationText(item?.name);
  const state = normalizeLocationText(item?.adminName1);
  const postalCode = normalizeLocationText(item?.postalcode);
  const latitude = Number(item?.lat);
  const longitude = Number(item?.lng);

  if (!city && !state) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    label: compactAddressLine([city, state]) || city || state,
    address: null,
    city,
    state,
    postalCode,
    landmark: null,
    latitude,
    longitude,
    displayName: compactAddressLine([city, state, "India"]),
  };
};

const buildSuggestionFromResult = (result) => {
  const address = result?.address ?? {};
  const city =
    normalizeLocationText(address.city) ??
    normalizeLocationText(address.town) ??
    normalizeLocationText(address.village) ??
    normalizeLocationText(address.municipality) ??
    normalizeLocationText(address.county);
  const state = normalizeLocationText(address.state) ?? normalizeLocationText(address.state_district);
  const postalCode = normalizeLocationText(address.postcode);
  const landmark =
    normalizeLocationText(address.suburb) ??
    normalizeLocationText(address.neighbourhood) ??
    normalizeLocationText(address.quarter) ??
    normalizeLocationText(address.hamlet);
  const addressLine = compactAddressLine([
    address.house_number,
    address.building,
    address.road,
    address.residential,
    address.suburb,
  ]);
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);

  if (!city && !state && !addressLine) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    label: compactAddressLine([city, state]) || normalizeLocationText(result?.display_name) || addressLine,
    address: addressLine,
    city,
    state,
    postalCode,
    landmark,
    latitude,
    longitude,
    displayName: normalizeLocationText(result?.display_name),
  };
};

export const searchAddressSuggestions = async ({ query } = {}) => {
  const normalizedQuery = normalizeLocationText(query);
  if (!normalizedQuery || normalizedQuery.length < 2) return [];

  const geonamesResults = await geonamesRequest("searchJSON", {
    q: normalizedQuery,
    country: "IN",
    featureClass: "P",
    maxRows: 6,
    lang: "en",
  });

  const geonamesSuggestions = geonamesArray(geonamesResults)
    .map(buildGeoNamesSuggestion)
    .filter(Boolean);

  if (geonamesSuggestions.length > 0) {
    const seen = new Set();
    return geonamesSuggestions.filter((item) => {
      const key = `${item.city}:${item.state}:${item.postalCode}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("countrycodes", "in");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("q", `${normalizedQuery}, India`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": process.env.GEOCODER_USER_AGENT ?? DEFAULT_USER_AGENT,
        "Accept-Language": "en",
      },
    });

    if (!response.ok) return [];

    const results = await response.json();
    const seen = new Set();

    return (Array.isArray(results) ? results : [])
      .map(buildSuggestionFromResult)
      .filter(Boolean)
      .filter((item) => {
        const key = `${item.city}:${item.state}:${item.address}:${item.postalCode}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch {
    return [];
  }
};

export const listGeoNamesStates = async () => {
  const payload = await geonamesRequest("childrenJSON", {
    geonameId: INDIA_GEONAME_ID,
    lang: "en",
  });

  if (!payload) return [];
  if (geonamesHasError(payload)) return [];

  return geonamesArray(payload)
    .filter((item) => item?.fcode === "ADM1" || item?.fclName === "country, state, region,...")
    .map((item) => ({
      geonameId: String(item.geonameId),
      stateCode: normalizeLocationText(item.adminCode1) ?? String(item.geonameId),
      name: normalizeLocationText(item.name),
    }))
    .filter((item) => item.name && item.stateCode)
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
};

export const listGeoNamesCitiesByState = async ({ stateCode } = {}) => {
  const normalizedStateCode = normalizeLocationText(stateCode);
  if (!normalizedStateCode) return [];

  const payload = await geonamesRequest("searchJSON", {
    country: "IN",
    adminCode1: normalizedStateCode,
    featureClass: "P",
    maxRows: 200,
    orderby: "population",
    lang: "en",
  });

  if (!payload) return [];
  if (geonamesHasError(payload)) return [];

  const seen = new Set();
  return geonamesArray(payload)
    .map((item) => ({
      geonameId: String(item.geonameId),
      city: normalizeLocationText(item.name),
      state: normalizeLocationText(item.adminName1),
      latitude: Number(item.lat),
      longitude: Number(item.lng),
    }))
    .filter((item) => item.city && item.state && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .filter((item) => {
      const key = `${item.city}:${item.state}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.city.localeCompare(right.city, "en"));
};

export const getGeoNamesStatus = async () => {
  const username = geonamesUsername();
  if (!username) {
    return { ok: false, message: "GEONAMES_USERNAME is not configured" };
  }

  const payload = await geonamesRequest("searchJSON", {
    q: "coimbatore",
    country: "IN",
    featureClass: "P",
    maxRows: 1,
  });

  if (!payload) {
    return { ok: false, message: "Unable to reach GeoNames" };
  }

  if (geonamesHasError(payload)) {
    return { ok: false, message: geonamesStatusMessage(payload) ?? "GeoNames returned an error" };
  }

  return { ok: true, message: null };
};
