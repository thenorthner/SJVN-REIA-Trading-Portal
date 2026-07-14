import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const DEMO_ACCOUNTS = [
  { label: 'SJVN Admin', email: 'admin@sjvn.in' },
  { label: 'REIA Ops', email: 'reia@sjvn.in' },
  { label: 'Trading Ops', email: 'trading@sjvn.in' },
  { label: 'Finance', email: 'finance@sjvn.in' },
  { label: 'Management', email: 'management@sjvn.in' },
  { label: 'Seller', email: 'seller@sunrise-solar.in' },
  { label: 'Buyer', email: 'buyer@discom.gov.in' },
  { label: 'Trading Client', email: 'client@abctrading.in' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = location.state?.from?.pathname || '/';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(demoEmail) {
    setEmail(demoEmail);
    setPassword('password123');
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">SJVN</div>
          <div className="brand-text" style={{ color: '#1c2536' }}>
            <strong style={{ color: '#1c2536' }}>RE Commercial &amp; Trading</strong>
            <span style={{ color: '#667085' }}>Platform</span>
          </div>
        </div>
        <h1 className="login-title">Sign in to your account</h1>
        <p className="login-subtitle">
          Integrated Renewable Energy Commercial, Billing, Settlement &amp; Power Trading Management Platform
        </p>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@sjvn.in"
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password123"
            />
          </label>
          <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="login-demo">
          <div className="login-demo-title">Quick demo login (password: password123)</div>
          <div className="demo-role-grid">
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" className="demo-role-btn" onClick={() => fillDemo(a.email)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
