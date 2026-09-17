const {
  Server
} = require('socket.io');

const {
  verifyAccessToken
} = require('../services/auth.service.js');

const {
  env
} = require('../config/env.js');

let ioInstance = null;

function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('unauthorized'));
    }
    try {
      const claims = verifyAccessToken(token);
      socket.data.userId = claims.sub;
      socket.data.role = claims.role;
      socket.data.agencyId = claims.agencyId;
      next();
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);

    if (socket.data.agencyId) {
      socket.join(`agency:${socket.data.agencyId}`);
    } else if (socket.data.role) {
      socket.join('staff');
      socket.join(`role:${socket.data.role}`);
    }

    socket.emit('connected', { userId: socket.data.userId });
  });

  ioInstance = io;
  return io;
}

module.exports.initSockets = initSockets;

function getIo() {
  return ioInstance;
}

module.exports.getIo = getIo;
