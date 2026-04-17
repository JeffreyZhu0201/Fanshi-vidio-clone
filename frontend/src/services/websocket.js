import { getEnv } from '../utils/env.js';
import { API_ORIGIN } from './api.js';

const realtimeMode = getEnv('VITE_REALTIME_MODE', 'auto');

const resolveWebSocketUrl = () => {
  if (realtimeMode === 'off') {
    return '';
  }

  const configuredUrl = getEnv('VITE_WS_URL', '').trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  try {
    const websocketUrl = new URL('/ws', API_ORIGIN);
    websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return websocketUrl.toString();
  } catch {
    return '';
  }
};

const WS_URL = resolveWebSocketUrl();

class RealtimeEventService {
  constructor() {
    this.eventTarget = new EventTarget();
    this.socket = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.manuallyClosed = false;
  }

  connect() {
    if (!WS_URL || typeof window === 'undefined' || this.socket) {
      if (!WS_URL) {
        this.emitLocal('ws:status', {
          status: 'polling'
        });
      }

      return;
    }

    this.manuallyClosed = false;
    this.socket = new WebSocket(WS_URL);

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.emitLocal('ws:status', {
        status: 'realtime',
        url: WS_URL
      });
    });

    this.socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload?.type) {
          this.emitLocal(payload.type, payload.payload ?? payload);
        }
      } catch (error) {
        this.emitLocal('ws:error', {
          message: '实时消息解析失败。',
          details: error.message
        });
      }
    });

    this.socket.addEventListener('close', () => {
      this.socket = null;
      this.emitLocal('ws:status', {
        status: this.manuallyClosed ? 'idle' : 'polling'
      });

      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener('error', () => {
      this.emitLocal('ws:status', {
        status: 'fallback'
      });
      this.emitLocal('ws:error', {
        message: '实时连接暂时不可用，已自动切换为轮询更新。'
      });
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    const reconnectDelay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, reconnectDelay);
  }

  subscribe(eventType, listener) {
    this.connect();

    const wrappedListener = (event) => {
      listener(event.detail);
    };

    this.eventTarget.addEventListener(eventType, wrappedListener);

    return () => {
      this.eventTarget.removeEventListener(eventType, wrappedListener);
    };
  }

  emitLocal(eventType, payload) {
    this.eventTarget.dispatchEvent(
      new CustomEvent(eventType, {
        detail: payload
      })
    );
  }

  disconnect() {
    this.manuallyClosed = true;

    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

const websocketService = new RealtimeEventService();

export { websocketService };
