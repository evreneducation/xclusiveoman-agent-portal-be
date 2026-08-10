import http from 'node:http';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { startMarketingScheduler } from './jobs/marketingScheduler.job.js';
import { env } from './config/env.js';

const app = createApp();
const httpServer = http.createServer(app);

initSockets(httpServer);
// Marketing Center Task 6 — polls for due scheduled campaigns once a
// minute (jobs/marketingScheduler.job.js); safe to start unconditionally,
// it's a no-op tick when nothing is due.
startMarketingScheduler();

httpServer.listen(env.port, () => {
  console.log(`Xclusive Oman API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
