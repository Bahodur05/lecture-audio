import { useState, useRef, useCallback, useEffect } from 'react';
import { getSocket, emitAsync } from '../lib/socket.js';
import { startBroadcast, stopBroadcast } from '../lib/broadcaster.js';
import { Waveform } from '../components/Waveform.jsx';

const STATUS = {
  IDLE: 'idle',
  CHOOSING_INPUT: 'choosing_input',
  LIVE: 'live',
  PAUSED: 'paused',
  ERROR: 'error',
};

export function LecturerPage() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [code, setCode] = useState(null);
  const [label, setLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [inputDevices, setInputDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [listenerCount, setListenerCount] = useState(0);
  const [stream, setStream] = useState(null);

  const broadcastRef = useRef(null);

  // Enumerate audio inputs once a session exists, so the lecturer can pick
  // the AV mixer's line input (often shows up as a USB audio interface or
  // "Line In") rather than a laptop's built-in mic.
  useEffect(() => {
    if (status !== STATUS.CHOOSING_INPUT) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      setInputDevices(audioInputs);
      if (audioInputs.length > 0) setSelectedDeviceId(audioInputs[0].deviceId);
    });
  }, [status]);

  // Poll listener count while live, lightweight UI feedback for the lecturer.
  useEffect(() => {
    if (status !== STATUS.LIVE && status !== STATUS.PAUSED) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'}/api/session/${code}`
        );
        const data = await res.json();
        if (data.ok) setListenerCount(data.listenerCount);
      } catch {
        // Silent — this is a nice-to-have counter, not critical path.
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [status, code]);

  const handleCreateSession = useCallback(async () => {
    setErrorMsg(null);
    try {
      getSocket(); // ensure connection is initiated
      const res = await emitAsync('lecturer:createSession', { label: label || 'Lecture' });
      setCode(res.code);
      setStatus(STATUS.CHOOSING_INPUT);
    } catch (err) {
      setErrorMsg(err.message);
      setStatus(STATUS.ERROR);
    }
  }, [label]);

  const handleGoLive = useCallback(async () => {
    setErrorMsg(null);
    try {
      const constraints = {
        audio: selectedDeviceId
          ? {
              deviceId: { exact: selectedDeviceId },
              echoCancellation: false, // AV mixer feed is a clean line signal
              noiseSuppression: false, // already processed upstream; don't double-process
              autoGainControl: false,
            }
          : true,
      };
      const userStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(userStream);
      const broadcast = await startBroadcast(userStream);
      broadcastRef.current = broadcast;
      setStatus(STATUS.LIVE);
    } catch (err) {
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser settings and try again.'
          : err.message
      );
      setStatus(STATUS.ERROR);
    }
  }, [selectedDeviceId]);

  const handlePauseResume = useCallback(async () => {
    if (status === STATUS.LIVE) {
      await emitAsync('lecturer:pause');
      setStatus(STATUS.PAUSED);
    } else if (status === STATUS.PAUSED) {
      await emitAsync('lecturer:resume');
      setStatus(STATUS.LIVE);
    }
  }, [status]);

  const handleEndSession = useCallback(async () => {
    if (broadcastRef.current) stopBroadcast(broadcastRef.current);
    stream?.getTracks().forEach((t) => t.stop());
    await emitAsync('lecturer:endSession').catch(() => {});
    setStatus(STATUS.IDLE);
    setCode(null);
    setStream(null);
    setListenerCount(0);
  }, [stream]);

  return (
    <div className="container">
      <header style={{ marginBottom: 32 }}>
        <p className="label">Lecturer</p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, margin: '4px 0 0' }}>
          Start an audio session
        </h1>
      </header>

      {status === STATUS.IDLE && (
        <div className="card">
          <label className="label" htmlFor="label-input" style={{ display: 'block', marginBottom: 8 }}>
            Session name (optional)
          </label>
          <input
            id="label-input"
            type="text"
            style={{ textTransform: 'none', fontFamily: 'var(--font-body)', fontSize: 16, marginBottom: 16 }}
            placeholder="e.g. IDA Lecture 3"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
          />
          <button className="btn btn-primary btn-block" onClick={handleCreateSession}>
            Create session
          </button>
        </div>
      )}

      {status === STATUS.CHOOSING_INPUT && (
        <div className="card">
          <p className="label" style={{ marginBottom: 8 }}>Session code</p>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 36,
              letterSpacing: '0.1em',
              color: 'var(--accent)',
              marginBottom: 24,
            }}
          >
            {code}
          </div>

          <label className="label" htmlFor="device-select" style={{ display: 'block', marginBottom: 8 }}>
            Audio input
          </label>
          <select
            id="device-select"
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            style={{
              width: '100%',
              padding: 12,
              marginBottom: 8,
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 15,
            }}
          >
            {inputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Audio input'}
              </option>
            ))}
          </select>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 0, marginBottom: 20 }}>
            Choose the lecture hall's AV mixer or line input here — not the laptop's built-in mic — if
            it appears in this list.
          </p>

          <button className="btn btn-primary btn-block" onClick={handleGoLive}>
            Go live
          </button>
        </div>
      )}

      {(status === STATUS.LIVE || status === STATUS.PAUSED) && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <span className={`status-dot ${status === STATUS.LIVE ? 'live' : 'warn'}`} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {status === STATUS.LIVE ? 'Live' : 'Paused'}
              </span>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>
              {listenerCount} listening
            </span>
          </div>

          <Waveform stream={stream} idle={status === STATUS.PAUSED} />

          <p className="label" style={{ marginTop: 24, marginBottom: 8 }}>Session code</p>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 32,
              letterSpacing: '0.1em',
              color: 'var(--accent)',
              marginBottom: 24,
            }}
          >
            {code}
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handlePauseResume}>
              {status === STATUS.LIVE ? 'Pause' : 'Resume'}
            </button>
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleEndSession}>
              End session
            </button>
          </div>
        </div>
      )}

      {errorMsg && <p className="error-text">{errorMsg}</p>}
    </div>
  );
}
