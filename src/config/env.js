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
