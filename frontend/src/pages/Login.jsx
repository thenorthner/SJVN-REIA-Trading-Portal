import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import GovStrip from '../gigw/GovStrip.jsx';
import GigwFooter from '../gigw/GigwFooter.jsx';
import { isSellerRole, isBuyerRole, isTradingClientRole } from '../roles.js';
import { 
  Mail, Lock, ArrowRight, ShieldCheck, Zap, Briefcase, 
  Users, User, ChevronRight, Leaf, BarChart3, Handshake, 
  Globe2, CheckCircle2, Eye, EyeOff
} from 'lucide-react';

export function landingFor(user, from) {
  const path = from?.pathname || '';
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

const DEMO_ACCOUNTS = [
  // REIA Core Workflow (Priority 1 for Sir's Walkthrough)
  // Target #2: maker prepares, checker scrutinises, approver (HOD) sanctions.
  { label: 'REIA Maker', roleDesc: 'Prepares bills & data', email: 'reia@sjvn.in', icon: Zap, cat: 'REIA' },
  { label: 'REIA Checker', roleDesc: 'Scrutiny · Level 1', email: 'reia.admin@sjvn.in', icon: ShieldCheck, cat: 'REIA' },
  { label: 'REIA Approver', roleDesc: 'HOD · Level 3', email: 'reia.approver@sjvn.in', icon: ShieldCheck, cat: 'REIA' },
  { label: 'Finance', roleDesc: 'Settlement & JVs', email: 'finance@sjvn.in', icon: Briefcase, cat: 'REIA' },
  { label: 'Management', roleDesc: 'L3 Approver', email: 'management@sjvn.in', icon: Users, cat: 'REIA' },
  { label: 'Seller (Sunrise)', roleDesc: 'RE Generator', email: 'seller@sunrise-solar.in', icon: User, cat: 'REIA' },
  { label: 'Buyer (PSPCL)', roleDesc: 'State Discom', email: 'buyer@discom.gov.in', icon: User, cat: 'REIA' },
  { label: 'Buyer Maker (L1)', roleDesc: 'Discom Maker', email: 'buyer.maker@discom.gov.in', icon: User, cat: 'REIA' },
  { label: 'Buyer Checker (L2)', roleDesc: 'Discom Checker', email: 'buyer.checker@discom.gov.in', icon: User, cat: 'REIA' },
  { label: 'SJVN Admin', roleDesc: 'Governance · read-only desks', email: 'admin@sjvn.in', icon: ShieldCheck, cat: 'REIA' },

  // Trading Hub
  { label: 'Trading Ops', roleDesc: 'IEX/PXIL Trader', email: 'trading@sjvn.in', icon: Briefcase, cat: 'TRADING' },
  { label: 'Trading Client', roleDesc: 'OA Client', email: 'client@abctrading.in', icon: User, cat: 'TRADING' },

  // Hydro Vertical
  { label: 'Hydro Admin', roleDesc: 'Hydro Vertical', email: 'commercial@sjvn.in', icon: ShieldCheck, cat: 'HYDRO' },
  { label: 'Hydro Approver', roleDesc: 'Hydro HOD', email: 'hydro.hod@sjvn.in', icon: ShieldCheck, cat: 'HYDRO' },

  // Thermal Vertical
  { label: 'Thermal Admin', roleDesc: 'Thermal Vertical', email: 'thermal@sjvn.in', icon: ShieldCheck, cat: 'THERMAL' },
  { label: 'Thermal Desk', roleDesc: 'Thermal Desk', email: 'thermal.desk@sjvn.in', icon: ShieldCheck, cat: 'THERMAL' },
];

export default function Login() {
  const { login } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const initialDesk = searchParams.get('desk')?.toUpperCase();
  const validDesks = ['REIA', 'TRADING', 'HYDRO', 'THERMAL', 'ALL'];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loggingInRole, setLoggingInRole] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [demoCategory, setDemoCategory] = useState(validDesks.includes(initialDesk) ? initialDesk : 'REIA');

  const filteredDemoAccounts = demoCategory === 'ALL'
    ? DEMO_ACCOUNTS
    : DEMO_ACCOUNTS.filter((a) => a.cat === demoCategory);

  const from = location.state?.from || null;

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

  async function handleInstantDemoLogin(demoEmail, label) {
    setEmail(demoEmail);
    setPassword('password123');
    setLoggingInRole(label);
    setError('');
    setLoading(true);
    try {
      const signedIn = await login(demoEmail, 'password123');
      navigate(landingFor(signedIn, from), { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
      setLoading(false);
      setLoggingInRole(null);
    }
  }

  function fillDemo(demoEmail) {
    setEmail(demoEmail);
    setPassword('password123');
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
      <main id="main-content" tabIndex={-1} style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        background: isDark ? '#000000' : 'var(--surface)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        
        {/* LEFT PANE - Image & Branding */}
        <div style={{
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
          background: `
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
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: '#cbd5e1' }}>A NAVRATNA CPSE</div>
              <div style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.02em' }}>MINISTRY OF POWER, GOVERNMENT OF INDIA</div>
            </div>
          </div>

          {/* Middle Content */}
          <div style={{ margin: 'auto 0', maxWidth: 480 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              borderRadius: 20,
              background: 'rgba(16, 185, 129, 0.18)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#a7f3d0',
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.04em',
              marginBottom: 16,
              backdropFilter: 'blur(8px)',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
              ENTERPRISE COMMERCIAL CONSOLE
            </div>

            <h1 style={{ fontSize: 'clamp(28px, 2.8vw, 38px)', fontWeight: 800, lineHeight: 1.2, marginBottom: 14, color: '#ffffff' }}>
              Integrated Energy Commercial &amp; Trading Platform
            </h1>

            <p style={{ fontSize: 15, color: '#e2e8f0', lineHeight: 1.6, margin: 0 }}>
              Unified sovereign gateway for Renewable Energy procurement (REIA), Power Market trading on synchronized exchanges (IEX, PXIL, HPX), and Hydro-Thermal generation billing.
            </p>
          </div>

          {/* Bottom Trust Seal */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 12,
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
          <div style={{
            position: 'absolute',
            top: 20,
            left: 28,
            right: 28,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 10
          }}>
            <Link to="/" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              ← Return to Portal Home
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {initialDesk && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}>
                  {initialDesk === 'REIA' ? '☀️ REIA Portal' : initialDesk === 'TRADING' ? '⚡ Power Trading' : initialDesk === 'HYDRO' ? '🌊 Hydro Commercial' : '🔥 Thermal Desk'}
                </span>
              )}
              <ThemeToggle variant="login" />
            </div>
          </div>

          <div style={{ maxWidth: 400, margin: '0 auto', width: '100%', position: 'relative', zIndex: 1 }}>
            {/* Form Header */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ display: 'inline-flex', padding: '10px 14px', background: '#ffffff', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', marginBottom: 14 }}>
                <img src="/sjvn-logo.png" alt="SJVN Limited" style={{ height: 76, width: 'auto' }} />
              </div>
              <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: isDark ? '#ffffff' : 'var(--slate-900)', letterSpacing: '-0.02em' }}>
                {initialDesk === 'REIA' ? 'REIA Commercial Portal' : initialDesk === 'TRADING' ? 'Power Trading Desk' : initialDesk === 'HYDRO' ? 'Hydro Commercial Desk' : initialDesk === 'THERMAL' ? 'Thermal Operations Desk' : 'Sign In to Your Account'}
              </h2>
              <p style={{ color: isDark ? '#94a3b8' : 'var(--slate-500)', fontSize: 13.5, margin: 0 }}>
                Enter your official enterprise credentials to continue
              </p>
            </div>

            {location.state?.notice && !error && (
              <div role="status" style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--amber-bg)', border: '1px solid var(--amber)', color: 'var(--text)', borderRadius: 8, fontSize: 13 }}>
                {location.state.notice}
              </div>
            )}
            {error && (
              <div role="alert" style={{ marginBottom: 16, padding: '10px 14px', backgroundColor: 'var(--t-red-50)', border: '1px solid var(--t-red-line)', color: 'var(--red-deep)', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 500 }}>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: isDark ? '#cbd5e1' : 'var(--slate-700)', marginBottom: 6 }}>Work Email</label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                    <Mail size={16} strokeWidth={2.5} />
                  </div>
                  <input
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
                      fontSize: 14,
                      outline: 'none',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#3b82f6';
                      e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = isDark ? '#1e2430' : '#cbd5e1';
                      e.target.style.boxShadow = 'none';
                    }}
                    autoFocus
                  />
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: isDark ? '#cbd5e1' : 'var(--slate-700)' }}>Password</label>
                  <a href="#" onClick={(e) => { e.preventDefault(); setShowForgotModal(true); }} style={{ fontSize: 12, fontWeight: 600, color: 'var(--on-blue)', textDecoration: 'none' }}>Forgot Password?</a>
                </div>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                    <Lock size={16} strokeWidth={2.5} />
                  </div>
                  <input
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
                      fontSize: 14,
                      outline: 'none',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#3b82f6';
                      e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = isDark ? '#1e2430' : '#cbd5e1';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
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
                  fontSize: 14.5,
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

            {/* Discreet Demo Persona Quick Fill Selector */}
            <div style={{ marginTop: 22, paddingTop: 16, borderTop: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <label htmlFor="quick-demo-select" style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#94a3b8' : '#64748b' }}>
                  ⚡ Quick Demo Login:
                </label>
                <select
                  id="quick-demo-select"
                  onChange={(e) => {
                    if (e.target.value) {
                      handleInstantDemoLogin(e.target.value, e.target.options[e.target.selectedIndex].text);
                    }
                  }}
                  defaultValue=""
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    background: isDark ? '#0f172a' : '#f8fafc',
                    border: isDark ? '1px solid #334155' : '1px solid #cbd5e1',
                    color: isDark ? '#f1f5f9' : '#0f172a',
                    cursor: 'pointer',
                    outline: 'none',
                    maxWidth: 240
                  }}
                >
                  <option value="" disabled>Select test persona...</option>
                  <optgroup label="REIA Commercial Core">
                    <option value="reia@sjvn.in">REIA Maker</option>
                    <option value="reia.admin@sjvn.in">REIA Checker</option>
                    <option value="reia.approver@sjvn.in">REIA Approver (HOD)</option>
                    <option value="finance@sjvn.in">Finance Desk (Settlement)</option>
                    <option value="seller@sunrise-solar.in">Seller (Sunrise Solar)</option>
                    <option value="buyer@discom.gov.in">Buyer (State Discom)</option>
                  </optgroup>
                  <optgroup label="Power Trading Hub">
                    <option value="trading@sjvn.in">Trading Ops (Trader)</option>
                    <option value="client@abctrading.in">Trading Client (Open Access)</option>
                  </optgroup>
                  <optgroup label="Hydro & Thermal Desks">
                    <option value="commercial@sjvn.in">Hydro Commercial Admin</option>
                    <option value="hydro.hod@sjvn.in">Hydro HOD Approver</option>
                    <option value="thermal@sjvn.in">Thermal Station Admin</option>
                    <option value="admin@sjvn.in">Platform Super Admin</option>
                  </optgroup>
                </select>
              </div>
            </div>
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
            <p style={{ color: isDark ? '#94a3b8' : 'var(--slate-600)', fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
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
                borderRadius: '8px', marginBottom: '24px', fontSize: 14, outline: 'none'
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
                  alert('Password reset link has been sent to your email! (Demo Mode)');
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
