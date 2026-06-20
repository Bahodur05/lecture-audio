# Lecture Audio

Low-latency audio streaming from a lecture hall's existing mic/AV setup to
students' phones over the campus wifi (Eduroam) — no extra hardware, no app
install for students.

## How it works

```
Lecture hall AV mixer / mic
        │ (line-out, tapped via USB audio interface or 3.5mm → laptop)
        ▼
  Lecturer's laptop/PC  ──┐
  (browser tab, "Go live") │  WebRTC (Opus audio)
                           ▼
                  SFU server (mediasoup)
                  hosted on Render/Fly.io
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   Student phone      Student phone      Student phone
   (browser, code)    (browser, code)    (browser, code)
```

The SFU (Selective Forwarding Unit) pattern means the lecturer's audio is
uploaded once and the server fans it out to every listener — this is what
lets it scale to a full lecture hall (100+ students) without the lecturer's
upload bandwidth or the server's CPU collapsing, which a simple
peer-to-peer mesh would.

- **Lecturer side**: opens the app, creates a session, gets a 6-character
  code (e.g. `7K4PXR`), picks their audio input (ideally the AV mixer feed,
  not the laptop mic), and presses "Go live."
- **Student side**: opens the app in any phone browser, types the code,
  and audio starts automatically — no install, no account.
- Typical latency on a local/campus network: well under a second.

## Project structure

```
server/   Node.js + mediasoup SFU + Socket.io signaling
client/   React (Vite) web app — lecturer and student views in one app
```

## Local development

### 1. Server

```bash
cd server
npm install        # mediasoup compiles a native worker on first install —
                    # needs real internet access (this won't work behind a
                    # restrictive sandbox/firewall, but works fine on a
                    # normal machine or on Render/Fly.io)
npm run dev
```

Server starts on `http://localhost:3000` by default.

### 2. Client

```bash
cd client
cp .env.example .env   # then edit VITE_SERVER_URL if needed
npm install
npm run dev
```

Open the printed local URL. On the same wifi network, open it on a phone
too, using your computer's local IP instead of `localhost`.

**Note on local testing across devices:** mediasoup's WebRTC transport
needs a real, reachable IP in `ANNOUNCED_IP` (see `server/src/config.js`)
to work across different devices. `127.0.0.1` only works for testing on a
single machine. For real cross-device local testing, set `ANNOUNCED_IP` to
your machine's LAN IP (e.g. `192.168.1.42`).

## Deploying for real (Render or Fly.io)

This is where mediasoup's native worker actually compiles and runs — do
this on the actual hosting platform, not inside a restricted sandbox.

### Render (simplest)

1. Push this repo to GitHub.
2. Create a new **Web Service** on Render, point it at `server/`.
3. Build command: `npm install`. Start command: `npm start`.
4. Set environment variables:
   - `ANNOUNCED_IP` — Render assigns a public IP/hostname; check Render's
     docs for how to get the service's outbound IP, or use their static
     outbound IP feature if on a paid plan. On the free tier, you may need
     to set this to the service's public hostname instead — test this with
     a real device once deployed, since this is the one setting that
     varies most by host.
   - `RTC_MIN_PORT` / `RTC_MAX_PORT` — Render's free tier may restrict raw
     UDP port ranges. If audio fails to connect, check Render's networking
     docs for current UDP support, or fall back to TCP-only by setting
     `enableUdp: false` in `mediasoupManager.js` (slightly higher latency,
     more firewall-friendly).
5. Deploy the `client/` folder as a **Static Site** on Render, with
   `VITE_SERVER_URL` set to your server's public URL at build time.

### Fly.io (more control over networking)

Fly.io supports UDP more directly, which mediasoup prefers:

```bash
cd server
fly launch          # creates fly.toml, pick a region close to Birmingham (lhr)
fly secrets set ANNOUNCED_IP=<your-fly-app-ip>
fly deploy
```

You'll need to open the UDP port range in `fly.toml`:

```toml
[[services]]
  protocol = "udp"
  internal_port = 40000
  # ... port range matching RTC_MIN_PORT/RTC_MAX_PORT in config.js
```

Check Fly.io's current docs for the exact UDP service block syntax, since
this has changed across Fly platform versions.

## What this does NOT yet handle (intentionally out of scope for v1)

- **Recording**: this is a live relay only, separate from Panopto. The
  lecturer still starts Panopto recording as normal on the lecture hall PC;
  this app runs alongside it, not instead of it.
- **Authentication**: anyone with the code can join. Fine for a lecture
  hall where the code is only shared verbally/on-screen during the session,
  but not suitable as-is for anything sensitive.
- **Multiple simultaneous lecturers' sessions sharing one server instance**
  work fine (each gets its own mediasoup router), but very high concurrent
  load across many halls at once would need more than one server instance
  plus a shared session store (e.g. Redis) — not needed for a single
  department's pilot.

## Why mediasoup instead of a simpler approach

A naive WebRTC mesh (every listener connects directly to the lecturer) does
not scale — the lecturer's laptop would need to upload audio separately to
every single listener, which falls over well before 100 students. An SFU
server in the middle receives the audio once and forwards it to everyone,
which is the architecture every real-world lecture-capture/streaming tool
uses under the hood.
