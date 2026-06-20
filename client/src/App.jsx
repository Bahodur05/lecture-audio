import { useState, useEffect } from 'react';
import { LecturerPage } from './pages/LecturerPage.jsx';
import { StudentPage } from './pages/StudentPage.jsx';

/**
 * Minimal routing: no router library needed for a two-screen app.
 * Supports a direct join link like /?join=AB12CD so a lecturer can share
 * a tappable link alongside the spoken code (QR code friendly too).
 */
export default function App() {
  const [role, setRole] = useState(null);
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('join');
    if (code) {
      setJoinCode(code);
      setRole('student');
    }
  }, []);

  if (role === 'lecturer') return <LecturerPage />;
  if (role === 'student') return <StudentPage initialCode={joinCode} />;

  return (
    <div className="app-shell" style={{ justifyContent: 'center' }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <p className="label">Lecture Audio</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, margin: '8px 0 0' }}>
            Clear audio, anywhere in the hall
          </h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button className="btn btn-primary btn-block" onClick={() => setRole('lecturer')}>
            I'm lecturing
          </button>
          <button className="btn btn-secondary btn-block" onClick={() => setRole('student')}>
            I'm a student
          </button>
        </div>
      </div>
    </div>
  );
}
