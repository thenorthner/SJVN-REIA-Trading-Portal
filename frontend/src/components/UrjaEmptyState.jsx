import React from 'react';

/**
 * Urja Empty State Component
 * Renders the adorable "Urja" energy bot when tables or lists have zero records.
 * Poses supported:
 *  - 'leaf': Urja resting peacefully with a glowing solar leaf / sprout 🍃 (Default for Zero arrears, No disputes, etc.)
 *  - 'thumbs-up': Urja cheerfully giving a cute thumbs-up 👍 (Great for general tables, all clear, up to date)
 */
export default function UrjaEmptyState({
  message = 'No records found.',
  title,
  description,
  variant = 'auto', // 'leaf' | 'thumbs-up' | 'auto'
  size = 115,
  action = null,
  className = '',
  style = {},
}) {
  // If message is a raw react element, render it or extract text
  const msgText = typeof message === 'string' ? message : '';
  const isClearContext = /arrear|dispute|due|zero|settle|clean|pending|balance|overdue|exception/i.test(
    `${msgText} ${title || ''} ${description || ''}`
  );

  const activeVariant =
    variant === 'auto'
      ? isClearContext
        ? 'leaf'
        : 'thumbs-up'
      : variant;

  const displayTitle =
    title ||
    (msgText
      ? msgText
      : 'No records found.');

  // Only what the caller said: an empty table may be empty because nothing
  // is loaded yet or a filter hides it, so it never claims a ledger is clear.
  const displayDesc = description;

  return (
    <div
      className={`urja-empty-state-wrap ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        textAlign: 'center',
        color: 'var(--text-muted, #64748b)',
        ...style,
      }}
    >
      {/* ===================== URJA BOT VECTOR ===================== */}
      <div
        className="urja-empty-bot-float"
        style={{
          width: size,
          height: size * 1.05,
          position: 'relative',
          marginBottom: 12,
          filter: 'drop-shadow(0 8px 18px rgba(37, 99, 235, 0.14))',
          userSelect: 'none',
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 170 175"
          width="100%"
          height="100%"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* Soft Puffy Cloud Head Gradient */}
            <linearGradient id="urjaEmptyCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="35%" stopColor="#f0f9ff" />
              <stop offset="70%" stopColor="#bae6fd" />
              <stop offset="100%" stopColor="#7dd3fc" />
            </linearGradient>

            {/* Subtle Outer Cloud Rim */}
            <linearGradient id="urjaEmptyRimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#93c5fd" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>

            {/* White Torso Gradient */}
            <linearGradient id="urjaEmptyBodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="65%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#e0f2fe" />
            </linearGradient>

            {/* Blue Glove / Boot Gradient */}
            <linearGradient id="urjaEmptyGloveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#0284c7" />
              <stop offset="100%" stopColor="#0369a1" />
            </linearGradient>

            {/* Visor Screen Glass */}
            <linearGradient id="urjaEmptyScreenGlass" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#141c38" />
              <stop offset="100%" stopColor="#1d264a" />
            </linearGradient>

            {/* Solar Leaf Green Glow */}
            <linearGradient id="solarLeafGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="50%" stopColor="#22c55e" />
              <stop offset="100%" stopColor="#15803d" />
            </linearGradient>

            {/* Cyan Eye Glow */}
            <filter id="urjaEmptyCyanGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Soft Ground Shadow */}
          <ellipse cx="85" cy="164" rx="34" ry="5" fill="rgba(37, 99, 235, 0.16)" />

          {/* ===================== TINY CHUBBY LEGS ===================== */}
          <g id="legs">
            {/* Left Foot */}
            <g transform="translate(71, 142)">
              <rect x="0" y="0" width="13" height="12" rx="4.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.6" />
              <rect x="-1" y="8" width="15" height="10" rx="5" fill="url(#urjaEmptyGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
              <ellipse cx="6.5" cy="14" rx="3.5" ry="1.2" fill="#bae6fd" />
            </g>
            {/* Right Foot */}
            <g transform="translate(87, 142)">
              <rect x="0" y="0" width="13" height="12" rx="4.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.6" />
              <rect x="-1" y="8" width="15" height="10" rx="5" fill="url(#urjaEmptyGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
              <ellipse cx="6.5" cy="14" rx="3.5" ry="1.2" fill="#bae6fd" />
            </g>
          </g>

          {/* ===================== TINY CHUBBY BODY ===================== */}
          <g id="body">
            <rect
              x="62"
              y="119"
              width="46"
              height="34"
              rx="17"
              fill="url(#urjaEmptyBodyGrad)"
              stroke="#2563eb"
              strokeWidth="2.2"
            />
            {/* SJVN Chest Insignia */}
            <text
              x="85"
              y="141"
              textAnchor="middle"
              fill="#0284c7"
              fontSize="10.5"
              fontWeight="900"
              fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
              letterSpacing="0.08em"
            >
              SJVN
            </text>
          </g>

          {/* ===================== PUFFY CLOUD HEAD ===================== */}
          <g id="cloud-head" style={{ transformOrigin: '85px 116px', transform: 'scale(0.86)' }}>
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
              fill="url(#urjaEmptyCloudGrad)"
              stroke="url(#urjaEmptyRimGrad)"
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

            {/* COMPACT RED LIGHTNING BOLT EMBLEM (⚡) */}
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
                fill="url(#urjaEmptyScreenGlass)"
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

              {/* Rosy Blush Cheeks */}
              <ellipse cx="-22" cy="7" rx="4.5" ry="2.2" fill="#fb7185" opacity="0.8" />
              <ellipse cx="22" cy="7" rx="4.5" ry="2.2" fill="#fb7185" opacity="0.8" />

              {/* Happy Smiling Curved Eyes ("^   ^") with Sweet Smile */}
              <g filter="url(#urjaEmptyCyanGlow)">
                {activeVariant === 'thumbs-up' ? (
                  // Cheerful playful wink / smile
                  <>
                    {/* Left Eye: Big cute anime sparkle eye */}
                    <circle cx="-11" cy="0" r="5" fill="#38e1ff" />
                    <circle cx="-12.5" cy="-1.5" r="1.8" fill="#ffffff" />
                    <circle cx="-9" cy="1.8" r="0.9" fill="#ffffff" />
                    {/* Right Eye: Happy wink arc */}
                    <path d="M 5 1 C 9 -4, 15 -4, 19 1" stroke="#38e1ff" strokeWidth="3.4" strokeLinecap="round" fill="none" />
                    {/* Open cheerful mouth */}
                    <path d="M -3 6 Q 0 10 3 6 Z" fill="#38e1ff" />
                  </>
                ) : (
                  // Peaceful relaxing smiling eyes ("^   ^")
                  <>
                    <path
                      d="M -18 0 C -14 -6, -8 -6, -4 0"
                      stroke="#38e1ff"
                      strokeWidth="3.6"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <path
                      d="M 4 0 C 8 -6, 14 -6, 18 0"
                      stroke="#38e1ff"
                      strokeWidth="3.6"
                      strokeLinecap="round"
                      fill="none"
                    />
                    {/* Sweet smiling mouth ("◡") */}
                    <path
                      d="M -3 5 C -1 8, 1 8, 3 5"
                      stroke="#38e1ff"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </>
                )}
              </g>
            </g>
          </g>

          {/* ===================== POSE ARMS ===================== */}
          {activeVariant === 'thumbs-up' ? (
            /* THUMBS-UP POSE */
            <g id="thumbs-up-arms">
              {/* Left Arm: Resting gently on hip */}
              <path
                d="M 64 126 Q 50 134 56 142"
                stroke="#2563eb"
                strokeWidth="10"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 64 126 Q 50 134 56 142"
                stroke="#ffffff"
                strokeWidth="7"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="56" cy="142" r="5.5" fill="url(#urjaEmptyGloveGrad)" stroke="#1e40af" strokeWidth="1.5" />

              {/* Right Arm: Raising Thumbs-Up 👍 */}
              <g>
                <path
                  d="M 106 126 Q 120 124 128 116"
                  stroke="#2563eb"
                  strokeWidth="10"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M 106 126 Q 120 124 128 116"
                  stroke="#ffffff"
                  strokeWidth="7"
                  strokeLinecap="round"
                  fill="none"
                />
                {/* Glove Hand Fist */}
                <circle cx="129" cy="115" r="7" fill="url(#urjaEmptyGloveGrad)" stroke="#1e40af" strokeWidth="1.5" />
                {/* Thumb pointing up 👍 */}
                <path
                  d="M 129 114 L 129 104 C 129 101, 134 101, 134 104 L 134 114 Z"
                  fill="url(#urjaEmptyGloveGrad)"
                  stroke="#1e40af"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                {/* Energy Sparkle near thumb */}
                <path
                  d="M 137 100 L 139 96 L 141 100 L 145 102 L 141 104 L 139 108 L 137 104 L 133 102 Z"
                  fill="#facc15"
                />
              </g>
            </g>
          ) : (
            /* SOLAR LEAF POSE 🍃 */
            <g id="solar-leaf-arms">
              {/* Left Arm: Relaxing at side */}
              <path
                d="M 64 126 Q 52 132 50 141"
                stroke="#2563eb"
                strokeWidth="10"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 64 126 Q 52 132 50 141"
                stroke="#ffffff"
                strokeWidth="7"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="50" cy="141" r="5.5" fill="url(#urjaEmptyGloveGrad)" stroke="#1e40af" strokeWidth="1.5" />

              {/* Right Arm: Gently holding Glowing Solar Leaf 🍃 */}
              <path
                d="M 106 126 Q 118 132 122 136"
                stroke="#2563eb"
                strokeWidth="10"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 106 126 Q 118 132 122 136"
                stroke="#ffffff"
                strokeWidth="7"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="122" cy="136" r="6" fill="url(#urjaEmptyGloveGrad)" stroke="#1e40af" strokeWidth="1.5" />

              {/* Glowing Green Solar Leaf Sprout 🍃 */}
              <g transform="translate(122, 132) rotate(-24)">
                {/* Stem */}
                <path d="M 0 0 C 4 -6, 8 -12, 14 -16" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                {/* Main Leaf */}
                <path
                  d="M 14 -16 C 18 -26, 30 -28, 32 -20 C 34 -12, 24 -6, 14 -16 Z"
                  fill="url(#solarLeafGrad)"
                  stroke="#15803d"
                  strokeWidth="1.2"
                />
                {/* Leaf Vein */}
                <path d="M 16 -17 C 22 -21, 26 -22, 30 -21" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="0.8" fill="none" />
                {/* Sun Sparkle */}
                <circle cx="34" cy="-25" r="2.2" fill="#facc15" filter="drop-shadow(0 0 3px #facc15)" />
                <path
                  d="M 34 -30 L 34 -28 M 34 -22 L 34 -20 M 29 -25 L 31 -25 M 37 -25 L 39 -25"
                  stroke="#facc15"
                  strokeWidth="0.9"
                  strokeLinecap="round"
                />
              </g>
            </g>
          )}
        </svg>
      </div>

      {/* ===================== TYPOGRAPHY & MESSAGING ===================== */}
      <div style={{ maxWidth: 360 }}>
        <div
          style={{
            fontSize: '1.043rem',
            fontWeight: 700,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            marginBottom: 4,
          }}
        >
          {displayTitle}
        </div>
        {displayDesc && (
          <div
            style={{
              fontSize: '0.934rem',
              color: 'var(--text-muted, #64748b)',
              lineHeight: 1.45,
            }}
          >
            {displayDesc}
          </div>
        )}
      </div>

      {/* Optional Interactive CTA Button */}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
