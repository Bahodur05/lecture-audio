import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from './config.js';
import { initWorkers } from './mediasoupManager.js';
import { registerSignaling } from './signaling.js';
import { sessionStore } from './sessionStore.js';

const app = express();
app.use(cors());
app.use(express.json());

// Simple health check — useful for Render/Fly.io health probes, and for
// confirming the box is up before a lecture without opening the full app.
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptimeSeconds: process.uptime() });
});

// Lightweight status for a given session code — lets the lecturer's page
// (or a TA) confirm a session is live without going through the socket flow.
app.get('/api/session/:code', (req, res) => {
  const session = sessionStore.get(req.params.code);
  if (!session) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({
    ok: true,
    code: session.code,
    label: session.label,
    live: Boolean(session.producerId),
    listenerCount: session.listeners.size,
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }, // tighten to your deployed client origin once that's fixed
  // Audio-relevant transport tuning: keep socket.io's own keepalive tight so
  // a dropped wifi connection is detected quickly rather than the listener
  // sitting on dead audio for a long timeout window.
  pingInterval: 10000,
  pingTimeout: 8000,
});

registerSignaling(io);

await initWorkers();

httpServer.listen(config.port, () => {
  console.log(`Lecture audio server listening on :${config.port}`);
});
