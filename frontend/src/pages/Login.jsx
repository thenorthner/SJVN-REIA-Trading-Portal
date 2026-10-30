import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import GovStrip from '../gigw/GovStrip.jsx';
import GigwFooter from '../gigw/GigwFooter.jsx';
import { isSellerRole, isBuyerRole, isTradingClientRole } from '../roles.js';
import { pageOpen, firstOpenPage } from '../lib/rolePages.js';
import { 
  Mail, Lock, ArrowRight, ShieldCheck, ChevronRight, Leaf, BarChart3, Handshake, 
  Globe2, CheckCircle2, Eye, EyeOff, Zap
} from 'lucide-react';
import SjvnBotMascot from '../components/SjvnBotMascot.jsx';
import { showAlert } from '../lib/dialogs.js';
import {
  REIA_BETA, REIA_BETA_HOME, REIA_BETA_TITLE, inReiaBeta, betaLanding, BETA_DEMO_ACCOUNTS, BETA_DEMO_PASSWORD,
} from '../reiaBeta.js';

// Where signing in lands; a page the role's powers no longer reach gives way
// to the first page the role can still open (lib/rolePages.js).
export function landingFor(user, from) {
  const target = deskLanding(user, from);
  if (pageOpen(user, target.split('?')[0])) return target;
  return firstOpenPage(user, REIA_BETA ? inReiaBeta : undefined) || target;
}

function deskLanding(user, from) {
  const path = from?.pathname || '';
  // The beta opens REIA screens only: anywhere else starts on the REIA landing.
  if (REIA_BETA && !inReiaBeta(path || '/')) return betaLanding(user?.role);
  if (!path || path === '/' || path.startsWith('/login')) {
    const role = user?.role || '';
    if (['COMMERCIAL_ADMIN', 'COMMERCIAL'].includes(role)) return '/hydro-thermal';
    if (['THERMAL_ADMIN', 'THERMAL_USER'].includes(role)) return '/thermal';
    return '/';
  }
  const target = `${path}${from.search || ''}`;
  if (['/mail', '/notification-board', '/settings'].some((p) => path.startsWith(p))) return target;
  const role = user?.role || '';
  if (['COMMERCIAL_ADMIN', 'COMMERCIAL'].includes(role)) return path.startsWith('/hydro-thermal') ? target : '/hydro-thermal';
  if (['THERMAL_ADMIN', 'THERMAL_USER'].includes(role)) return path.startsWith('/thermal') ? target : '/thermal';
  if (isSellerRole(role)) return path.startsWith('/seller') ? target : '/';
  if (isBuyerRole(role)) return path.startsWith('/buyer') ? target : '/';
  if (isTradingClientRole(role)) return path.startsWith('/trading') ? target : '/';
  if (path.startsWith('/seller') || path.startsWith('/buyer')) return role === 'SJVN_ADMIN' ? target : '/';
  return target;
}

