import * as mediasoupClient from 'mediasoup-client';
import { emitAsync } from './socket.js';

/**
 * Joins a session room (by code) and, if the lecturer is already live,
 * sets up the receive transport and starts consuming audio. Returns an
 * HTMLAudioElement-ready MediaStream the caller can attach to <audio>.
 */
export async function joinAndConsume(code) {
  const joinRes = await emitAsync('listener:join', { code });

  const transportRes = await emitAsync('listener:createConsumerTransport');
  const device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: transportRes.rtpCapabilities });

  const recvTransport = device.createRecvTransport(transportRes.params);

  recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
    emitAsync('listener:connectConsumerTransport', { dtlsParameters })
      .then(() => callback())
      .catch(errback);
  });

  let consumer = null;
  let stream = null;

  if (joinRes.live) {
    const result = await consumeNow(recvTransport, device);
    consumer = result.consumer;
    stream = result.stream;
  }

  return { recvTransport, device, consumer, stream, label: joinRes.label };
}

/**
 * Called either immediately on join (if already live) or later in response
 * to the session:producerReady event (lecturer started audio after the
 * student had already joined the room).
 */
export async function consumeNow(recvTransport, device) {
  const res = await emitAsync('listener:consume', {
    rtpCapabilities: device.rtpCapabilities,
  });

  const consumer = await recvTransport.consume({
    id: res.params.id,
    producerId: res.params.producerId,
    kind: res.params.kind,
    rtpParameters: res.params.rtpParameters,
  });

  consumer.resume();
  await emitAsync('listener:resumeConsumer').catch(() => {});

  const stream = new MediaStream([consumer.track]);
  return { consumer, stream };
}

export function leaveSession({ recvTransport, consumer }) {
  consumer?.close();
  recvTransport?.close();
}
