import React, { useState, useEffect } from 'react';

/**
 * SJVN Energy Mascot Bot — "Urja" (ऊर्जा)
 * Pixel-perfect vector implementation matching the user's dream design:
 * 1. Head: Big, soft, puffy cloud-like silhouette with gentle curves (no rigid helmet!)
 * 2. Forehead: Spacious, clean cloud forehead with a neat, compact red lightning emblem (⚡)
 * 3. Eyes with Emotion:
 *    - Idle: Sweet curved smiling eyes ("^   ^"), tiny smiling mouth ("◡"), glowing blush cheeks
 *    - Username Typing: Leans forward/downward ("jhuk kar dekhna") with curious downward anime pupils
 *    - Password Typing: Chubby paws smoothly cover eyes on the visor (🙈) with bright blush
 *    - Show Password: Right paw lowers to peek curiously with a shiny anime sparkle eye (👀)
 * 4. Body: Cute, tiny, adorable chibi body with clean "SJVN" insignia on chest
 * 5. Outlines: Soft, clean, minimal borders — no heavy mechanical lines!
 */
export default function SjvnBotMascot({
  inputFocus = null, // 'email' | 'password' | null
  showPassword = false,
  textLength = 0,
  isError = false,
  isLoading = false,
  size = 145,
  className = '',
}) {
  const [blink, setBlink] = useState(false);

  // Natural periodic blinking every 3.5 - 5.5s
  useEffect(() => {
    let timeoutId;
    const scheduleBlink = () => {
      const delay = Math.random() * 2000 + 3500;
      timeoutId = setTimeout(() => {
        setBlink(true);
        setTimeout(() => {
          setBlink(false);
          scheduleBlink();
        }, 160);
      }, delay);
    };
    scheduleBlink();
    return () => clearTimeout(timeoutId);
  }, []);

  // Eye gaze tracking calculations based on email text length
  const maxChars = 28;
  const gazeProgress = Math.min(Math.max(textLength / maxChars, 0), 1);
  const eyeTrackX = inputFocus === 'email' ? (gazeProgress - 0.5) * 8 : 0;
  // When typing username, eyes look downward towards the keyboard/input
  const eyeTrackY = inputFocus === 'email' ? 4 : 0;

  const isCoveringEyes = inputFocus === 'password' && !showPassword;
  const isPeeking = inputFocus === 'password' && showPassword;
  const isTypingEmail = inputFocus === 'email';

  // Leaning calculation: head is scaled to 0.86 to keep it compact and well-proportioned
  const leanTransform = isTypingEmail
    ? `scale(0.86) translateY(3.5px) rotate(${4 + (textLength % 2 === 0 ? 0.7 : -0.7)}deg)`
    : isCoveringEyes
    ? 'scale(0.86) translateY(1.5px)'
    : 'scale(0.86)';

  return (
    <div 
      className={`sjvn-bot-mascot-wrap ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        userSelect: 'none',
      }}
      aria-hidden="true"
    >
      {/* Main Cute Non-Pixelated Vector Mascot */}
      <svg
        width={size}
        height={size * 1.12}
        viewBox="0 0 170 185"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          overflow: 'visible',
          filter: 'drop-shadow(0 10px 22px rgba(37, 99, 235, 0.18))',
          transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
          transform: isError ? 'rotate(-3deg) scale(0.98)' : 'none',
        }}
      >
        <defs>
          {/* Neon Cyan Glow */}
          <filter id="cyanGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Red Spark Glow */}
          <filter id="redSparkGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Soft Puffy Cloud Head Gradient */}
          <linearGradient id="cloudSoftGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor="#f0f9ff" />
            <stop offset="70%" stopColor="#bae6fd" />
            <stop offset="100%" stopColor="#7dd3fc" />
          </linearGradient>

          {/* Subtle Outer Cloud Rim */}
          <linearGradient id="cloudRimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#93c5fd" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>

          {/* White Torso Gradient */}
          <linearGradient id="bodyWhiteGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="65%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#e0f2fe" />
          </linearGradient>

          {/* Blue Glove / Boot Gradient */}
          <linearGradient id="blueGloveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0369a1" />
          </linearGradient>

          {/* Visor Screen Glass */}
          <linearGradient id="screenGlass" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#141c38" />
            <stop offset="100%" stopColor="#1d264a" />
          </linearGradient>
        </defs>

        {/* ===================== SOFT GROUND SHADOW ===================== */}
        <ellipse
          cx="85"
          cy="172"
          rx="36"
          ry="5.5"
          fill="rgba(37, 99, 235, 0.2)"
        />

        {/* ===================== TINY CHUBBY LEGS ===================== */}
        <g id="legs">
          {/* Left Leg */}
          <g transform="translate(71, 142)">
            {/* White upper leg */}
            <rect x="0" y="0" width="13" height="13" rx="4.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.6" />
            {/* Blue foot cuff */}
            <rect x="-1" y="9" width="15" height="11" rx="5.5" fill="url(#blueGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
            {/* Foot highlight */}
            <ellipse cx="6.5" cy="16.5" rx="4" ry="1.4" fill="#bae6fd" />
          </g>

          {/* Right Leg */}
          <g transform="translate(87, 142)">
            {/* White upper leg */}
            <rect x="0" y="0" width="13" height="13" rx="4.5" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.6" />
            {/* Blue foot cuff */}
            <rect x="-1" y="9" width="15" height="11" rx="5.5" fill="url(#blueGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
            {/* Foot highlight */}
            <ellipse cx="6.5" cy="16.5" rx="4" ry="1.4" fill="#bae6fd" />
          </g>
        </g>

        {/* ===================== TINY CHUBBY BODY (WITH CLEAN SJVN LOGO) ===================== */}
        <g 
          id="body"
          style={{
            transformOrigin: '85px 140px',
            transition: 'transform 0.25s ease',
            transform: isTypingEmail ? 'translateY(2px) rotate(1.5deg)' : 'none',
          }}
        >
          {/* Small Chubby White Torso */}
          <rect
            x="62"
            y="119"
            width="46"
            height="35"
            rx="17.5"
            fill="url(#bodyWhiteGrad)"
            stroke="#2563eb"
            strokeWidth="2.2"
          />

          {/* Soft belly curve shadow */}
          <ellipse
            cx="85"
            cy="148"
            rx="16"
            ry="3.5"
            fill="rgba(37, 99, 235, 0.12)"
          />

          {/* Bold Clean SJVN Emblem on Belly (Comfortable breathing space from head chin) */}
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

        {/* ===================== PUFFY CLOUD HEAD (BIG, GOL, CLOUD-LIKE WITH SPACIOUS FOREHEAD) ===================== */}
        <g
          id="cloud-head"
          style={{
            transformOrigin: '85px 116px',
            transition: 'transform 0.28s cubic-bezier(0.34, 1.4, 0.64, 1)',
            transform: leanTransform,
          }}
        >
          {/* Puffy Cloud Silhouette — Multi-lobed, organic, plush & soft */}
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
            fill="url(#cloudSoftGrad)"
            stroke="url(#cloudRimGrad)"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />

          {/* Soft Puffy Highlights on Cloud Lobes */}
          <path
            d="M 72 26 C 78 22, 92 22, 98 26"
            stroke="rgba(255, 255, 255, 0.9)"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <ellipse
            cx="44"
            cy="54"
            rx="5.5"
            ry="9"
            fill="rgba(255, 255, 255, 0.65)"
            transform="rotate(-28 44 54)"
          />
          <ellipse
            cx="126"
            cy="54"
            rx="5.5"
            ry="9"
            fill="rgba(255, 255, 255, 0.65)"
            transform="rotate(28 126 54)"
          />

          {/* SMALL COMPACT RED LIGHTNING BOLT EMBLEM (⚡) ON FOREHEAD */}
          <polygon
            points="87,36 78,50 85,50 81,62 94,46 87,46"
            fill="#ef4444"
            stroke="#dc2626"
            strokeWidth="1.2"
            strokeLinejoin="miter"
            filter="url(#redSparkGlow)"
          />

          {/* ===================== CUTE VISOR SCREEN ===================== */}
          <g id="screen" transform="translate(85, 90)">
            {/* Screen Outer Bezel */}
            <rect
              x="-35"
              y="-22"
              width="70"
              height="44"
              rx="18"
              fill="url(#screenGlass)"
              stroke="#1e294b"
              strokeWidth="2.4"
            />

            {/* Inner Neon Cyan Edge */}
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

            {/* Glossy Top Glass Glare Pill */}
            <path
              d="M -26 -13 C -13 -19, 13 -19, 26 -13 C 13 -16, -13 -16, -26 -13 Z"
              fill="rgba(255, 255, 255, 0.28)"
            />
            <ellipse
              cx="22"
              cy="-13"
              rx="2.8"
              ry="1.4"
              fill="#ffffff"
              opacity="0.6"
            />

            {/* Cheeks: Soft Glowing Blush (Always present, brighter on password) */}
            <ellipse
              cx="-22"
              cy="7"
              rx="4.5"
              ry="2.2"
              fill="#fb7185"
              opacity={inputFocus === 'password' ? 0.95 : 0.65}
              style={{ transition: 'opacity 0.25s ease' }}
            />
            <ellipse
              cx="22"
              cy="7"
              rx="4.5"
              ry="2.2"
              fill="#fb7185"
              opacity={inputFocus === 'password' ? 0.95 : 0.65}
              style={{ transition: 'opacity 0.25s ease' }}
            />

            {/* ===================== EYES & MOUTH WITH REAL EMOTION ===================== */}
            <g
              id="cute-eyes-group"
              transform={`translate(${eyeTrackX}, ${eyeTrackY})`}
              filter="url(#cyanGlow)"
            >
              {/* STATE A: Loading Spinner */}
              {isLoading && (
                <g>
                  <circle cx="0" cy="0" r="9" stroke="#38e1ff" strokeWidth="2.6" strokeDasharray="14 7" className="animate-spin" />
                  <circle cx="0" cy="0" r="3" fill="#38e1ff" />
                </g>
              )}

              {/* STATE B: Error (Soft Dizzy x x) */}
              {!isLoading && isError && (
                <g>
                  <line x1="-16" y1="-4" x2="-8" y2="4" stroke="#ef4444" strokeWidth="2.8" strokeLinecap="round" />
                  <line x1="-8" y1="-4" x2="-16" y2="4" stroke="#ef4444" strokeWidth="2.8" strokeLinecap="round" />
                  <line x1="8" y1="-4" x2="16" y2="4" stroke="#ef4444" strokeWidth="2.8" strokeLinecap="round" />
                  <line x1="16" y1="-4" x2="8" y2="4" stroke="#ef4444" strokeWidth="2.8" strokeLinecap="round" />
                </g>
              )}

              {/* STATE C: Password Peeking (Right Eye Peeks Curious!) */}
              {!isLoading && !isError && isPeeking && (
                <g>
                  {/* Left Eye: Happy squinting closed arc under left paw */}
                  <path d="M -18 0 C -14 -5, -8 -5, -4 0" stroke="#38e1ff" strokeWidth="3.4" strokeLinecap="round" fill="none" />
                  
                  {/* Right Eye: Big curious open anime eye peeking out! */}
                  <circle cx="12" cy="-0.5" r="6" fill="#38e1ff" />
                  <circle cx="10.5" cy="-2.2" r="2.2" fill="#ffffff" />
                  <circle cx="14" cy="1.6" r="1" fill="#ffffff" />

                  {/* Playful smiling mouth */}
                  <path d="M -2 5 C 0 8, 3 8, 5 5" stroke="#38e1ff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
                </g>
              )}

              {/* STATE D: Normal / Blinking / Email Typing */}
              {!isLoading && !isError && !isPeeking && (
                <>
                  {blink || isCoveringEyes ? (
                    // Blinking or Eyes Closed: "^   ^"
                    <g>
                      <path d="M -18 1 C -14 -4, -8 -4, -4 1" stroke="#38e1ff" strokeWidth="3.4" strokeLinecap="round" fill="none" />
                      <path d="M 4 1 C 8 -4, 14 -4, 18 1" stroke="#38e1ff" strokeWidth="3.4" strokeLinecap="round" fill="none" />
                    </g>
                  ) : isTypingEmail ? (
                    // Email typing: Curious shiny anime pupils leaning & looking down at input!
                    <g>
                      {/* Left Shiny Pupil looking downward */}
                      <circle cx="-12" cy="1.5" r="5.5" fill="#38e1ff" />
                      <circle cx="-13.8" cy="-0.3" r="2" fill="#ffffff" />
                      <circle cx="-9.8" cy="3.2" r="1" fill="#ffffff" />
                      {/* Right Shiny Pupil looking downward */}
                      <circle cx="12" cy="1.5" r="5.5" fill="#38e1ff" />
                      <circle cx="10.2" cy="-0.3" r="2" fill="#ffffff" />
                      <circle cx="14.2" cy="3.2" r="1" fill="#ffffff" />
                      {/* Happy little mouth looking at input */}
                      <ellipse cx="0" cy="6" rx="2.4" ry="1.8" fill="#38e1ff" />
                    </g>
                  ) : (
                    // Signature Happy Curved Smiling Eyes: "^   ^" with Sweet Smile ("◡") matching dream image!
                    <g>
                      {/* Left Happy Curved Eye */}
                      <path
                        d="M -18 0 C -14 -6, -8 -6, -4 0"
                        stroke="#38e1ff"
                        strokeWidth="3.6"
                        strokeLinecap="round"
                        fill="none"
                      />
                      {/* Right Happy Curved Eye */}
                      <path
                        d="M 4 0 C 8 -6, 14 -6, 18 0"
                        stroke="#38e1ff"
                        strokeWidth="3.6"
                        strokeLinecap="round"
                        fill="none"
                      />
                      {/* Tiny Sweet Smiling Mouth */}
                      <path
                        d="M -3 5 C -1 8, 1 8, 3 5"
                        stroke="#38e1ff"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        fill="none"
                      />
                    </g>
                  )}
                </>
              )}
            </g>
          </g>
        </g>

        {/* ===================== TINY CHUBBY ARMS ===================== */}
        {/* NORMAL RESTING ARMS (Hanging down naturally at sides) */}
        {!isCoveringEyes && !isPeeking && (
          <g 
            id="normal-cute-arms"
            style={{
              transition: 'transform 0.25s ease',
              transform: isTypingEmail ? 'translateY(2px)' : 'none',
            }}
          >
            {/* Left Arm */}
            <g>
              <path
                d={isTypingEmail ? "M 63 126 Q 52 130 52 140" : "M 64 126 Q 52 130 50 140"}
                stroke="#2563eb"
                strokeWidth="11"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d={isTypingEmail ? "M 63 126 Q 52 130 52 140" : "M 64 126 Q 52 130 50 140"}
                stroke="#ffffff"
                strokeWidth="8"
                strokeLinecap="round"
              />
              {/* Blue Mitten Paw */}
              <circle cx={isTypingEmail ? "52" : "49"} cy={isTypingEmail ? "141" : "141"} r="6" fill="url(#blueGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
            </g>

            {/* Right Arm */}
            <g>
              <path
                d={isTypingEmail ? "M 107 126 Q 118 130 118 140" : "M 106 126 Q 118 130 120 140"}
                stroke="#2563eb"
                strokeWidth="11"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d={isTypingEmail ? "M 107 126 Q 118 130 118 140" : "M 106 126 Q 118 130 120 140"}
                stroke="#ffffff"
                strokeWidth="8"
                strokeLinecap="round"
              />
              {/* Blue Mitten Paw */}
              <circle cx={isTypingEmail ? "118" : "121"} cy={isTypingEmail ? "141" : "141"} r="6" fill="url(#blueGloveGrad)" stroke="#1e40af" strokeWidth="1.6" />
            </g>
          </g>
        )}

        {/* COVERING EYES ARMS (Chubby paws fold up over the screen!) */}
        {(isCoveringEyes || isPeeking) && (
          <g id="covering-cute-arms" style={{ animation: 'armsSpringUp 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            {/* Left Arm Covering Left Eye */}
            <path
              d="M 62 130 C 48 116, 56 96, 73 92"
              stroke="#3b82f6"
              strokeWidth="9"
              strokeLinecap="round"
              fill="none"
            />
            {/* Left Paw Mitten */}
            <circle cx="74" cy="92" r="8.5" fill="url(#blueGloveGrad)" stroke="#1e40af" strokeWidth="1.8" />
            <circle cx="71" cy="89" r="2.8" fill="#93c5fd" />

            {/* RIGHT ARM */}
            {isCoveringEyes ? (
              // Both paws covering eyes
              <g id="right-arm-covering">
                <path
                  d="M 108 130 C 122 116, 114 96, 97 92"
                  stroke="#3b82f6"
                  strokeWidth="9"
                  strokeLinecap="round"
                  fill="none"
                />
                <circle cx="96" cy="92" r="8.5" fill="url(#blueGloveGrad)" stroke="#1e40af" strokeWidth="1.8" />
                <circle cx="99" cy="89" r="2.8" fill="#93c5fd" />
              </g>
            ) : (
              // PEEKING: Right paw drops down to cheek so right eye is wide open & peeking!
              <g id="right-arm-peeking">
                <path
                  d="M 108 130 C 122 120, 115 106, 98 104"
                  stroke="#3b82f6"
                  strokeWidth="9"
                  strokeLinecap="round"
                  fill="none"
                />
                <circle cx="97" cy="104" r="8" fill="url(#blueGloveGrad)" stroke="#1e40af" strokeWidth="1.8" />
                <circle cx="100" cy="101" r="2.5" fill="#93c5fd" />
              </g>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}
