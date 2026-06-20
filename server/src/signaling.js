import { createRouter, createWebRtcTransport } from './mediasoupManager.js';
import { sessionStore } from './sessionStore.js';

/**
 * All the WebRTC signaling for both roles (lecturer = broadcaster,
 * student = listener) lives here. The pattern throughout:
 *   client emits an event with a callback -> server does mediasoup work ->
 *   server replies via the callback. Socket.io's ack callbacks keep this
 *   readable instead of juggling a separate event per response.
 */
export function registerSignaling(io) {
  io.on('connection', (socket) => {
    // ---- LECTURER: start a new session -------------------------------
    socket.on('lecturer:createSession', async ({ label }, callback) => {
      try {
        const router = await createRouter();
        const session = sessionStore.createSession({
          router,
          lecturerSocketId: socket.id,
          label,
        });
        socket.join(`session:${session.code}`);
        socket.data.role = 'lecturer';
        socket.data.sessionCode = session.code;
        callback({ ok: true, code: session.code });
      } catch (err) {
        console.error('createSession failed', err);
        callback({ ok: false, error: 'Could not start session.' });
      }
    });

    // ---- LECTURER: fetch the router's RTP capabilities -----------------
    // The mediasoup-client Device needs these to know which codecs/formats
    // it's allowed to negotiate before it can create a send transport.
    socket.on('lecturer:getRouterCapabilities', (_, callback) => {
      const session = sessionStore.findByLecturerSocket(socket.id);
      if (!session) return callback({ ok: false, error: 'No active session.' });
      callback({ ok: true, rtpCapabilities: session.router.rtpCapabilities });
    });

    // ---- LECTURER: create the transport that will carry the mic audio -
    socket.on('lecturer:createProducerTransport', async (_, callback) => {
      try {
        const session = sessionStore.findByLecturerSocket(socket.id);
        if (!session) return callback({ ok: false, error: 'No active session.' });

        const { transport, params } = await createWebRtcTransport(session.router);
        socket.data.producerTransport = transport;
        session.producerTransportId = transport.id;
        callback({ ok: true, params });
      } catch (err) {
        console.error('createProducerTransport failed', err);
        callback({ ok: false, error: 'Could not set up audio transport.' });
      }
    });

    socket.on('lecturer:connectProducerTransport', async ({ dtlsParameters }, callback) => {
      try {
        await socket.data.producerTransport.connect({ dtlsParameters });
        callback({ ok: true });
      } catch (err) {
        console.error('connectProducerTransport failed', err);
        callback({ ok: false, error: 'Could not connect audio transport.' });
      }
    });

    // ---- LECTURER: publish the actual audio track ---------------------
    socket.on('lecturer:produce', async ({ kind, rtpParameters }, callback) => {
      try {
        const session = sessionStore.findByLecturerSocket(socket.id);
        if (!session) return callback({ ok: false, error: 'No active session.' });

        const producer = await socket.data.producerTransport.produce({ kind, rtpParameters });
        session.producerId = producer.id;
        socket.data.producer = producer;

        producer.on('transportclose', () => {
          session.producerId = null;
        });

        // Tell everyone already listening that live audio has started, and
        // let the room (any listener that joins later) know too via a flag
        // they can poll with listener:getSessionInfo.
        io.to(`session:${session.code}`).emit('session:producerReady');

        callback({ ok: true, id: producer.id });
      } catch (err) {
        console.error('produce failed', err);
        callback({ ok: false, error: 'Could not publish audio.' });
      }
    });

    socket.on('lecturer:pause', async (_, callback) => {
      try {
        await socket.data.producer?.pause();
        callback?.({ ok: true });
      } catch (err) {
        callback?.({ ok: false, error: err.message });
      }
    });

    socket.on('lecturer:resume', async (_, callback) => {
      try {
        await socket.data.producer?.resume();
        callback?.({ ok: true });
      } catch (err) {
        callback?.({ ok: false, error: err.message });
      }
    });

    socket.on('lecturer:endSession', (_, callback) => {
      const session = sessionStore.findByLecturerSocket(socket.id);
      if (session) {
        io.to(`session:${session.code}`).emit('session:ended');
        session.router.close(); // closes all transports/producers/consumers under it
        sessionStore.remove(session.code);
      }
      callback?.({ ok: true });
    });

    // ---- STUDENT: look up a session by code before joining ------------
    socket.on('listener:getSessionInfo', ({ code }, callback) => {
      const session = sessionStore.get(code);
      if (!session) return callback({ ok: false, error: 'No session found with that code.' });
      callback({
        ok: true,
        label: session.label,
        live: Boolean(session.producerId),
      });
    });

    // ---- STUDENT: join a session's room (does not yet receive audio) --
    socket.on('listener:join', ({ code }, callback) => {
      const session = sessionStore.get(code);
      if (!session) return callback({ ok: false, error: 'No session found with that code.' });

      socket.join(`session:${session.code}`);
      socket.data.role = 'listener';
      socket.data.sessionCode = session.code;
      session.listeners.set(socket.id, {});
      callback({ ok: true, label: session.label, live: Boolean(session.producerId) });
    });

    // ---- STUDENT: set up the transport that will receive audio --------
    socket.on('listener:createConsumerTransport', async (_, callback) => {
      try {
        const session = sessionStore.get(socket.data.sessionCode);
        if (!session) return callback({ ok: false, error: 'Session no longer exists.' });

        const { transport, params } = await createWebRtcTransport(session.router);
        socket.data.consumerTransport = transport;
        callback({
          ok: true,
          params,
          rtpCapabilities: session.router.rtpCapabilities,
        });
      } catch (err) {
        console.error('createConsumerTransport failed', err);
        callback({ ok: false, error: 'Could not set up listening transport.' });
      }
    });

    socket.on('listener:connectConsumerTransport', async ({ dtlsParameters }, callback) => {
      try {
        await socket.data.consumerTransport.connect({ dtlsParameters });
        callback({ ok: true });
      } catch (err) {
        console.error('connectConsumerTransport failed', err);
        callback({ ok: false, error: 'Could not connect listening transport.' });
      }
    });

    // ---- STUDENT: actually start receiving the lecturer's audio -------
    socket.on('listener:consume', async ({ rtpCapabilities }, callback) => {
      try {
        const session = sessionStore.get(socket.data.sessionCode);
        if (!session) return callback({ ok: false, error: 'Session no longer exists.' });
        if (!session.producerId) return callback({ ok: false, error: 'Lecturer has not started audio yet.' });

        const canConsume = session.router.canConsume({
          producerId: session.producerId,
          rtpCapabilities,
        });
        if (!canConsume) return callback({ ok: false, error: 'Audio format mismatch.' });

        const consumer = await socket.data.consumerTransport.consume({
          producerId: session.producerId,
          rtpCapabilities,
          paused: false,
        });

        socket.data.consumer = consumer;
        const listenerEntry = session.listeners.get(socket.id) || {};
        listenerEntry.consumerId = consumer.id;
        session.listeners.set(socket.id, listenerEntry);

        consumer.on('producerclose', () => {
          socket.emit('session:producerStopped');
        });

        callback({
          ok: true,
          params: {
            id: consumer.id,
            producerId: session.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          },
        });
      } catch (err) {
        console.error('consume failed', err);
        callback({ ok: false, error: 'Could not start audio.' });
      }
    });

    // ---- Cleanup on disconnect (covers tab close, network drop, etc.) -
    socket.on('disconnect', () => {
      if (socket.data.role === 'lecturer') {
        const session = sessionStore.findByLecturerSocket(socket.id);
        if (session) {
          io.to(`session:${session.code}`).emit('session:ended');
          session.router.close();
          sessionStore.remove(session.code);
        }
      } else if (socket.data.role === 'listener') {
        const session = sessionStore.findByListenerSocket(socket.id);
        session?.listeners.delete(socket.id);
        socket.data.consumerTransport?.close();
      }
    });
  });
}