export default function Login() {
  const { login } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const reiaOnly = REIA_BETA || searchParams.get('desk')?.toUpperCase() === 'REIA';
  const initialDesk = reiaOnly ? 'REIA' : searchParams.get('desk')?.toUpperCase();

  useEffect(() => {
    if (!reiaOnly) return undefined;
    const prev = document.title;
    document.title = REIA_BETA_TITLE;
    return () => { document.title = prev; };
  }, [reiaOnly]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [inputFocus, setInputFocus] = useState(null); // 'email' | 'password' | null

  const from = location.state?.from || null;

  // Beta only: sign straight in as one of the test accounts.
  async function demoSignIn(demoEmail) {
    if (!demoEmail || loading) return;
    setEmail(demoEmail);
    setPassword(BETA_DEMO_PASSWORD);
    setError('');
    setLoading(true);
    try {
      const signedIn = await login(demoEmail, BETA_DEMO_PASSWORD);
      navigate(landingFor(signedIn, from), { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const signedIn = await login(email, password);
      navigate(landingFor(signedIn, from), { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container-root" style={{
      height: '100vh',
      maxHeight: '100vh',
      width: '100vw',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: isDark ? '#000000' : 'var(--surface)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      <GovStrip withSkip />
      {/* Main Container - Full Screen */}
      <main id="main-content" className="login-main" tabIndex={-1} style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        background: isDark ? '#000000' : 'var(--surface)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        
        {/* LEFT PANE - Image & Branding */}
        <div className="login-left-pane" style={{
          flex: '1.15',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          color: 'white',
          padding: '2.5rem 3rem',
          height: '100%',
          maxHeight: '100vh',
          boxSizing: 'border-box',
          // The REIA-only sign-in drops the dam photograph: it is not REIA.
          background: reiaOnly
            ? 'radial-gradient(circle at 85% 20%, rgba(250, 204, 21, 0.28) 0%, rgba(250, 204, 21, 0) 40%), linear-gradient(120deg, #041f4b 0%, #0b3a7a 60%, #0e6b5c 100%)'
            : `
            linear-gradient(
              135deg,
              rgba(4, 31, 75, 0.78) 0%,
              rgba(4, 31, 75, 0.45) 100%
            ),
            url("/images/sjvn-hydro-background.png") center / cover no-repeat
          `
        }}>
          {/* Top Logo Section */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: 10, display: 'flex', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              <img src="/sjvn-logo.png" alt="SJVN Limited" style={{ height: 56, width: 'auto' }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.02em', margin: 0, lineHeight: 1.2 }}>SJVN Limited</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '0.06em', color: '#cbd5e1' }}>A NAVRATNA CPSE</div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', letterSpacing: '0.02em' }}>MINISTRY OF POWER, GOVERNMENT OF INDIA</div>
            </div>
          </div>

          {/* Middle Content */}
          <div className="login-left-pitch" style={{ margin: 'auto 0', maxWidth: 480 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              borderRadius: 20,
              background: 'rgba(16, 185, 129, 0.18)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#a7f3d0',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.04em',
              marginBottom: 16,
              backdropFilter: 'blur(8px)',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
              {reiaOnly ? 'REIA COMMERCIAL PORTAL' : 'ENTERPRISE COMMERCIAL CONSOLE'}
            </div>

            <h1 style={{ fontSize: 'clamp(28px, 2.8vw, 38px)', fontWeight: 800, lineHeight: 1.2, marginBottom: 14, color: '#ffffff' }}>
              {reiaOnly ? 'Renewable Energy Implementing Agency Portal' : <>Integrated Energy Commercial &amp; Trading Platform</>}
            </h1>

            <p style={{ fontSize: 16, color: '#e2e8f0', lineHeight: 1.5, margin: 0 }}>
              {reiaOnly
                ? 'SJVN\'s single window for renewable power bought from generators and sold to discoms: contracts, energy accounts, bills, payments, disputes and reconciliation.'
                : 'Unified sovereign gateway for Renewable Energy procurement (REIA), Power Market trading on synchronized exchanges (IEX, PXIL, HPX), and Hydro-Thermal generation billing.'}
            </p>
          </div>

          {/* Bottom Trust Seal */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13.5,
            color: '#cbd5e1',
            padding: '10px 16px',
            background: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 8,
            width: 'fit-content'
          }}>
            <ShieldCheck size={16} color="#10b981" />
            <span>Restricted Computer System · Authorized Enterprise Access Only · IT Act, 2000</span>
          </div>
        </div>

        {/* RIGHT PANE - Login Form */}
        <div className="login-right-pane" style={{
          flex: '0.85',
          padding: '2.5rem 3rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          position: 'relative',
          height: '100%',
          maxHeight: '100vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
          backgroundColor: isDark ? '#000000' : 'var(--surface)',
          color: isDark ? '#f8fafc' : 'var(--slate-900)',
          transition: 'background-color 0.25s ease, color 0.25s ease'
        }}>
          {/* Top Bar with Home Link & Theme Toggle */}
          <div className="login-topbar" style={{
            position: 'absolute',
            top: 20,
            left: 28,
            right: 28,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 10
          }}>
            <Link to={reiaOnly && !REIA_BETA ? REIA_BETA_HOME : '/'} style={{ fontSize: 14.5, color: 'var(--primary)', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              ← Return to Portal Home
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {initialDesk && (
                <span style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}>
                  {initialDesk === 'REIA' ? '☀️ REIA Portal' : initialDesk === 'TRADING' ? '⚡ Power Trading' : initialDesk === 'HYDRO' ? '🌊 Hydro Commercial' : '🔥 Thermal Desk'}
                </span>
              )}
              <ThemeToggle variant="login" />
            </div>
          </div>

          <div style={{ maxWidth: 400, margin: '0 auto', width: '100%', position: 'relative', zIndex: 1 }}>
            {/* Form Header with Interactive SJVN Urja Mascot Bot */}
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <SjvnBotMascot
                inputFocus={inputFocus}
                showPassword={showPassword}
                textLength={email.length}
                isError={Boolean(error)}
                isLoading={loading}
                size={135}
              />
              <h2 style={{ margin: '8px 0 4px', fontSize: 21, fontWeight: 800, color: isDark ? '#ffffff' : 'var(--slate-900)', letterSpacing: '-0.02em' }}>
                {initialDesk === 'REIA' ? 'REIA Commercial Portal' : initialDesk === 'TRADING' ? 'Power Trading Desk' : initialDesk === 'HYDRO' ? 'Hydro Commercial Desk' : initialDesk === 'THERMAL' ? 'Thermal Operations Desk' : 'Sign In to Your Account'}
              </h2>
              <p style={{ color: isDark ? '#94a3b8' : 'var(--slate-500)', fontSize: 14.5, margin: 0 }}>
                Enter your official enterprise credentials to continue
              </p>
            </div>

            {location.state?.notice && !error && (
              <div role="status" style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--amber-bg)', border: '1px solid var(--amber)', color: 'var(--text)', borderRadius: 8, fontSize: 14.5 }}>
                {location.state.notice}
              </div>
            )}
            {error && (
              <div role="alert" style={{ marginBottom: 16, padding: '10px 14px', backgroundColor: 'var(--t-red-50)', border: '1px solid var(--t-red-line)', color: 'var(--red-deep)', borderRadius: 8, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 500 }}>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="login-email" style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: isDark ? '#cbd5e1' : 'var(--slate-700)', marginBottom: 6 }}>Work Email</label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                    <Mail size={16} strokeWidth={2.5} />
                  </div>
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@sjvn.in"
                    style={{
                      width: '100%',
                      padding: '10px 14px 10px 40px',
                      background: isDark ? '#07080b' : 'var(--surface)',
                      border: isDark ? '1px solid #1e2430' : '1px solid var(--slate-300)',
                      borderRadius: 8,
                      color: isDark ? '#f8fafc' : 'var(--slate-900)',
                      fontSize: 15.5,
                      outline: 'none',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s',
                    }}
                    onFocus={(e) => {
                      setInputFocus('email');
                      e.target.style.borderColor = '#3b82f6';
                      e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)';
                    }}
                    onBlur={(e) => {
                      setInputFocus((prev) => (prev === 'email' ? null : prev));
                      e.target.style.borderColor = isDark ? '#1e2430' : '#cbd5e1';
                      e.target.style.boxShadow = 'none';
                    }}
                    autoFocus
                  />
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <label htmlFor="login-password" style={{ fontSize: 14.5, fontWeight: 700, color: isDark ? '#cbd5e1' : 'var(--slate-700)' }}>Password</label>
                  <a href="#" onClick={(e) => { e.preventDefault(); setShowForgotModal(true); }} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--on-blue)', textDecoration: 'none' }}>Forgot Password?</a>
                </div>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                    <Lock size={16} strokeWidth={2.5} />
                  </div>
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{
                      width: '100%',
                      padding: '10px 40px 10px 40px',
                      background: isDark ? '#07080b' : 'var(--surface)',
                      border: isDark ? '1px solid #1e2430' : '1px solid var(--slate-300)',
                      borderRadius: 8,
                      color: isDark ? '#f8fafc' : 'var(--slate-900)',
                      fontSize: 15.5,
                      outline: 'none',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s',
                    }}
                    onFocus={(e) => {
                      setInputFocus('password');
                      e.target.style.borderColor = '#3b82f6';
                      e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)';
                    }}
                    onBlur={(e) => {
                      setInputFocus((prev) => (prev === 'password' ? null : prev));
                      e.target.style.borderColor = isDark ? '#1e2430' : '#cbd5e1';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setShowPassword((prev) => !prev);
                      setInputFocus('password');
                    }}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', 
                      color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0
                    }}
                  >
                    {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  height: 44,
                  background: isDark ? '#2563eb' : '#041F4B',
                  color: 'white',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 15.5,
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 2px 8px rgba(4, 31, 75, 0.25)',
                  transition: 'all 0.2s',
                  opacity: loading ? 0.8 : 1
                }}
                onMouseOver={(e) => { if(!loading) e.currentTarget.style.background = isDark ? '#1d4ed8' : '#020f26'; }}
                onMouseOut={(e) => { if(!loading) e.currentTarget.style.background = isDark ? '#2563eb' : '#041F4B'; }}
              >
                {loading ? 'Authenticating...' : <>Sign In <ArrowRight size={16} /></>}
              </button>
            </form>

            {REIA_BETA && (
              <div style={{ marginTop: 22, paddingTop: 18, borderTop: isDark ? '1px solid #1e2430' : '1px solid var(--slate-200)' }}>
                <label htmlFor="quick-demo-select" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 700, color: isDark ? '#cbd5e1' : 'var(--slate-700)', marginBottom: 6 }}>
                  <Zap size={16} aria-hidden="true" style={{ color: isDark ? '#7dd3fc' : '#0369a1' }} />
                  Quick Demo Login
                </label>
                <select
                  id="quick-demo-select"
                  value=""
                  disabled={loading}
                  onChange={(e) => demoSignIn(e.target.value)}
                  aria-describedby="quick-demo-help"
                  style={{
                    width: '100%',
                    height: 'auto',
                    minHeight: 46,
                    lineHeight: 1.4,
                    padding: '11px 12px',
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 500,
                    background: isDark ? '#07080b' : 'var(--surface)',
                    border: isDark ? '1px solid #1e2430' : '1px solid var(--slate-300)',
                    color: isDark ? '#f8fafc' : 'var(--slate-900)',
                    cursor: loading ? 'wait' : 'pointer',
                  }}
                >
                  <option value="" disabled>Choose a test account to sign in…</option>
                  {BETA_DEMO_ACCOUNTS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.accounts.map((a) => (
                        <option key={a.email} value={a.email}>{a.label} · {a.note}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p id="quick-demo-help" style={{ margin: '6px 0 0', fontSize: 13.5, color: isDark ? '#94a3b8' : 'var(--slate-500)' }}>
                  Signs in at once as the chosen role. Beta test accounts only.
                </p>
              </div>
            )}
          </div>
        </div>

      </main>
      <GigwFooter compact />
      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(6px)',
          zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="animate-fade-in-up" style={{
            background: isDark ? '#090a0d' : 'var(--surface)', 
            border: isDark ? '1px solid #1e2430' : 'none',
            padding: '32px', borderRadius: '16px',
            maxWidth: '400px', width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: isDark ? '#f8fafc' : 'var(--slate-900)', fontSize: 20 }}>Reset Password</h3>
            <p style={{ color: isDark ? '#94a3b8' : 'var(--slate-600)', fontSize: 15.5, lineHeight: 1.5, marginBottom: 24 }}>
              To reset your password, please enter your registered work email address. We will send you a secure reset link.
            </p>
            <input 
              type="email" 
              placeholder="you@sjvn.in" 
              style={{
                width: '100%', padding: '12px 16px', 
                background: isDark ? '#000000' : 'var(--surface)',
                border: isDark ? '1px solid #222834' : '1px solid var(--slate-300)', 
                color: isDark ? '#f8fafc' : 'var(--slate-900)',
                borderRadius: '8px', marginBottom: '24px', fontSize: 15.5, outline: 'none'
              }}
              onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)'; }}
              onBlur={(e) => { e.target.style.borderColor = isDark ? '#222834' : '#cbd5e1'; e.target.style.boxShadow = 'none'; }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button 
                type="button"
                onClick={() => setShowForgotModal(false)}
                style={{
                  padding: '10px 16px', background: 'transparent', border: 'none',
                  color: isDark ? '#94a3b8' : 'var(--slate-600)', fontWeight: 600, cursor: 'pointer', borderRadius: '8px'
                }}
              >Cancel</button>
              <button 
                type="button"
                onClick={() => {
                  showAlert('Password reset link has been sent to your email! (Demo Mode)');
                  setShowForgotModal(false);
                }}
                style={{
                  padding: '10px 16px', background: '#2563eb', border: 'none',
                  color: 'white', fontWeight: 600, cursor: 'pointer', borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
                }}
              >Send Reset Link</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
