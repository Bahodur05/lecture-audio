// Central configuration for the SFU server.
// Tunable via environment variables so the same code works locally and on
// Render/Fly.io without edits.

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  port: process.env.PORT || 3000,

  // Mediasoup needs to advertise a publicly reachable IP for ICE candidates.
  // On Render/Fly.io, set ANNOUNCED_IP to the service's public IP or hostname.
  // Locally, this falls back to 127.0.0.1 for same-machine testing.
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: process.env.ANNOUNCED_IP || (isProd ? undefined : '127.0.0.1'),
      },
    ],
    // Fly.io / Render route UDP through a limited port range or only expose
    // TCP — keep a wide-ish range but bound it so firewall rules are simple.
    minPort: parseInt(process.env.RTC_MIN_PORT || '40000', 10),
    maxPort: parseInt(process.env.RTC_MAX_PORT || '40100', 10),
    initialAvailableOutgoingBitrate: 64000,
    maxIncomingBitrate: 128000,
  },

  // Single worker is plenty for audio-only at lecture-hall scale (one
  // producer, up to a few hundred consumers). Bump numWorkers if you later
  // run multiple simultaneous lecture halls and want load spread across cores.
  numWorkers: parseInt(process.env.MEDIASOUP_NUM_WORKERS || '1', 10),

  // Audio-only router. No video codecs at all — keeps bandwidth and CPU low,
  // which matters on a free-tier instance serving a full lecture hall.
  mediaCodecs: [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
      // useinbandfec=1 lets Opus recover from small packet losses without
      // a retransmit round-trip — meaningfully reduces perceived glitches
      // on patchy Eduroam wifi without adding latency.
      parameters: {
        useinbandfec: 1,
        usedtx: 1,
      },
    },
  ],

  // Session codes: short, spoken-aloud-friendly. 6 chars, uppercase
  // alphanumeric minus visually ambiguous characters (0/O, 1/I/L).
  sessionCodeAlphabet: '23456789ABCDEFGHJKMNPQRSTUVWXYZ',
  sessionCodeLength: 6,

  // Auto-expire empty sessions after this many minutes so old lecture
  // sessions don't pile up in memory.
  sessionTtlMinutes: parseInt(process.env.SESSION_TTL_MINUTES || '240', 10),
};
