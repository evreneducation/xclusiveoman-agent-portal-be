// cPanel / Phusion Passenger startup file. Passenger loads this with
// require(), so it must be plain CommonJS (see package.json — no
// "type": "module"). All actual startup logic (creates the Express app,
// attaches Socket.IO, starts the marketing scheduler cron job, and calls
// httpServer.listen()) lives in src/server.js exactly as it did before this
// file existed; this is just the fixed entry point Passenger expects.
require('./src/server.js');
