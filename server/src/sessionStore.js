import { customAlphabet } from 'nanoid';
import { config } from './config.js';

const generateCode = customAlphabet(config.sessionCodeAlphabet, config.sessionCodeLength);

/**
 * In-memory session store. One process = one server instance, which is the
 * right scale for "a few lecture halls on a free-tier box." If this ever
 * needs to span multiple server instances, swap this for a Redis-backed
 * store and move mediasoup workers behind a proper SFU cluster — not needed
 * for the lecture-hall use case this was built for.
 */
class SessionStore {
  constructor() {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
  }

  createSession({ router, lecturerSocketId, label }) {
    let code = generateCode();
    // Practically never collides at this scale, but guard anyway.
    while (this.sessions.has(code)) code = generateCode();

    const session = {
      code,
      label: label || 'Lecture',
      router,
      lecturerSocketId,
      producerId: null, // set once the lecturer's audio track is published
      producerTransportId: null,
      listeners: new Map(), // socketId -> { transportId, consumerId }
      createdAt: Date.now(),
    };
    this.sessions.set(code, session);
    return session;
  }

  get(code) {
    return this.sessions.get(code?.toUpperCase());
  }

  remove(code) {
    this.sessions.delete(code);
  }

  removeStale() {
    const cutoff = Date.now() - config.sessionTtlMinutes * 60 * 1000;
    for (const [code, session] of this.sessions) {
      if (session.createdAt < cutoff && session.listeners.size === 0 && !session.producerId) {
        this.sessions.delete(code);
      }
    }
  }

  findByLecturerSocket(socketId) {
    for (const session of this.sessions.values()) {
      if (session.lecturerSocketId === socketId) return session;
    }
    return null;
  }

  findByListenerSocket(socketId) {
    for (const session of this.sessions.values()) {
      if (session.listeners.has(socketId)) return session;
    }
    return null;
  }
}

export const sessionStore = new SessionStore();

// Sweep stale sessions periodically so memory doesn't grow across a term.
setInterval(() => sessionStore.removeStale(), 10 * 60 * 1000);
