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
    return '/';
  }
  const target = `${path}${from.search || ''}`;
  if (['/mail', '/notification-board', '/settings'].some((p) => path.startsWith(p))) return target;
  const role = user?.role || '';
  if (['COMMERCIAL_ADMIN', 'COMMERCIAL'].includes(role)) return path.startsWith('/hydro-thermal') ? target : '/hydro-thermal';
  if (isSellerRole(role)) return path.startsWith('/seller') ? target : '/';
  if (isBuyerRole(role)) return path.startsWith('/buyer') ? target : '/';
  if (isTradingClientRole(role)) return path.startsWith('/trading') ? target : '/';
  if (path.startsWith('/seller') || path.startsWith('/buyer')) return role === 'SJVN_ADMIN' ? target : '/';
  return target;
}

const DEMO_ACCOUNTS = [
  { label: 'SJVN Admin', email: 'admin@sjvn.in', icon: ShieldCheck },
  { label: 'Commercial Admin', email: 'commercial@sjvn.in', icon: ShieldCheck },
  { label: 'REIA Ops', email: 'reia@sjvn.in', icon: Zap },
  { label: 'REIA Admin', email: 'reia.admin@sjvn.in', icon: ShieldCheck },
  { label: 'Trading Ops', email: 'trading@sjvn.in', icon: Briefcase },
  { label: 'Finance', email: 'finance@sjvn.in', icon: Briefcase },
  { label: 'Management', email: 'management@sjvn.in', icon: Users },
  { label: 'Seller', email: 'seller@sunrise-solar.in', icon: User },
  { label: 'Buyer', email: 'buyer@discom.gov.in', icon: User },
  { label: 'Trading Client', email: 'client@abctrading.in', icon: User },
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
      minHeight: '100vh',
      display: 'flex',
      backgroundColor: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      {/* Main Container - Full Screen */}
      <div style={{
        display: 'flex',
        flex: 1,
        background: '#ffffff',
        position: 'relative'
      }}>
        
        {/* LEFT PANE - Image & Branding */}
        <div style={{
          flex: '1.2',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          color: 'white',
          padding: '3rem',
          background: `
            linear-gradient(
              90deg,
              rgba(4, 31, 75, 0.6),
              rgba(4, 31, 75, 0.1)
            ),
            url("/images/sjvn-hydro-background.png") center / cover no-repeat
          `
        }}>
          {/* Top Logo Section */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 'auto' }}>
            <div style={{ background: 'white', padding: '6px', borderRadius: 8 }}>
              <img src="/sjvn-logo.png" alt="SJVN" style={{ height: 48, width: 'auto' }} />
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '0.02em', margin: 0 }}>SJVN</div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', color: '#cbd5e1' }}>A NAVRATNA CPSE</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>MINISTRY OF POWER, GOVERNMENT OF INDIA</div>
            </div>
          </div>

          {/* Middle Content */}
          <div style={{ marginTop: '4rem', maxWidth: '80%' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#93c5fd', marginBottom: 12 }}>
              CLEAN ENERGY <span style={{ color: '#475569', margin: '0 8px' }}>|</span> BRIGHTER TOMORROW
            </div>
            <h1 style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.1, marginBottom: 16 }}>
              RE Commercial &<br/>
              <span style={{ color: '#3b82f6' }}>Trading</span>
            </h1>
            <h2 style={{ fontSize: 20, fontWeight: 500, color: '#e2e8f0', marginBottom: 24 }}>
              Enterprise Management Platform
            </h2>
            <p style={{ fontSize: 15, color: '#cbd5e1', lineHeight: 1.6, maxWidth: 400, marginBottom: 40 }}>
              Digitising renewable energy commercial operations for a cleaner, smarter and sustainable tomorrow.
            </p>

            {/* Feature Cards Grid */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 40 }}>
              {[
                { icon: Leaf, label: 'Renewable\nGrowth' },
                { icon: BarChart3, label: 'Efficient\nTrading' },
                { icon: Handshake, label: 'Transparent\nOperations' },
                { icon: Globe2, label: 'Sustainable\nFuture' }
              ].map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <div key={i} style={{
                    background: 'rgba(4, 31, 75, 0.4)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(147, 197, 253, 0.3)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                    borderRadius: 16,
                    padding: '16px 12px',
                    width: 100,
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 12
                  }}>
                    <Icon size={24} color="#93c5fd" />
                    <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'pre-wrap', lineHeight: 1.3 }}>{feature.label}</div>
                  </div>
                )
              })}
            </div>

            {/* Handwritten script text (simulated with a nice italic serif) */}
            <div style={{ 
              fontFamily: '"Playfair Display", Georgia, serif', 
              fontStyle: 'italic', 
              fontSize: 24, 
              color: '#e2e8f0',
              transform: 'rotate(-3deg)',
              display: 'inline-block',
              marginLeft: '20%'
            }}>
              Harnessing Himalayan Energy<br/>
              <span style={{ borderBottom: '3px solid #3b82f6' }}>For A Greener India</span>
            </div>
          </div>

          {/* Bottom Stats Bar */}
          <div style={{ 
            marginTop: 'auto', 
            background: 'rgba(15, 23, 42, 0.6)', 
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 16,
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            {[
              { icon: Zap, val: '2,000+ MW', sub: 'Installed Capacity' },
              { icon: Leaf, val: 'Leading', sub: 'Renewable Portfolio' },
              { icon: Users, val: 'Nation Building', sub: 'Through Clean Energy' },
              { icon: Globe2, val: 'Sustainable', sub: 'For Generations' },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Icon size={20} color="#cbd5e1" />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>{stat.val}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{stat.sub}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>


        {/* RIGHT PANE - Login Form */}
        <div style={{
          flex: '0.8',
          padding: '3rem 4rem',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}>
          {/* Top Right subtle watermark text */}
          <div style={{ position: 'absolute', top: 32, right: 32, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{ color: '#94a3b8', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}>
              ENERGY<br/>FOR A BRIGHTER<br/>TOMORROW
            </div>
            <div style={{ width: 28, height: 2, background: '#3b82f6', marginTop: 6 }}></div>
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

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32, marginTop: '1.5rem', position: 'relative', zIndex: 1 }}>
            <div style={{ marginBottom: 16 }}>
              <img src="/sjvn-logo.png" alt="SJVN" style={{ height: 60, width: 'auto' }} />
            </div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
              RE Commercial & Trading
            </h2>
            <div style={{ color: '#64748b', fontSize: 14, fontWeight: 500, marginTop: 4 }}>
              Enterprise Management Platform
            </div>
          </div>

          {error && (
            <div className="animate-fade-in-up" style={{ marginBottom: 24, padding: 14, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 500 }}>{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ maxWidth: 400, margin: '0 auto', width: '100%', position: 'relative', zIndex: 1 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Work Email</label>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                  <Mail size={18} strokeWidth={2.5} />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@sjvn.in"
                  style={{
                    width: '100%',
                    padding: '14px 16px 14px 44px',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 12,
                    color: '#0f172a',
                    fontSize: 15,
                    outline: 'none',
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

            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Password</label>
                <a href="#" onClick={(e) => { e.preventDefault(); setShowForgotModal(true); }} style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>Forgot Password?</a>
              </div>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                  <Lock size={18} strokeWidth={2.5} />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: '100%',
                    padding: '14px 44px 14px 44px',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 12,
                    color: '#0f172a',
                    fontSize: 15,
                    outline: 'none',
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
                    position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', 
                    color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '16px',
                background: '#041F4B',
                color: 'white',
                border: 'none',
                borderRadius: 12,
                fontSize: 16,
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
              {loading ? 'Authenticating...' : <>Sign In <ArrowRight size={18} /></>}
            </button>
          </form>

          <div style={{ maxWidth: 400, margin: '0 auto', width: '100%', marginTop: 24, position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}></div>
              <div style={{ padding: '0 12px', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>OR</div>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}></div>
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'none', letterSpacing: '0.05em', marginBottom: 12, textAlign: 'center' }}>
              Quick Demo Login
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {DEMO_ACCOUNTS.map((a) => {
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
                      padding: '10px 14px',
                      borderRadius: 10,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s',
                    }}
                    onMouseOver={(e) => { 
                      e.currentTarget.style.borderColor = '#94a3b8'; 
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)';
                    }}
                    onMouseOut={(e) => { 
                      e.currentTarget.style.borderColor = '#e2e8f0'; 
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon size={14} color="#3b82f6" strokeWidth={2.5} />
                      {a.label}
                    </div>
                    <ChevronRight size={14} color="#cbd5e1" />
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
