import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
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
  { label: 'SJVN Admin', email: 'admin@sjvn.in', icon: ShieldCheck, cat: 'STAFF' },
  { label: 'Hydro Admin', email: 'commercial@sjvn.in', icon: ShieldCheck, cat: 'STAFF' },
  { label: 'Hydro Approver', email: 'hydro.hod@sjvn.in', icon: ShieldCheck, cat: 'STAFF' },
  { label: 'Thermal Admin', email: 'thermal@sjvn.in', icon: ShieldCheck, cat: 'STAFF' },
  { label: 'Thermal Desk', email: 'thermal.desk@sjvn.in', icon: ShieldCheck, cat: 'STAFF' },
  { label: 'REIA Ops', email: 'reia@sjvn.in', icon: Zap, cat: 'STAFF' },
  { label: 'REIA Admin', email: 'reia.admin@sjvn.in', icon: ShieldCheck, cat: 'STAFF' },
  { label: 'Trading Ops', email: 'trading@sjvn.in', icon: Briefcase, cat: 'STAFF' },
  { label: 'Finance', email: 'finance@sjvn.in', icon: Briefcase, cat: 'STAFF' },
  { label: 'Management', email: 'management@sjvn.in', icon: Users, cat: 'STAFF' },
  { label: 'Seller', email: 'seller@sunrise-solar.in', icon: User, cat: 'PARTY' },
  { label: 'Buyer (Admin)', email: 'buyer@discom.gov.in', icon: User, cat: 'PARTY' },
  { label: 'Buyer Maker (L1)', email: 'buyer.maker@discom.gov.in', icon: User, cat: 'PARTY' },
  { label: 'Buyer Checker (L2)', email: 'buyer.checker@discom.gov.in', icon: User, cat: 'PARTY' },
  { label: 'Trading Client', email: 'client@abctrading.in', icon: User, cat: 'PARTY' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [demoCategory, setDemoCategory] = useState('ALL');

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

  function fillDemo(demoEmail) {
    setEmail(demoEmail);
    setPassword('password123');
  }

  return (
    <div style={{
      height: '100vh',
      maxHeight: '100vh',
      width: '100vw',
      display: 'flex',
      backgroundColor: '#ffffff',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      {/* Main Container - Full Screen */}
      <div style={{
        display: 'flex',
        flex: 1,
        height: '100%',
        maxHeight: '100vh',
        background: '#ffffff',
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
          padding: '2rem 2.5rem',
          height: '100%',
          maxHeight: '100vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
          background: `
            linear-gradient(
              90deg,
              rgba(4, 31, 75, 0.65),
              rgba(4, 31, 75, 0.2)
            ),
            url("/images/sjvn-hydro-background.png") center / cover no-repeat
          `
        }}>
          {/* Top Logo Section */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <div style={{ background: 'white', padding: '5px 6px', borderRadius: 8, display: 'flex', alignItems: 'center' }}>
              <img src="/sjvn-logo.png" alt="SJVN" style={{ height: 42, width: 'auto' }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.02em', margin: 0, lineHeight: 1.2 }}>SJVN</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.05em', color: '#cbd5e1' }}>A NAVRATNA CPSE</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>MINISTRY OF POWER, GOVERNMENT OF INDIA</div>
            </div>
          </div>

          {/* Middle Content */}
          <div style={{ margin: 'auto 0', padding: '1rem 0', maxWidth: '85%', flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: '#93c5fd', marginBottom: 8 }}>
              CLEAN ENERGY <span style={{ color: '#475569', margin: '0 8px' }}>|</span> BRIGHTER TOMORROW
            </div>
            <h1 style={{ fontSize: 'clamp(28px, 2.5vw, 38px)', fontWeight: 800, lineHeight: 1.15, marginBottom: 10 }}>
              RE Commercial &<br/>
              <span style={{ color: '#3b82f6' }}>Trading</span>
            </h1>
            <h2 style={{ fontSize: 'clamp(16px, 1.2vw, 19px)', fontWeight: 500, color: '#e2e8f0', marginBottom: 14 }}>
              Enterprise Management Platform
            </h2>
            <p style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.5, maxWidth: 440, marginBottom: 20 }}>
              Digitising renewable energy commercial operations for a cleaner, smarter and sustainable tomorrow.
            </p>

            {/* Feature Cards Grid */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              {[
                { icon: Leaf, label: 'Renewable\nGrowth' },
                { icon: BarChart3, label: 'Efficient\nTrading' },
                { icon: Handshake, label: 'Transparent\nOperations' },
                { icon: Globe2, label: 'Sustainable\nFuture' }
              ].map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <div key={i} style={{
                    background: 'rgba(4, 31, 75, 0.45)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(147, 197, 253, 0.3)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                    borderRadius: 12,
                    padding: '10px 8px',
                    width: 88,
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8
                  }}>
                    <Icon size={20} color="#93c5fd" />
                    <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'pre-wrap', lineHeight: 1.25 }}>{feature.label}</div>
                  </div>
                );
              })}
            </div>

            {/* Handwritten script text (simulated with a nice italic serif) */}
            <div style={{ 
              fontFamily: '"Playfair Display", Georgia, serif', 
              fontStyle: 'italic', 
              fontSize: 'clamp(18px, 1.5vw, 22px)', 
              color: '#e2e8f0',
              transform: 'rotate(-2deg)',
              display: 'inline-block',
              marginLeft: '8%'
            }}>
              Harnessing Himalayan Energy<br/>
              <span style={{ borderBottom: '3px solid #3b82f6' }}>For A Greener India</span>
            </div>
          </div>

          {/* Bottom Stats Bar */}
          <div style={{ 
            marginTop: 'auto', 
            background: 'rgba(15, 23, 42, 0.65)', 
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 14,
            padding: '12px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            boxSizing: 'border-box',
            flexShrink: 0
          }}>
            {[
              { icon: Zap, val: '2,000+ MW', sub: 'Installed Capacity' },
              { icon: Leaf, val: 'Leading', sub: 'Renewable Portfolio' },
              { icon: Users, val: 'Nation Building', sub: 'Through Clean Energy' },
              { icon: Globe2, val: 'Sustainable', sub: 'For Generations' },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon size={18} color="#93c5fd" />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'white', lineHeight: 1.2 }}>{stat.val}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.2 }}>{stat.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>


        {/* RIGHT PANE - Login Form */}
        <div style={{
          flex: '0.85',
          padding: '1.75rem 2.5rem',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          height: '100%',
          maxHeight: '100vh',
          overflowY: 'auto',
          boxSizing: 'border-box'
        }}>
          {/* Top Right subtle watermark text */}
          <div style={{ position: 'absolute', top: 18, right: 24, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', lineHeight: 1.3 }}>
              ENERGY<br/>FOR A BRIGHTER<br/>TOMORROW
            </div>
            <div style={{ width: 24, height: 2, background: '#3b82f6', marginTop: 4 }}></div>
          </div>

          {/* Bottom Right Mountain & Tower SVG Watermark */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            pointerEvents: 'none',
            zIndex: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            overflow: 'hidden'
          }}>
            <img 
              src="/images/watermark.png" 
              alt="Watermark" 
              style={{
                width: '100%',
                height: 'auto',
                opacity: 0.6,
                WebkitMaskImage: 'linear-gradient(to top, black 70%, transparent 100%)',
                maskImage: 'linear-gradient(to top, black 70%, transparent 100%)'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16, marginTop: '0.25rem', position: 'relative', zIndex: 1, flexShrink: 0 }}>
            <div style={{ marginBottom: 8 }}>
              <img src="/sjvn-logo.png" alt="SJVN" style={{ height: 46, width: 'auto' }} />
            </div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', textAlign: 'center' }}>
              RE Commercial & Trading
            </h2>
            <div style={{ color: '#64748b', fontSize: 13, fontWeight: 500, marginTop: 2 }}>
              Enterprise Management Platform
            </div>
          </div>

          {error && (
            <div className="animate-fade-in-up" style={{ marginBottom: 16, padding: 10, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ fontWeight: 500 }}>{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ maxWidth: 410, margin: '0 auto', width: '100%', position: 'relative', zIndex: 1, flexShrink: 0 }}>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Work Email</label>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                  <Mail size={16} strokeWidth={2.5} />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@sjvn.in"
                  style={{
                    width: '100%',
                    padding: '9px 14px 9px 38px',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 9,
                    color: '#0f172a',
                    fontSize: 13.5,
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'all 0.2s',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#3b82f6';
                    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#cbd5e1';
                    e.target.style.boxShadow = 'none';
                  }}
                  autoFocus
                />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>Password</label>
                <a href="#" onClick={(e) => { e.preventDefault(); setShowForgotModal(true); }} style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>Forgot Password?</a>
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
                    padding: '9px 38px 9px 38px',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 9,
                    color: '#0f172a',
                    fontSize: 13.5,
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'all 0.2s',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#3b82f6';
                    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#cbd5e1';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', 
                    color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px',
                background: '#041F4B',
                color: 'white',
                border: 'none',
                borderRadius: 9,
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s',
                opacity: loading ? 0.8 : 1
              }}
              onMouseOver={(e) => { if(!loading) e.currentTarget.style.background = '#020f26'; }}
              onMouseOut={(e) => { if(!loading) e.currentTarget.style.background = '#041F4B'; }}
            >
              {loading ? 'Authenticating...' : <>Sign In <ArrowRight size={15} /></>}
            </button>
          </form>

          <div style={{ maxWidth: 410, margin: '0 auto', width: '100%', marginTop: 10, position: 'relative', zIndex: 1, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0' }}>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}></div>
              <div style={{ padding: '0 10px', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>OR</div>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', letterSpacing: '0.03em' }}>
                Quick Demo Login
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  { id: 'ALL', label: 'All (15)' },
                  { id: 'STAFF', label: 'SJVN (10)' },
                  { id: 'PARTY', label: 'Counterparty (5)' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setDemoCategory(cat.id)}
                    style={{
                      background: demoCategory === cat.id ? '#041F4B' : '#f1f5f9',
                      color: demoCategory === cat.id ? '#ffffff' : '#475569',
                      border: 'none',
                      borderRadius: 4,
                      padding: '2px 7px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {filteredDemoAccounts.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => fillDemo(a.email)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      color: '#334155',
                      padding: '5px 8px',
                      borderRadius: 7,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s ease',
                      boxSizing: 'border-box'
                    }}
                    onMouseOver={(e) => { 
                      e.currentTarget.style.borderColor = '#94a3b8'; 
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)';
                    }}
                    onMouseOut={(e) => { 
                      e.currentTarget.style.borderColor = '#e2e8f0'; 
                      e.currentTarget.style.background = '#ffffff';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Icon size={12} color="#3b82f6" strokeWidth={2.5} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
                    </div>
                    <ChevronRight size={12} color="#cbd5e1" style={{ flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      </div>
      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="animate-fade-in-up" style={{
            background: 'white', padding: '32px', borderRadius: '16px',
            maxWidth: '400px', width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#0f172a', fontSize: 20 }}>Reset Password</h3>
            <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
              To reset your password, please enter your registered work email address. We will send you a secure reset link.
            </p>
            <input 
              type="email" 
              placeholder="you@sjvn.in" 
              style={{
                width: '100%', padding: '12px 16px', border: '1px solid #cbd5e1', 
                borderRadius: '8px', marginBottom: '24px', fontSize: 14, outline: 'none'
              }}
              onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)'; }}
              onBlur={(e) => { e.target.style.borderColor = '#cbd5e1'; e.target.style.boxShadow = 'none'; }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button 
                type="button"
                onClick={() => setShowForgotModal(false)}
                style={{
                  padding: '10px 16px', background: 'transparent', border: 'none',
                  color: '#475569', fontWeight: 600, cursor: 'pointer', borderRadius: '8px'
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
