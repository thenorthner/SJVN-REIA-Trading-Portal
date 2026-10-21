import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';

export default function ThemeToggle({ variant = 'header', showLabel = false, className = '' }) {
  const { theme, toggleTheme, isDark } = useTheme();

  if (variant === 'login') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={`theme-toggle-btn login-theme-toggle ${className}`}
        title={isDark ? 'Switch to Normal White Theme' : 'Switch to Pitch Black Dark Theme'}
        aria-label={isDark ? 'Switch to Normal White Theme' : 'Switch to Pitch Black Dark Theme'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 12px',
          borderRadius: 20,
          background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(0, 0, 0, 0.12)',
          color: isDark ? '#f8fafc' : 'var(--slate-900)',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          backdropFilter: 'blur(8px)',
        }}
      >
        {isDark ? (
          <>
            <Sun size={15} color="#fbbf24" strokeWidth={2.2} />
            <span>Light Theme</span>
          </>
        ) : (
          <>
            <Moon size={15} color="#3b82f6" strokeWidth={2.2} />
            <span>Dark Theme</span>
          </>
        )}
      </button>
    );
  }

  // Header / Topbar variant
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`icon-btn theme-toggle-btn ${className}`}
      title={isDark ? 'Switch to Normal White Theme' : 'Switch to Pitch Black Dark Theme'}
      aria-label={isDark ? 'Switch to Normal White Theme' : 'Switch to Pitch Black Dark Theme'}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s ease',
      }}
    >
      {isDark ? (
        <Sun size={18} color="#fbbf24" strokeWidth={2.2} />
      ) : (
        <Moon size={18} color="#3b82f6" strokeWidth={2.2} />
      )}
      {showLabel && (
        <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 500 }}>
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </span>
      )}
    </button>
  );
}
