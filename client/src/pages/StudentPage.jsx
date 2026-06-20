import { useState, useRef, useCallback, useEffect } from 'react';
import { getSocket, emitAsync } from '../lib/socket.js';
import { joinAndConsume, consumeNow, leaveSession } from '../lib/listener.js';
import { Waveform } from '../components/Waveform.jsx';

const STATUS = {
  ENTER_CODE: 'enter_code',
  WAITING: 'waiting', // joined, lecturer hasn't gone live yet
  LISTENING: 'listening',
  ERROR: 'error',
};

export function StudentPage({ initialCode = '' }) {
  const [status, setStatus] = useState(STATUS.ENTER_CODE);
  const [codeInput, setCodeInput] = useState(initialCode);
  const [label, setLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [muted, setMuted] = useState(false);
  const [stream, setStream] = useState(null);

  const audioRef = useRef(null);
  const sessionRef = useRef(null);

  // If the lecturer wasn't live yet when we joined, listen for the
  // session:producerReady event and auto-start audio the moment they go live —
  // no need for the student to do anything.
  useEffect(() => {
    if (status !== STATUS.WAITING) return;
    const socket = getSocket();

    const onProducerReady = async () => {
      try {
        const { recvTransport, device } = sessionRef.current;
        const { consumer, stream: newStream } = await consumeNow(recvTransport, device);
        sessionRef.current.consumer = consumer;
        setStream(newStream);
        setStatus(STATUS.LISTENING);
      } catch (err) {
        setErrorMsg(err.message);
      }
    };

    socket.on('session:producerReady', onProducerReady);
    return () => socket.off('session:producerReady', onProducerReady);
  }, [status]);

  useEffect(() => {
    const socket = getSocket();
    const onEnded = () => {
      setStatus(STATUS.ENTER_CODE);
      setStream(null);
      setErrorMsg('The lecturer ended this session.');
    };
    const onProducerStopped = () => {
      setStream(null);
      setStatus(STATUS.WAITING);
    };
    socket.on('session:ended', onEnded);
    socket.on('session:producerStopped', onProducerStopped);
    return () => {
      socket.off('session:ended', onEnded);
      socket.off('session:producerStopped', onProducerStopped);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(() => {
        // Autoplay can be blocked until a user gesture; the visible
        // "Listening" controls double as that gesture in practice since
        // the student tapped "Join" to get here.
      });
    }
  }, [stream]);

  const handleJoin = useCallback(async () => {
    setErrorMsg(null);
    const cleanCode = codeInput.trim().toUpperCase();
    if (!cleanCode) return;

    try {
      getSocket();
      const result = await joinAndConsume(cleanCode);
      sessionRef.current = result;
      setLabel(result.label);
      if (result.stream) {
        setStream(result.stream);
        setStatus(STATUS.LISTENING);
      } else {
        setStatus(STATUS.WAITING);
      }
    } catch (err) {
      setErrorMsg(err.message);
      setStatus(STATUS.ERROR);
    }
  }, [codeInput]);

  const handleLeave = useCallback(() => {
    if (sessionRef.current) leaveSession(sessionRef.current);
    sessionRef.current = null;
    setStream(null);
    setStatus(STATUS.ENTER_CODE);
    setCodeInput('');
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (audioRef.current) audioRef.current.muted = !m;
      return !m;
    });
  }, []);

  return (
    <div className="container" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', justifyContent: 'center' }}>
      <audio ref={audioRef} autoPlay playsInline />

      {(status === STATUS.ENTER_CODE || status === STATUS.ERROR) && (
        <div className="card">
          <p className="label" style={{ marginBottom: 8 }}>Join a session</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, margin: '0 0 24px' }}>
            Enter the code your lecturer shared
          </h1>
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="------"
            maxLength={6}
            autoFocus
            style={{ marginBottom: 16 }}
          />
          <button className="btn btn-primary btn-block" onClick={handleJoin} disabled={!codeInput.trim()}>
            Join
          </button>
          {errorMsg && <p className="error-text">{errorMsg}</p>}
        </div>
      )}

      {status === STATUS.WAITING && (
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="status-dot warn" />
          <p style={{ color: 'var(--text-dim)', margin: '12px 0 4px' }}>{label}</p>
          <p style={{ fontSize: 15 }}>Waiting for the lecturer to go live&hellip;</p>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 16 }}>
            Audio will start automatically — no need to refresh.
          </p>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 24 }} onClick={handleLeave}>
            Leave
          </button>
        </div>
      )}

      {status === STATUS.LISTENING && (
        <div style={{ textAlign: 'center' }}>
          <span className="status-dot live" />
          <p style={{ color: 'var(--text-dim)', margin: '12px 0 28px', fontSize: 15 }}>{label}</p>

          <Waveform stream={stream} />

          <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={toggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleLeave}>
              Leave
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
