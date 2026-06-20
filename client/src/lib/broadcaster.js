import * as mediasoupClient from 'mediasoup-client';
import { emitAsync, getSocket } from './socket.js';

/**
 * Starts broadcasting a MediaStream (the AV mixer feed, or the lecturer's
 * own mic as a fallback) into the session this socket already created.
 *
 * Call createSession() first to get a code, then call this once the
 * lecturer has picked their audio input and pressed "Go live."
 */
export async function startBroadcast(stream) {
  const socket = getSocket();

  // 1. Create a send transport on the server and mirror it locally.
  const createRes = await emitAsync('lecturer:createProducerTransport');
  const device = new mediasoupClient.Device();

  // The router's RTP capabilities aren't sent back from createProducerTransport
  // directly in this flow — we fetch them via a session info round-trip the
  // first time. Simpler: server already created the router when the session
  // was created, so we ask for its capabilities here.
  const capsRes = await emitAsync('lecturer:getRouterCapabilities');
  await device.load({ routerRtpCapabilities: capsRes.rtpCapabilities });

  const sendTransport = device.createSendTransport(createRes.params);

  sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
    emitAsync('lecturer:connectProducerTransport', { dtlsParameters })
      .then(() => callback())
      .catch(errback);
  });

  sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
    emitAsync('lecturer:produce', { kind, rtpParameters })
      .then(({ id }) => callback({ id }))
      .catch(errback);
  });

  sendTransport.on('connectionstatechange', (state) => {
    if (state === 'failed' || state === 'closed') {
      console.warn('Producer transport connection state:', state);
    }
  });

  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error('Selected audio source has no audio track.');

  const producer = await sendTransport.produce({
    track,
    // Opus-specific tuning: prioritize clarity/continuity of speech over
    // bandwidth — lecture audio is mono speech, not music, so we don't
    // need the higher bitrate ceiling.
    codecOptions: {
      opusStereo: false,
      opusDtx: true,
    },
  });

  return { sendTransport, producer };
}

export function stopBroadcast({ sendTransport, producer }) {
  producer?.close();
  sendTransport?.close();
}
