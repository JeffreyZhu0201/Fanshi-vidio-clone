import { WebSocket, WebSocketServer } from 'ws';

import logger from '../utils/logger.js';

const websocketServers = new Set();

const serializeEvent = (type, payload) =>
  JSON.stringify({
    type,
    payload,
    timestamp: new Date().toISOString()
  });

const attachRealtimeServer = (server, { path = '/ws' } = {}) => {
  const websocketServer = new WebSocketServer({
    server,
    path
  });

  websocketServer.on('connection', (socket, request) => {
    logger.info('Realtime client connected', {
      path: request.url,
      clients: websocketServer.clients.size
    });

    socket.send(
      serializeEvent('ws:connected', {
        path
      })
    );

    socket.on('close', () => {
      logger.info('Realtime client disconnected', {
        clients: websocketServer.clients.size
      });
    });

    socket.on('error', (error) => {
      logger.warn('Realtime socket error', {
        message: error.message
      });
    });
  });

  websocketServers.add(websocketServer);
  return websocketServer;
};

const broadcastRealtimeEvent = (type, payload) => {
  const message = serializeEvent(type, payload);

  websocketServers.forEach((websocketServer) => {
    websocketServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
};

const closeRealtimeServers = async () => {
  await Promise.all(
    [...websocketServers].map(
      (websocketServer) =>
        new Promise((resolve) => {
          websocketServer.clients.forEach((client) => {
            client.close();
          });

          websocketServer.close(() => {
            resolve();
          });
        })
    )
  );

  websocketServers.clear();
};

export { attachRealtimeServer, broadcastRealtimeEvent, closeRealtimeServers };
