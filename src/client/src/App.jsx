import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import { useSocket } from './useSocket';
import PaymentModal from './PaymentModal';
import './index.css';

// ─────────────────────────────────────────────────────────────────────────────
// Countdown
// ─────────────────────────────────────────────────────────────────────────────
function Countdown({ expiresAt }) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    function tick() {
      setSecondsLeft(Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000)));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const pct = Math.max(0, (secondsLeft / 300) * 100);
  const urgent = secondsLeft < 60;

  return (
    <div className="countdown-wrap">
      <div className={`countdown-time ${urgent ? 'urgent' : ''}`}>
        {m}:{String(s).padStart(2, '0')}
      </div>
      <div className="countdown-bar-bg">
        <div className={`countdown-bar ${urgent ? 'urgent' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="countdown-label">time remaining to pay</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock badge
// ─────────────────────────────────────────────────────────────────────────────
function StockBadge({ stock }) {
  const color = stock === 0 ? '#ef4444' : stock <= 5 ? '#f97316' : '#22c55e';
  return (
    <div className="stock-badge">
      <span className="stock-number" style={{ color }}>{stock}</span>
      <span className="stock-label">pairs left</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Form  —  register collects username + email + password
//               login    collects username-or-email + password
// ─────────────────────────────────────────────────────────────────────────────
function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function switchMode(m) {
    setMode(m);
    setError('');
    setUsername('');
    setEmail('');
    setPassword('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    // Client-side Gmail check before even hitting the server
    if (mode === 'register' && !email.toLowerCase().endsWith('@gmail.com')) {
      setError('Only Gmail addresses (@gmail.com) are accepted');
      return;
    }

    setLoading(true);
    try {
      let data;
      if (mode === 'login') {
        data = await api.login(username, password);
      } else {
        data = await api.register(username, email, password);
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('username', data.user.username);
      localStorage.setItem('email', data.user.email || '');
      onAuth(data.user);
    } catch (err) {
      setError(err.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-center">
      <div className="auth-card">

        <div className="brand">
          <div className="brand-icon">👟</div>
          <h1 className="brand-name">SNEAKDROP</h1>
          <p className="brand-sub">Limited Release — 20 Pairs Only</p>
        </div>

        <div className="auth-tabs">
          <button className={`tab-btn ${mode === 'login' ? 'active' : ''}`} onClick={() => switchMode('login')}>Log In</button>
          <button className={`tab-btn ${mode === 'register' ? 'active' : ''}`} onClick={() => switchMode('register')}>Register</button>
        </div>

        <form onSubmit={submit} className="auth-form">

          {/* Username */}
          <div className="field">
            <label>{mode === 'login' ? 'Username or Gmail' : 'Username'}</label>
            <input
              placeholder={mode === 'login' ? 'username or you@gmail.com' : 'Choose a username'}
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          {/* Email — register only */}
          {mode === 'register' && (
            <div className="field">
              <label>Gmail Address</label>
              <div className="input-icon-wrap">
                <span className="input-icon">✉️</span>
                <input
                  type="email"
                  placeholder="you@gmail.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <span className="field-hint">Only @gmail.com addresses are accepted</span>
            </div>
          )}

          {/* Password */}
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              placeholder={mode === 'register' ? 'Create a password' : 'Enter your password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="alert error">{error}</div>}

          <button type="submit" className="btn primary full" disabled={loading}>
            {loading
              ? <span className="spinner" />
              : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>

        </form>

        <p className="auth-footer">Thousands will try. Only 20 will win.</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sale Panel
// ─────────────────────────────────────────────────────────────────────────────
function SalePanel({ user, onLogout }) {
  const [status, setStatus] = useState(null);
  const [globalState, setGlobalState] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [activity, setActivity] = useState([]); // live activity log
  const pollRef = useRef(null);

  // Add an entry to the live activity log (max 5 shown)
  function addActivity(icon, text) {
    const entry = { id: Date.now(), icon, text, ts: new Date().toLocaleTimeString() };
    setActivity(prev => [entry, ...prev].slice(0, 5));
  }

  const fetchStatus = useCallback(async () => {
    try { setStatus(await api.getStatus()); } catch { /* token expired */ }
  }, []);

  const handleState = useCallback((payload) => {
    setGlobalState(prev => {
      // Detect stock changes and log them
      if (prev !== null && payload.stock !== prev.stock) {
        const diff = payload.stock - prev.stock;
        if (diff > 0) addActivity('📦', `Stock increased: ${prev.stock} → ${payload.stock} pairs`);
        if (diff < 0) addActivity('🔒', `Pair reserved — ${payload.stock} pairs remaining`);
      }
      if (prev !== null && payload.queueLength !== prev.queueLength) {
        if (payload.queueLength > prev.queueLength) addActivity('📋', `Someone joined the waitlist (#${payload.queueLength})`);
        if (payload.queueLength < prev.queueLength) addActivity('✅', `Waitlist user was promoted to a hold`);
      }
      return payload;
    });
    fetchStatus();
  }, [fetchStatus]);

  const { connected } = useSocket(handleState);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 5000);
    return () => clearInterval(pollRef.current);
  }, [fetchStatus]);

  function toast(type, text) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 7000);
  }

  async function handleBuy() {
    setLoading(true);
    try {
      const d = await api.buy();
      toast('success', d.message);
      addActivity('🛒', `You reserved a pair — 5 min countdown started`);
      fetchStatus();
    }
    catch (err) { toast('error', err.data?.message || err.message); }
    finally { setLoading(false); }
  }

  async function handleJoinWaitlist() {
    setLoading(true);
    try {
      const d = await api.joinWaitlist();
      toast('info', `Added to waitlist — you're #${d.position} in line`);
      addActivity('📋', `You joined the waitlist at position #${d.position}`);
      fetchStatus();
    }
    catch (err) { toast('error', err.data?.error || err.message); }
    finally { setLoading(false); }
  }

  async function handleLeaveWaitlist() {
    setLoading(true);
    try {
      await api.leaveWaitlist();
      toast('info', 'Removed from waitlist.');
      addActivity('👋', 'You left the waitlist');
      fetchStatus();
    }
    catch (err) { toast('error', err.data?.error || err.message); }
    finally { setLoading(false); }
  }

  const stock = globalState?.stock ?? status?.stock ?? null;
  const queueLength = globalState?.queueLength ?? 0;
  const hasHold = !!status?.hold;
  const inQueue = status?.queuePosition !== null && status?.queuePosition !== undefined;
  const maxedOut = status?.purchasedCount >= 2;
  const canBuy = !hasHold && !inQueue && !maxedOut && stock > 0;
  const canWaitlist = !hasHold && !inQueue && !maxedOut && stock === 0;

  return (
    <div className="sale-page">

      {/* ── Navbar ── */}
      <nav className="navbar">
        <div className="nav-brand">
          <span className="nav-icon">👟</span>
          <span className="nav-name">SNEAKDROP</span>
        </div>
        <div className="nav-right">
          <div className={`live-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Live' : 'Reconnecting…'} />
          <div className="nav-user-info">
            <span className="nav-user">@{user.username}</span>
            {user.email && user.email !== user.username && <span className="nav-email">{user.email}</span>}
          </div>
          <button className="btn ghost sm" onClick={onLogout}>Log out</button>
        </div>
      </nav>

      <div className="sale-body">

        {/* ── Hero ── */}
        <div className="hero">
          <div className="hero-shoe">👟</div>
          <h2 className="hero-title">Air Limited '25</h2>
          <p className="hero-desc">One colorway. One drop. No restocks.</p>
        </div>

        {/* ── Stats ── */}
        <div className="stats-row">
          <div className="stat-card">
            {stock !== null ? <StockBadge stock={stock} /> : <div className="loading-dots" />}
          </div>
          <div className="stat-card">
            <span className="stat-number" style={{ color: queueLength > 0 ? '#f97316' : 'inherit' }}>{queueLength}</span>
            <span className="stat-label">in waitlist</span>
          </div>
          <div className="stat-card">
            <span className="stat-number">
              {status?.purchasedCount ?? 0}
              <span className="stat-denom">/2</span>
            </span>
            <span className="stat-label">your purchases</span>
          </div>
        </div>

        {/* ── Hold card — shown when user has an active reservation ── */}
        {hasHold && (
          <div className="hold-card">
            <div className="hold-header">
              <span className="hold-icon">🔒</span>
              <div>
                <span className="hold-title">Pair Reserved</span>
                <span className="hold-sub"> — Pay before the timer runs out or your pair goes back to stock</span>
              </div>
            </div>
            <Countdown expiresAt={status.hold.expiresAt} />
            <div className="hold-actions">
              <button className="btn pay large" onClick={() => setShowPayment(true)} disabled={loading}>
                {loading ? <span className="spinner" /> : '💳 Complete Payment'}
              </button>
            </div>
            <div className="hold-ref">Payment ref: {status.hold.paymentRef}</div>
          </div>
        )}

        {/* ── Queue card — shown when user is in waitlist ── */}
        {inQueue && !hasHold && (
          <div className="queue-card">
            <div className="queue-pos">#{status.queuePosition}</div>
            <div className="queue-label">your position in the waitlist</div>
            <p className="queue-note">
              When someone's hold expires, you'll automatically receive a hold with your own 5-minute window.
            </p>
            <button className="btn ghost sm leave-btn" onClick={handleLeaveWaitlist} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Leave Waitlist'}
            </button>
          </div>
        )}

        {/* ── Maxed out ── */}
        {maxedOut && (
          <div className="success-banner">
            🎉 You've secured your 2 pairs. See you at the next drop!
          </div>
        )}

        {/* ── Primary CTA ── */}
        {(canBuy || canWaitlist) && (
          <div className="actions">
            {canBuy && (
              <button className="btn primary large" onClick={handleBuy} disabled={loading}>
                {loading ? <span className="spinner" /> : '🛒 Reserve a Pair'}
              </button>
            )}
            {canWaitlist && (
              <div className="waitlist-cta">
                <p className="waitlist-cta-msg">All pairs are currently held. Join the line — holds expire and pairs return to stock.</p>
                <button className="btn waitlist large" onClick={handleJoinWaitlist} disabled={loading}>
                  {loading ? <span className="spinner" /> : '📋 Join Waitlist'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Toast ── */}
        {message && (
          <div className={`toast ${message.type}`}>
            {message.type === 'success' && '✅ '}
            {message.type === 'error' && '❌ '}
            {message.type === 'info' && 'ℹ️ '}
            {message.text}
          </div>
        )}

        {/* ── Live activity feed ── */}
        {activity.length > 0 && (
          <div className="activity-feed">
            <p className="activity-title">⚡ Live Activity</p>
            {activity.map(a => (
              <div key={a.id} className="activity-item">
                <span className="activity-icon">{a.icon}</span>
                <span className="activity-text">{a.text}</span>
                <span className="activity-ts">{a.ts}</span>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* ── Payment modal ── */}
      {showPayment && status?.hold && (
        <PaymentModal
          hold={status.hold}
          user={user}
          onClose={() => setShowPayment(false)}
          onSuccess={(newStatus) => {
            setShowPayment(false);
            setStatus(newStatus);
            addActivity('💳', 'Payment confirmed — pair secured!');
            toast('success', '🎉 Payment confirmed! Your pair is secured.');
            fetchStatus();
          }}
        />
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => {
    const id = localStorage.getItem('userId');
    const username = localStorage.getItem('username');
    const email = localStorage.getItem('email');
    return id ? { id, username, email } : null;
  });

  function handleLogout() {
    localStorage.clear();
    setUser(null);
  }

  if (!user) return <AuthForm onAuth={setUser} />;
  return <SalePanel user={user} onLogout={handleLogout} />;
}
