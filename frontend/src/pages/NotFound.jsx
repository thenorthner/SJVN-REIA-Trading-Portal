import React from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { SEARCH_OPEN_EVENT } from '../components/PortalSearchModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { canRoleOpenPath } from '../roles.js';

/**
 * 404 Buddy Page — Urja with Disconnected Power Plug 🔌
 * Rendered when a route or resource does not exist in the dispatch topology.
 */
export default function NotFound({ standalone = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Only the desks this officer can open; a visitor is offered the public page.
  const deskLinks = DESK_LINKS.filter((d) => (user ? canRoleOpenPath(user.role, d.to) : d.public));

  const handleOpenSearch = () => {
    window.dispatchEvent(new CustomEvent(SEARCH_OPEN_EVENT));
  };

  const handleReconnect = () => {
    navigate('/', { replace: true });
  };

  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/', { replace: true });
    }
  };

  return (
    <div
      className="urja-404-container"
      role={standalone ? 'main' : undefined}
      aria-labelledby="not-found-title"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: standalone ? '100vh' : 'calc(100vh - 120px)',
        padding: '36px 20px',
        textAlign: 'center',
        background: standalone
          ? 'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(37,99,235,0.08) 0%, var(--bg, #f8fafc) 100%)'
          : 'transparent',
        userSelect: 'none',
      }}
    >
      {/* ===================== URJA 404 VECTOR MASCOT ===================== */}
      <div
        className="urja-404-mascot-wrap"
        style={{
          width: 250,
          height: 265,
          position: 'relative',
          marginBottom: 20,
          filter: 'drop-shadow(0 14px 28px rgba(37, 99, 235, 0.2))',
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 200 210"
          width="100%"
          height="100%"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* Cyan Eye Glow */}
            <filter id="urja404CyanGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Electric Spark Glow */}
            <filter id="sparkGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Cloud Head Gradient */}
            <linearGradient id="urja404CloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="35%" stopColor="#f0f9ff" />
              <stop offset="70%" stopColor="#bae6fd" />
              <stop offset="100%" stopColor="#7dd3fc" />
            </linearGradient>

            {/* Cloud Outer Rim */}
            <linearGradient id="urja404RimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#93c5fd" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>

            {/* White Body Gradient */}
            <linearGradient id="urja404BodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="65%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#e0f2fe" />
            </linearGradient>

            {/* Blue Glove Gradient */}
            <linearGradient id="urja404GloveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#0284c7" />
              <stop offset="100%" stopColor="#0369a1" />
            </linearGradient>

            {/* Power Cable Industrial Rubber */}
            <linearGradient id="cableRubber" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="50%" stopColor="#334155" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>

            {/* Golden Brass Prongs */}
            <linearGradient id="brassProng" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="40%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#ca8a04" />
            </linearGradient>

            {/* Screen Glass */}
            <linearGradient id="urja404ScreenGlass" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#141c38" />
              <stop offset="100%" stopColor="#1d264a" />
            </linearGradient>
          </defs>

          {/* Ground Shadow */}
          <ellipse cx="100" cy="186" rx="46" ry="6" fill="rgba(37, 99, 235, 0.18)" />

          {/* Master Mascot Container with Unified Placement */}
          <g transform="translate(15, 12)">
            {/* ===================== TINY CHUBBY LEGS ===================== */}
            <g id="legs">
              <g transform="translate(71, 142)">
                <rect x="0" y="0" width="13" height="13" rx="4.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.6" />
                <rect x="-1" y="9" width="15" height="11" rx="5.5" fill="url(#urja404GloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
                <ellipse cx="6.5" cy="16.5" rx="4" ry="1.4" fill="#bae6fd" />
              </g>
              <g transform="translate(87, 142)">
                <rect x="0" y="0" width="13" height="13" rx="4.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.6" />
                <rect x="-1" y="9" width="15" height="11" rx="5.5" fill="url(#urja404GloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
                <ellipse cx="6.5" cy="16.5" rx="4" ry="1.4" fill="#bae6fd" />
              </g>
            </g>

            {/* ===================== TINY CHUBBY BODY ===================== */}
            <g id="body">
              <rect
                x="62"
                y="119"
                width="46"
                height="35"
                rx="17.5"
                fill="url(#urja404BodyGrad)"
                stroke="#2563eb"
                strokeWidth="2.2"
              />
              {/* SJVN Emblem */}
              <text
                x="85"
                y="141"
                textAnchor="middle"
                fill="#0284c7"
                fontSize="11"
                fontWeight="900"
                fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                letterSpacing="0.08em"
              >
                SJVN
              </text>
            </g>

            {/* ===================== PUFFY CLOUD HEAD (TILTED WITH SWEAT DROP) ===================== */}
            <g
              id="cloud-head"
              style={{
                transformOrigin: '85px 116px',
                transform: 'scale(0.86) rotate(-2.8deg)',
              }}
            >
            {/* Cloud Silhouette */}
            <path
              d="M 85 20
                 C 92 18, 102 24, 108 32
                 C 118 30, 130 38, 134 50
                 C 142 54, 148 64, 146 76
                 C 148 88, 142 100, 132 108
                 C 126 118, 112 124, 98 123
                 C 90 125, 80 125, 72 123
                 C 58 124, 44 118, 38 108
                 C 28 100, 22 88, 24 76
                 C 22 64, 28 54, 36 50
                 C 40 38, 52 30, 62 32
                 C 68 24, 78 18, 85 20 Z"
              fill="url(#urja404CloudGrad)"
              stroke="url(#urja404RimGrad)"
              strokeWidth="2.8"
              strokeLinejoin="round"
            />

            {/* Cloud Highlight */}
            <path
              d="M 72 26 C 78 22, 92 22, 98 26"
              stroke="rgba(255, 255, 255, 0.9)"
              strokeWidth="3.2"
              strokeLinecap="round"
            />

            {/* Compact Red Lightning Emblem */}
            <polygon
              points="87,36 78,50 85,50 81,62 94,46 87,46"
              fill="#ef4444"
              stroke="#dc2626"
              strokeWidth="1.2"
              strokeLinejoin="miter"
              filter="drop-shadow(0 0 3px rgba(239, 68, 68, 0.6))"
            />

            {/* VISOR SCREEN */}
            <g id="screen" transform="translate(85, 90)">
              <rect
                x="-35"
                y="-22"
                width="70"
                height="44"
                rx="18"
                fill="url(#urja404ScreenGlass)"
                stroke="#1e294b"
                strokeWidth="2.4"
              />
              <rect
                x="-32.5"
                y="-19.5"
                width="65"
                height="39"
                rx="15"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1"
                strokeOpacity="0.35"
              />

              {/* Glossy Reflection */}
              <path
                d="M -26 -13 C -13 -19, 13 -19, 26 -13 C 13 -16, -13 -16, -26 -13 Z"
                fill="rgba(255, 255, 255, 0.28)"
              />

              {/* Rosy Blush */}
              <ellipse cx="-22" cy="7" rx="4.5" ry="2.2" fill="#fb7185" opacity="0.85" />
              <ellipse cx="22" cy="7" rx="4.5" ry="2.2" fill="#fb7185" opacity="0.85" />

              {/* Puzzled Anime Expression: Wide Curious Eyes with Reflection */}
              <g filter="url(#urja404CyanGlow)">
                {/* Left Eye: Big cute anime pupil */}
                <circle cx="-12" cy="0" r="5.6" fill="#38e1ff" />
                <circle cx="-13.8" cy="-1.8" r="2.2" fill="#ffffff" />
                <circle cx="-9.8" cy="2" r="1" fill="#ffffff" />

                {/* Right Eye: Big cute anime pupil */}
                <circle cx="12" cy="0" r="5.6" fill="#38e1ff" />
                <circle cx="10.2" cy="-1.8" r="2.2" fill="#ffffff" />
                <circle cx="14.2" cy="2" r="1" fill="#ffffff" />

                {/* Bewildered Little Mouth ("o") */}
                <ellipse cx="0" cy="6" rx="2.8" ry="3.2" fill="#38e1ff" />
              </g>

              {/* Cute Anime Sweat Drop by cheek */}
              <path
                d="M 32 -10 C 32 -10, 36 -3, 36 0 C 36 2.2, 34.2 4, 32 4 C 29.8 4, 28 2.2, 28 0 C 28 -3, 32 -10, 32 -10 Z"
                fill="#38bdf8"
                opacity="0.85"
                filter="drop-shadow(0 0 2px #38bdf8)"
              />
            </g>
          </g>

          {/* ===================== ARMS HOLDING DISCONNECTED POWER PLUG 🔌 ===================== */}
          <g id="holding-power-plug">
            {/* LEFT ARM & MALE POWER PLUG */}
            <g id="left-arm-plug">
              {/* Arm reaching forward and inward */}
              <path
                d="M 64 126 Q 44 135 52 148"
                stroke="#2563eb"
                strokeWidth="11"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 64 126 Q 44 135 52 148"
                stroke="#ffffff"
                strokeWidth="8"
                strokeLinecap="round"
                fill="none"
              />
              {/* Blue Glove Paw Holding Plug Head */}
              <circle cx="53" cy="148" r="6.5" fill="url(#urja404GloveGrad)" stroke="#1e40af" strokeWidth="1.6" />

              {/* Heavy Power Cable dangling from left */}
              <path
                d="M 28 178 Q 36 160 52 148"
                stroke="url(#cableRubber)"
                strokeWidth="5"
                strokeLinecap="round"
                fill="none"
              />

              {/* Heavy Plug Body Head */}
              <g transform="translate(56, 142) rotate(16)">
                <rect x="0" y="0" width="13" height="11" rx="2.5" fill="url(#cableRubber)" stroke="#475569" strokeWidth="1" />
                <rect x="11" y="1" width="3" height="9" rx="1" fill="#64748b" />
                {/* 3 Golden Brass Prongs extending rightward */}
                <rect x="14" y="2" width="8" height="2.2" rx="0.8" fill="url(#brassProng)" stroke="#a16207" strokeWidth="0.6" />
                <rect x="14" y="6.8" width="8" height="2.2" rx="0.8" fill="url(#brassProng)" stroke="#a16207" strokeWidth="0.6" />
              </g>
            </g>

            {/* RIGHT ARM & FEMALE RECEPTACLE / COUPLER */}
            <g id="right-arm-socket">
              {/* Arm reaching inward */}
              <path
                d="M 106 126 Q 126 135 118 148"
                stroke="#2563eb"
                strokeWidth="11"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 106 126 Q 126 135 118 148"
                stroke="#ffffff"
                strokeWidth="8"
                strokeLinecap="round"
                fill="none"
              />
              {/* Blue Glove Paw Holding Socket */}
              <circle cx="117" cy="148" r="6.5" fill="url(#urja404GloveGrad)" stroke="#1e40af" strokeWidth="1.6" />

              {/* Heavy Power Cable dangling from right */}
              <path
                d="M 142 178 Q 134 160 118 148"
                stroke="url(#cableRubber)"
                strokeWidth="5"
                strokeLinecap="round"
                fill="none"
              />

              {/* Female Socket Coupler Body */}
              <g transform="translate(102, 142) rotate(-16)">
                <rect x="0" y="0" width="14" height="13" rx="3" fill="url(#cableRubber)" stroke="#475569" strokeWidth="1" />
                <rect x="-3" y="1.5" width="4" height="10" rx="1.5" fill="#334155" />
                {/* Socket pin holes */}
                <circle cx="-1" cy="4" r="1.2" fill="#0f172a" />
                <circle cx="-1" cy="9" r="1.2" fill="#0f172a" />
              </g>
            </g>

            {/* ===================== ELECTRIC DISCONNECT SPARKS ⚡ ===================== */}
            <g id="electric-sparks" filter="url(#sparkGlow)">
              {/* Crackling Mini Lightning Arc between plug and socket */}
              <path
                d="M 78 146 L 82 142 L 85 147 L 89 143 L 93 148 L 98 144"
                stroke="#38e1ff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                className="animate-spark-flash"
              />
              {/* Yellow Spark Burst */}
              <polygon
                points="85,138 88,143 83,143 86,149 80,144 84,144"
                fill="#facc15"
              />
              <circle cx="82" cy="141" r="1.5" fill="#ffffff" />
              <circle cx="91" cy="145" r="1.2" fill="#38e1ff" />
              <circle cx="87" cy="151" r="1" fill="#facc15" />
            </g>
          </g>
        </g>
      </svg>
    </div>

      {/* ===================== STATUS PILL & CODE ===================== */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 9999,
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          color: '#ef4444',
          fontSize: '0.894rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 14,
        }}
      >
        <span>⚡ 404 · Circuit Offline</span>
        <span style={{ color: 'var(--text-muted, #94a3b8)', fontWeight: 400 }}>|</span>
        <span>ग्रिड संपर्क विच्छेद</span>
      </div>

      {/* ===================== HEADLINE & COPY ===================== */}
      <h1
        id="not-found-title"
        className="urja-404-title"
        style={{
          fontSize: 'clamp(1.75rem, 4vw, 2.3rem)',
          fontWeight: 800,
          letterSpacing: '-0.025em',
          marginBottom: 10,
          maxWidth: 620,
        }}
      >
        Page not found
      </h1>

      <p
        className="urja-404-desc"
        style={{
          fontSize: '1rem',
          lineHeight: 1.6,
          maxWidth: 560,
          margin: '0 auto 16px',
        }}
      >
        There is no page at this address. It may have been mistyped, or the page may have moved.
      </p>

      {/* Path Breadcrumb badge */}
      <div
        className="urja-404-route-badge"
        style={{
          display: 'inline-block',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '0.914rem',
          borderRadius: 6,
          padding: '4px 10px',
          marginBottom: 24,
        }}
      >
        Address: <strong>{location.pathname}</strong>
      </div>

      {/* ===================== ACTION BUTTONS ===================== */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 36,
        }}
      >
        {/* Primary: Reconnect to Grid */}
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={handleReconnect}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 22px',
            fontSize: '1.043rem',
            fontWeight: 700,
            borderRadius: 8,
            boxShadow: '0 4px 14px rgba(37, 99, 235, 0.3)',
          }}
        >
          <span>⚡ Back to my desk</span>
        </button>

        {/* Secondary: Spotlight Search */}
        <button
          type="button"
          className="btn btn-secondary btn-lg"
          onClick={handleOpenSearch}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            fontSize: '1.013rem',
            borderRadius: 8,
          }}
        >
          <span>🔍 Search Portal</span>
          <kbd
            style={{
              padding: '2px 6px',
              fontSize: '12.5px',
              background: 'rgba(0,0,0,0.06)',
              borderRadius: 4,
              border: '1px solid rgba(0,0,0,0.1)',
            }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Back button */}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleGoBack}
          style={{
            padding: '10px 16px',
            fontSize: '0.983rem',
          }}
        >
          ← Previous page
        </button>
      </div>

      {/* ===================== QUICK JUMP FEEDERS ===================== */}
      <div
        style={{
          borderTop: '1px solid var(--border, #e2e8f0)',
          paddingTop: 24,
          maxWidth: 580,
          width: '100%',
        }}
      >
        <div
          style={{
            fontSize: '0.874rem',
            fontWeight: 700,
            color: 'var(--text-muted, #94a3b8)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          {user ? 'Your desks' : 'Public pages'}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {deskLinks.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              className={`badge ${d.badge}`}
              style={{ padding: '6px 12px', fontSize: '0.934rem', textDecoration: 'none' }}
            >
              {d.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

const DESK_LINKS = [
  { to: '/trading', label: '⚡ Day-Ahead & RTM Trading', badge: 'badge-blue' },
  { to: '/reia', label: '☀️ REIA Solar ISTS Desk', badge: 'badge-green' },
  { to: '/hydro-thermal', label: '💧 Hydro Commercial (Nathpa / Rampur)', badge: 'badge-blue' },
  { to: '/thermal', label: '🏭 Thermal (Buxar)', badge: 'badge-blue' },
  { to: '/circulars', label: '📜 Public Regulatory Disclosures', badge: 'badge-gray', public: true },
];
