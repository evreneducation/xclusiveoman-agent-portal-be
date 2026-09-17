const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');

const {
  env
} = require('./config/env.js');

const routes = require('./routes/index.js');
const webhooksRoutes = require('./routes/webhooks.routes.js');

const {
  notFoundHandler,
  errorHandler
} = require('./middleware/errorHandler.js');

function createApp() {
  const app = express();

  // Needed for express-rate-limit (middleware/rateLimiter.js) to key off the
  // real client IP rather than the reverse proxy's — the deployed backend
  // sits behind one (see refreshCookieOptions' own sameSite/secure split in
  // auth.controller.js for another spot that already assumes a prod proxy).
  // '1' trusts exactly one hop, matching a single load balancer/PaaS proxy.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    })
  );
  app.use(cookieParser());

  // Mounted before express.json() so the Cashfree webhook gets the exact raw
  // body bytes it needs to verify the signature (doc §14.1/§16).
  app.use('/api/webhooks', webhooksRoutes);

  app.use(express.json());
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports.createApp = createApp;
