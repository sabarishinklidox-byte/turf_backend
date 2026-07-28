const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isLocalViteOrigin = (origin) => /^http:\/\/localhost:51\d{2}$/.test(origin ?? "");

export const isAllowedOrigin = (origin) => !origin || allowedOrigins.includes(origin) || isLocalViteOrigin(origin);

export const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

