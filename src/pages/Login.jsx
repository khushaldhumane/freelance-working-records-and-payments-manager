import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Lock, Eye, EyeOff, Briefcase } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!password) { setError('Please enter your password'); return; }
    setLoading(true);
    try {
      await login(password);
      toast('Welcome back!', 'success');
    } catch (err) {
      setError('Incorrect password. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'var(--bg-primary)',
    }}>
      {/* Decorative blobs */}
      <div style={{
        position: 'fixed', top: '15%', left: '10%',
        width: 500, height: 500,
        background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
        pointerEvents: 'none', borderRadius: '50%',
      }} />
      <div style={{
        position: 'fixed', bottom: '10%', right: '5%',
        width: 400, height: 400,
        background: 'radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)',
        pointerEvents: 'none', borderRadius: '50%',
      }} />

      <div className="animate-slide-up" style={{
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
        gap: '32px',
      }}>
        {/* Brand */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64,
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)',
            borderRadius: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 0 40px rgba(99,102,241,0.4)',
            fontSize: 28,
          }}>
            💼
          </div>
          <h1 style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}>FreelanceTrack</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Enter your password to access your workspace
          </p>
        </div>

        {/* Login Card */}
        <div style={{
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--border-color)',
          borderRadius: '24px',
          padding: '36px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="password">
                <Lock size={14} style={{ display: 'inline', marginRight: 6 }} />
                App Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  autoFocus
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {error && <p className="form-error">{error}</p>}
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg w-full"
              disabled={loading}
              style={{ justifyContent: 'center', marginTop: 4 }}
            >
              {loading ? (
                <><div className="spinner" style={{ width: 18, height: 18 }} /> Signing in…</>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          🔒 Your data is private and secured by Firebase
        </p>
      </div>
    </div>
  );
}
