import React, { useState, useEffect } from 'react';
import { api } from './api';

// ─── Test card presets ────────────────────────────────────────────────────────
const TEST_CARDS = [
  { label: 'Visa (success)', number: '4242 4242 4242 4242', expiry: '12/28', cvv: '123', brand: 'VISA', success: true },
  { label: 'Mastercard (success)', number: '5555 5555 5555 4444', expiry: '11/27', cvv: '456', brand: 'MC', success: true },
  { label: 'Amex (success)', number: '3782 822463 10005', expiry: '09/26', cvv: '7890', brand: 'AMEX', success: true },
  { label: 'Decline (fail)', number: '4000 0000 0000 0002', expiry: '01/26', cvv: '000', brand: 'VISA', success: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCard(val) {
  return val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}
function formatExpiry(val) {
  const d = val.replace(/\D/g, '').slice(0, 4);
  return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
function cardBrand(num) {
  const n = num.replace(/\s/g, '');
  if (n.startsWith('4')) return 'VISA';
  if (n.startsWith('5')) return 'MC';
  if (n.startsWith('3')) return 'AMEX';
  return null;
}
function maskCard(num) {
  const d = num.replace(/\s/g, '');
  return `•••• •••• •••• ${d.slice(-4) || '••••'}`;
}

// ─── Brand logo ───────────────────────────────────────────────────────────────
function CardBrandBadge({ brand }) {
  if (!brand) return null;
  const colors = { VISA: '#1a1f71', MC: '#eb001b', AMEX: '#007bc1' };
  const labels = { VISA: 'VISA', MC: '⬤⬤', AMEX: 'AMEX' };
  return (
    <span className="card-brand-badge" style={{ background: colors[brand] }}>
      {labels[brand]}
    </span>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export default function PaymentModal({ hold, user, onClose, onSuccess }) {
  const [step, setStep] = useState('form'); // 'form' | 'processing' | 'success' | 'failed'
  const [cardNum, setCardNum] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [name, setName] = useState(user?.username || '');
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Detect which test card was entered (to simulate success/fail)
  const matchedCard = TEST_CARDS.find(c => c.number === cardNum);
  const brand = cardBrand(cardNum);

  // Poll for order confirmation after payment initiated
  useEffect(() => {
    if (step !== 'processing') return;
    let attempts = 0;
    const max = 20; // poll up to 20s

    const id = setInterval(async () => {
      attempts++;
      try {
        const status = await api.getStatus();
        // If purchasedCount went up, payment confirmed
        const prevCount = parseInt(localStorage.getItem('purchasedCount') || '0', 10);
        if (status.purchasedCount > prevCount || !status.hold) {
          clearInterval(id);
          localStorage.setItem('purchasedCount', status.purchasedCount);
          setStep('success');
          setTimeout(() => onSuccess(status), 2200);
        }
      } catch { /* ignore */ }

      if (attempts >= max) {
        clearInterval(id);
        setStep('failed');
        setStatusMsg('Payment timed out. Please contact support.');
      }
    }, 1000);

    return () => clearInterval(id);
  }, [step]);

  function fillTestCard(card) {
    setCardNum(card.number);
    setExpiry(card.expiry);
    setCvv(card.cvv);
    setName(user?.username || 'Test User');
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // Basic validation
    const rawNum = cardNum.replace(/\s/g, '');
    if (rawNum.length < 13) { setError('Enter a valid card number'); return; }
    if (!expiry.match(/^\d{2}\/\d{2}$/)) { setError('Enter expiry as MM/YY'); return; }
    if (cvv.length < 3) { setError('Enter a valid CVV'); return; }

    setStep('processing');
    setStatusMsg('Contacting payment network…');

    try {
      await api.pay();
      // Webhook arrives async — poll for confirmation in useEffect above
      setTimeout(() => setStatusMsg('Verifying transaction…'), 1500);
      setTimeout(() => setStatusMsg('Awaiting bank approval…'), 4000);
    } catch (err) {
      setStep('failed');
      setStatusMsg(err.data?.error || err.message);
    }
  }

  // ── Processing screen ──────────────────────────────────────────────────────
  if (step === 'processing') {
    return (
      <div className="modal-overlay" onClick={e => e.stopPropagation()}>
        <div className="modal-box">
          <div className="pay-processing">
            <div className="pay-spinner-ring" />
            <p className="pay-processing-title">Processing Payment</p>
            <p className="pay-processing-sub">{statusMsg}</p>
            <div className="pay-secure-row">
              <span className="pay-lock">🔒</span>
              <span>256-bit SSL encryption</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="modal-overlay">
        <div className="modal-box">
          <div className="pay-result success">
            <div className="pay-result-icon">✅</div>
            <h3>Payment Confirmed!</h3>
            <p>Your pair is secured. Order ref:</p>
            <code className="pay-ref">{hold?.paymentRef?.slice(0, 18)}…</code>
            <p className="pay-result-sub">A confirmation has been sent to {user?.email}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Failed screen ──────────────────────────────────────────────────────────
  if (step === 'failed') {
    return (
      <div className="modal-overlay">
        <div className="modal-box">
          <div className="pay-result failed">
            <div className="pay-result-icon">❌</div>
            <h3>Payment Failed</h3>
            <p>{statusMsg || 'Your card was declined.'}</p>
            <div className="pay-result-actions">
              <button className="btn primary" onClick={() => setStep('form')}>Try Again</button>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Payment form ───────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="modal-logo">👟</span>
            <div>
              <p className="modal-merchant">Sneakdrop</p>
              <p className="modal-amount">$249.00 USD</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Virtual card preview */}
        <div className={`virtual-card brand-${brand?.toLowerCase() || 'default'}`}>
          <div className="vc-top">
            <span className="vc-chip">▬</span>
            {brand && <CardBrandBadge brand={brand} />}
          </div>
          <div className="vc-number">{cardNum ? maskCard(cardNum) : '•••• •••• •••• ••••'}</div>
          <div className="vc-bottom">
            <div>
              <div className="vc-label">Card Holder</div>
              <div className="vc-value">{name || 'YOUR NAME'}</div>
            </div>
            <div>
              <div className="vc-label">Expires</div>
              <div className="vc-value">{expiry || 'MM/YY'}</div>
            </div>
          </div>
        </div>

        {/* Test card presets */}
        <div className="test-cards-section">
          <p className="test-cards-label">🧪 Test cards</p>
          <div className="test-cards-grid">
            {TEST_CARDS.map(c => (
              <button
                key={c.number}
                className={`test-card-btn ${c.success ? 'success' : 'fail'}`}
                onClick={() => fillTestCard(c)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form className="pay-form" onSubmit={handleSubmit}>
          <div className="field">
            <label>Card Number</label>
            <div className="input-icon-wrap">
              <input
                placeholder="1234 5678 9012 3456"
                value={cardNum}
                onChange={e => setCardNum(formatCard(e.target.value))}
                maxLength={19}
                inputMode="numeric"
                required
              />
              {brand && (
                <span className="input-right-badge">
                  <CardBrandBadge brand={brand} />
                </span>
              )}
            </div>
          </div>

          <div className="pay-form-row">
            <div className="field">
              <label>Expiry</label>
              <input
                placeholder="MM/YY"
                value={expiry}
                onChange={e => setExpiry(formatExpiry(e.target.value))}
                maxLength={5}
                inputMode="numeric"
                required
              />
            </div>
            <div className="field">
              <label>CVV</label>
              <input
                placeholder="•••"
                value={cvv}
                onChange={e => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                type="password"
                required
              />
            </div>
          </div>

          <div className="field">
            <label>Name on Card</label>
            <input
              placeholder="Full name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          {error && <div className="alert error">{error}</div>}

          <button type="submit" className="btn pay full large pay-submit">
            🔒 Pay $249.00
          </button>

          <div className="pay-footer">
            <span>🔒 Secured by</span>
            <span className="pay-powered">SneakPay™</span>
            <span>· PCI DSS Compliant</span>
          </div>
        </form>

        {/* Order summary */}
        <div className="order-summary">
          <div className="order-row">
            <span>Air Limited '25 × 1</span>
            <span>$249.00</span>
          </div>
          <div className="order-row muted">
            <span>Shipping</span>
            <span>Free</span>
          </div>
          <div className="order-row total">
            <span>Total</span>
            <span>$249.00</span>
          </div>
          <div className="order-ref">Ref: {hold?.paymentRef?.slice(0, 18)}…</div>
        </div>

      </div>
    </div>
  );
}
