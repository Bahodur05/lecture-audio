import * as mediasoup from 'mediasoup';
import { config } from './config.js';

/** @type {import('mediasoup').types.Worker[]} */
const workers = [];
let nextWorkerIdx = 0;

export async function initWorkers() {
  for (let i = 0; i < config.numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: config.webRtcTransport.minPort,
      rtcMaxPort: config.webRtcTransport.maxPort,
    });

    worker.on('died', () => {
      // A worker dying is unusual and almost always means the process ran
      // out of memory or hit a native-code bug. Crash loudly rather than
      // silently degrading — Render/Fly.io will restart the process.
      console.error(`mediasoup worker ${worker.pid} died, exiting in 2s`);
      setTimeout(() => process.exit(1), 2000);
    });

    workers.push(worker);
  }
  console.log(`mediasoup: ${workers.length} worker(s) ready`);
}

function getNextWorker() {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

export async function createRouter() {
  const worker = getNextWorker();
  return worker.createRouter({ mediaCodecs: config.mediaCodecs });
}

export async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport({
    listenIps: config.webRtcTransport.listenIps,
    enableUdp: true,
    enableTcp: true, // TCP fallback matters on restrictive Eduroam configs
    preferUdp: true,
    initialAvailableOutgoingBitrate: config.webRtcTransport.initialAvailableOutgoingBitrate,
  });

  if (config.webRtcTransport.maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(config.webRtcTransport.maxIncomingBitrate);
    } catch {
      // Non-fatal if the underlying worker version doesn't support this.
    }
  }

  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') transport.close();
  });

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}
