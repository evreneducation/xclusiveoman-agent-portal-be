import { Server } from 'socket.io';
import { verifyAccessToken } from '../services/auth.service.js';
import { env } from '../config/env.js';

let ioInstance = null;

/**
 * Sprint 1 scope: wiring only. Handshake authenticates the socket and joins
 * the doc's §13 room convention (user:<id>, agency:<id>, staff role rooms) so
 * later sprints can `io.to('agency:<id>').emit(...)` without any rework here.
 */
export function initSockets(httpServer) {
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

export function getIo() {
  return ioInstance;
}
