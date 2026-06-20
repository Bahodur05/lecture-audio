import { io } from 'socket.io-client';

// Set VITE_SERVER_URL at build time to point at your deployed Render/Fly.io
// server. Falls back to localhost for local dev against `npm run dev` on
// the server side.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return socket;
}

// Wraps a socket.emit(...) call with an ack callback into a Promise so the
// rest of the app can use async/await instead of nested callbacks.
export function emitAsync(event, payload = {}) {
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (response) => {
      if (response?.ok) resolve(response);
      else reject(new Error(response?.error || `${event} failed`));
    });
  });
}

export { SERVER_URL };
