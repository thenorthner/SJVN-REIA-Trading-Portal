import React, { useState, useEffect, useCallback } from 'react';
import { ArrowUp } from 'lucide-react';
import { useGigw } from '../gigw/GigwContext.jsx';

export default function BackToTopProgress() {
  const { lang } = useGigw();
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  // Throttled scroll listener supporting both window and container scrollers
  const handleScroll = useCallback(() => {
    const pub = typeof document !== 'undefined' ? document.querySelector('.gigw-public') : null;
    const doc = typeof document !== 'undefined' ? document.documentElement : null;

    const windowScrolled = typeof window !== 'undefined' ? (window.scrollY || (doc ? doc.scrollTop : 0)) : 0;
    const pubScrolled = pub ? pub.scrollTop : 0;
    const scrolled = Math.max(windowScrolled, pubScrolled);

    const docScrollable = doc ? (doc.scrollHeight - window.innerHeight) : 0;
    const pubScrollable = pub ? (pub.scrollHeight - pub.clientHeight) : 0;
    const scrollable = Math.max(docScrollable, pubScrollable);

    if (scrolled > 250) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }

    if (scrollable > 0) {
      const pct = Math.min(100, Math.max(0, Math.round((scrolled / scrollable) * 100)));
      setProgress(pct);
    } else {
      setProgress(0);
    }
  }, []);

  useEffect(() => {
    let animationFrameId = null;

    function onScroll() {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(() => {
        handleScroll();
        animationFrameId = null;
      });
    }

    // Capture catches scroll events from window, document, or .gigw-public
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    const pub = document.querySelector('.gigw-public');
    if (pub) {
      pub.addEventListener('scroll', onScroll, { passive: true });
    }

    // Initial check
    handleScroll();

    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (pub) {
        pub.removeEventListener('scroll', onScroll);
      }
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [handleScroll]);

  function scrollToTop() {
    const prefersReducedMotion = typeof window !== 'undefined' && 
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = prefersReducedMotion ? 'auto' : 'smooth';

    if (typeof window !== 'undefined') {
      window.scrollTo({
        top: 0,
        behavior
      });
      const pub = document.querySelector('.gigw-public');
      if (pub && pub.scrollTop > 0) {
        pub.scrollTo({ top: 0, behavior });
      }
      if (document.documentElement) {
        document.documentElement.scrollTo({ top: 0, behavior });
      }
    }
  }

  // SVG parameters
  const radius = 18;
  const circumference = 2 * Math.PI * radius; // ~113.097
  const strokeDashoffset = circumference - (circumference * progress) / 100;

  const labelText = lang === 'hi' 
    ? `शीर्ष पर जाएं (${progress}% पढ़ा गया)` 
    : `Back to top (${progress}% read)`;

  return (
    <div className={`gigw-back-to-top-wrap ${isVisible ? 'is-visible' : ''}`}>
      <button
        type="button"
        className="gigw-back-to-top-btn"
        onClick={scrollToTop}
        aria-label={labelText}
        title={labelText}
      >
        {/* SVG Circular Reading Progress Ring (decorative visual) */}
        <svg 
          className="gigw-back-to-top-svg" 
          width="48" 
          height="48" 
          viewBox="0 0 48 48"
          aria-hidden="true"
        >
          {/* Background track circle */}
          <circle
            className="gigw-back-to-top-track"
            cx="24"
            cy="24"
            r={radius}
            strokeWidth="3.5"
            fill="none"
          />
          {/* Animated progress circle */}
          <circle
            className="gigw-back-to-top-indicator"
            cx="24"
            cy="24"
            r={radius}
            strokeWidth="3.5"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(-90 24 24)"
          />
        </svg>

        {/* Center Icon */}
        <div className="gigw-back-to-top-inner">
          <ArrowUp size={18} className="gigw-back-to-top-arrow" />
        </div>

        {/* Percentage badge on hover/focus */}
        <span className="gigw-back-to-top-pill" aria-hidden="true">
          {progress}%
        </span>
      </button>
    </div>
  );
}
