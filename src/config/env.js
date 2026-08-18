import 'dotenv/config';

const required = [
  "DATABASE_URL_PROD",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL_PROD,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  corsOrigins: (
    process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5174"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  agentPortalUrl: process.env.AGENT_PORTAL_URL || "http://localhost:5173/agent",
  // Task 11 (Marketing Center — Open & Click Tracking) — the backend's own
  // publicly-reachable base URL, needed to build absolute tracking-pixel/
  // click-redirect URLs embedded in an outbound email (unlike agentPortalUrl
  // above, which points at the *frontend*). Defaults to this same process's
  // own port for local dev, so tracking works out of the box without any
  // new required configuration.
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${Number(process.env.PORT || 4000)}`,
  // Signs/verifies marketing tracking-pixel and click-redirect tokens
  // (services/marketingTracking.service.js). Falls back to
  // JWT_REFRESH_SECRET (already a required startup env var above) so
  // tracking works in every existing deployment with zero new required
  // configuration — a dedicated MARKETING_TRACKING_SECRET is optional, for
  // stricter isolation between the two token purposes.
  marketingTrackingSecret: process.env.MARKETING_TRACKING_SECRET || process.env.JWT_REFRESH_SECRET,
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || "Xclusive Oman <no-reply@xclusiveoman.com>",
  },
  whatsappSalesNumber: process.env.WHATSAPP_SALES_NUMBER || "",
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  cashfree: {
    appId: process.env.CASHFREE_APP_ID,
    secretKey: process.env.CASHFREE_SECRET_KEY,
    webhookSecret: process.env.CASHFREE_WEBHOOK_SECRET,
    apiBaseUrl:
      process.env.CASHFREE_API_BASE_URL || "https://sandbox.cashfree.com/pg",
  },
};
