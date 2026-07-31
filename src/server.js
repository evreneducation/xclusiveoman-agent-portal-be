import http from 'node:http';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { env } from './config/env.js';

const app = createApp();
const httpServer = http.createServer(app);

initSockets(httpServer);

httpServer.listen(env.port, () => {
  console.log(`Xclusive Oman API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
