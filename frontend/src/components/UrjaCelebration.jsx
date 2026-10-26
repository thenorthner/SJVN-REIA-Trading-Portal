import React, { useState, useEffect, useCallback } from 'react';
import { X, Sparkles } from 'lucide-react';

export const URJA_CELEBRATE_EVENT = 'sjvn:urja-celebrate';

/**
 * Global helper to trigger Urja's celebration cheer anywhere in the application.
 * E.g.
 *   triggerUrjaCelebration({
 *     title: 'Bid Submitted to Exchange! ⚡🎉',
 *     message: 'DAM Order #1042 locked and transmitted to exchange session.',
 *     badge: 'DAM / RTM Dispatch',
 *   });
 */
export function triggerUrjaCelebration(detail = {}) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(URJA_CELEBRATE_EVENT, {
        detail: {
          title: detail.title || 'Done',
          message: detail.message || '',
          badge: detail.badge || 'SJVN',
          duration: detail.duration || 4800,
        },
      })
    );
  }
}

/**
 * Urja Celebration Component
 * Renders in screen corner when high-stakes operations succeed:
 *  - Trader submits DAM/RTM bid to exchange
 *  - Hydro REA ledger or bill is approved / signed off
 *  - Reconciliation / Invoice signoff completed
 */
export default function UrjaCelebration() {
  const [active, setActive] = useState(null);
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setActive(null);
      setExiting(false);
    }, 280);
  }, []);

  useEffect(() => {
    let timerId;

    const handleCelebrate = (e) => {
      clearTimeout(timerId);
      setExiting(false);
      setActive(e.detail || { title: 'Done', message: '', badge: 'SJVN', duration: 4800 });

      const duration = e.detail?.duration || 4800;
      timerId = setTimeout(() => {
        dismiss();
      }, duration);
    };

    window.addEventListener(URJA_CELEBRATE_EVENT, handleCelebrate);
    return () => {
      window.removeEventListener(URJA_CELEBRATE_EVENT, handleCelebrate);
      clearTimeout(timerId);
    };
  }, [dismiss]);

  // Listen for Escape key to dismiss
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, dismiss]);

  if (!active) return null;

  return (
    <aside
      className={`urja-celebration-toast ${exiting ? 'exiting' : 'entering'}`}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 28,
        zIndex: 99999,
        maxWidth: 420,
        width: 'calc(100vw - 48px)',
        background: 'var(--surface)',
        color: 'var(--text)',
        borderRadius: 16,
        padding: '16px 18px',
        boxShadow:
          '0 20px 40px -12px rgba(37, 99, 235, 0.28), 0 0 0 1px rgba(37, 99, 235, 0.16)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        userSelect: 'none',
        overflow: 'hidden',
        backdropFilter: 'blur(12px)',
        transition: 'all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: exiting
          ? 'translateY(16px) scale(0.92)'
          : 'translateY(0) scale(1)',
        opacity: exiting ? 0 : 1,
      }}
    >
      {/* ===================== CUTE CHEERING URJA BOT ===================== */}
      <div
        className="urja-cheer-bot-bounce"
        style={{
          flexShrink: 0,
          width: 84,
          height: 94,
          position: 'relative',
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 170 185"
          width="100%"
          height="100%"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* Sparkle Star Glow */}
            <filter id="cheerGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Cloud Head Gradient */}
            <linearGradient id="cheerCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="35%" stopColor="#f0f9ff" />
              <stop offset="70%" stopColor="#bae6fd" />
              <stop offset="100%" stopColor="#7dd3fc" />
            </linearGradient>

            <linearGradient id="cheerRimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#93c5fd" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>

            <linearGradient id="cheerBodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="65%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#e0f2fe" />
            </linearGradient>

            <linearGradient id="cheerGloveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#0284c7" />
              <stop offset="100%" stopColor="#0369a1" />
            </linearGradient>

            <linearGradient id="cheerScreenGlass" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#141c38" />
              <stop offset="100%" stopColor="#1d264a" />
            </linearGradient>
          </defs>

          {/* Floating Confetti / Sparkle Stars around Head */}
          <g filter="url(#cheerGlow)">
            {/* Left Gold Star */}
            <path
              d="M 32 32 L 35 24 L 38 32 L 46 35 L 38 38 L 35 46 L 32 38 L 24 35 Z"
              fill="#facc15"
              className="urja-sparkle-spin"
            />
            {/* Right Cyan Star */}
            <path
              d="M 134 26 L 136 20 L 138 26 L 144 28 L 138 30 L 136 36 L 134 30 L 128 28 Z"
              fill="#38bdf8"
              className="urja-sparkle-spin-alt"
            />
            {/* Top Pink Party Sparkle */}
            <circle cx="85" cy="8" r="2.8" fill="#f43f5e" />
            <circle cx="120" cy="14" r="1.8" fill="#facc15" />
            <circle cx="50" cy="18" r="2" fill="#38bdf8" />
          </g>

          {/* Soft Ground Shadow */}
          <ellipse cx="85" cy="172" rx="34" ry="5" fill="rgba(37, 99, 235, 0.2)" />

          {/* ===================== TINY CHUBBY LEGS ===================== */}
          <g id="legs">
            <g transform="translate(71, 142)">
              <rect x="0" y="0" width="13" height="13" rx="4.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.6" />
              <rect x="-1" y="9" width="15" height="11" rx="5.5" fill="url(#cheerGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
              <ellipse cx="6.5" cy="16.5" rx="4" ry="1.4" fill="#bae6fd" />
            </g>
            <g transform="translate(87, 142)">
              <rect x="0" y="0" width="13" height="13" rx="4.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.6" />
              <rect x="-1" y="9" width="15" height="11" rx="5.5" fill="url(#cheerGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
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
              fill="url(#cheerBodyGrad)"
              stroke="#2563eb"
              strokeWidth="2.2"
            />
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

          {/* ===================== PUFFY CLOUD HEAD ===================== */}
          <g id="cloud-head" style={{ transformOrigin: '85px 116px', transform: 'scale(0.86)' }}>
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
              fill="url(#cheerCloudGrad)"
              stroke="url(#cheerRimGrad)"
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

            {/* RED LIGHTNING EMBLEM ⚡ */}
            <polygon
              points="87,36 78,50 85,50 81,62 94,46 87,46"
              fill="#ef4444"
              stroke="#dc2626"
              strokeWidth="1.2"
              strokeLinejoin="miter"
              filter="drop-shadow(0 0 4px rgba(239, 68, 68, 0.7))"
            />

            {/* VISOR SCREEN */}
            <g id="screen" transform="translate(85, 90)">
              <rect
                x="-35"
                y="-22"
                width="70"
                height="44"
                rx="18"
                fill="url(#cheerScreenGlass)"
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

              {/* Glowing Rosy Cheeks */}
              <ellipse cx="-22" cy="7" rx="4.5" ry="2.2" fill="#fb7185" opacity="0.9" />
              <ellipse cx="22" cy="7" rx="4.5" ry="2.2" fill="#fb7185" opacity="0.9" />

              {/* SUPER HAPPY CELEBRATION EYES ("^   ^") with Wide Joyful Smile */}
              <g filter="url(#cheerGlow)">
                <path
                  d="M -18 -1 C -14 -7, -8 -7, -4 -1"
                  stroke="#38e1ff"
                  strokeWidth="3.8"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M 4 -1 C 8 -7, 14 -7, 18 -1"
                  stroke="#38e1ff"
                  strokeWidth="3.8"
                  strokeLinecap="round"
                  fill="none"
                />
                {/* Big happy open mouth ("▽") */}
                <path
                  d="M -4 5 Q 0 11 4 5 Z"
                  fill="#38e1ff"
                />
              </g>
            </g>
          </g>

          {/* ===================== ARMS RAISED IN VICTORY CHEER 🎉 ===================== */}
          <g id="cheering-arms">
            {/* Left Arm Raised High Up */}
            <g>
              <path
                d="M 64 126 Q 46 112 40 95"
                stroke="#2563eb"
                strokeWidth="11"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 64 126 Q 46 112 40 95"
                stroke="#ffffff"
                strokeWidth="8"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="39" cy="94" r="7" fill="url(#cheerGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
            </g>

            {/* Right Arm Raised High Up */}
            <g>
              <path
                d="M 106 126 Q 124 112 130 95"
                stroke="#2563eb"
                strokeWidth="11"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 106 126 Q 124 112 130 95"
                stroke="#ffffff"
                strokeWidth="8"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="131" cy="94" r="7" fill="url(#cheerGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
            </g>
          </g>
        </svg>
      </div>

      {/* ===================== TEXT & DETAILS ===================== */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Badge Pill */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.814rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#0284c7',
            background: 'rgba(2, 132, 199, 0.1)',
            padding: '2px 8px',
            borderRadius: 6,
            marginBottom: 4,
          }}
        >
          <Sparkles size={11} color="#0284c7" />
          <span>{active.badge}</span>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: '1.023rem',
            fontWeight: 800,
            color: 'var(--text)',
            letterSpacing: '-0.015em',
            lineHeight: 1.25,
            marginBottom: 3,
          }}
        >
          {active.title}
        </div>

        {/* Message */}
        <div
          style={{
            fontSize: '0.914rem',
            color: 'var(--text-muted, #64748b)',
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {active.message}
        </div>
      </div>

      {/* ===================== CLOSE BUTTON ===================== */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss celebration"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted, #94a3b8)',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 6,
          alignSelf: 'flex-start',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text)';
          e.currentTarget.style.background = 'rgba(0,0,0,0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-muted, #94a3b8)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <X size={16} />
      </button>

      {/* ===================== PROGRESS DURATION BAR ===================== */}
      <div
        className="urja-celebration-progress"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'linear-gradient(90deg, #38bdf8, #2563eb, #10b981)',
          animation: `celebrationProgress ${active.duration || 4800}ms linear forwards`,
        }}
      />
    </aside>
  );
}
