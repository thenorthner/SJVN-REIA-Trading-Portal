import React from 'react';

/**
 * A hidden SVG component that defines premium gradients for use in Recharts across the portal.
 * Use these by referencing their IDs in the fill attribute, e.g. fill="url(#eliteBlue)"
 */
export function EliteChartGradients() {
  return (
    <svg style={{ width: 0, height: 0, position: 'absolute' }} aria-hidden="true">
      <defs>
        {/* Blue Gradient: Electric Blue to Deep Indigo */}
        <linearGradient id="eliteBlue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.9} />
          <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0.9} />
        </linearGradient>

        {/* Green Gradient: Emerald to Teal */}
        <linearGradient id="eliteGreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#10b981" stopOpacity={0.9} />
          <stop offset="95%" stopColor="#065f46" stopOpacity={0.9} />
        </linearGradient>

        {/* Orange/Amber Gradient */}
        <linearGradient id="eliteOrange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.9} />
          <stop offset="95%" stopColor="#9a3412" stopOpacity={0.9} />
        </linearGradient>

        {/* Purple/Violet Gradient */}
        <linearGradient id="elitePurple" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.9} />
          <stop offset="95%" stopColor="#4c1d95" stopOpacity={0.9} />
        </linearGradient>

        {/* Teal/Cyan Gradient */}
        <linearGradient id="eliteTeal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.9} />
          <stop offset="95%" stopColor="#134e4a" stopOpacity={0.9} />
        </linearGradient>

        {/* Red/Crimson Gradient */}
        <linearGradient id="eliteRed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.9} />
          <stop offset="95%" stopColor="#7f1d1d" stopOpacity={0.9} />
        </linearGradient>

        {/* Grey/Slate Gradient */}
        <linearGradient id="eliteSlate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#64748b" stopOpacity={0.9} />
          <stop offset="95%" stopColor="#334155" stopOpacity={0.9} />
        </linearGradient>

        {/* Dark Grey Gradient */}
        <linearGradient id="eliteDark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#334155" stopOpacity={0.9} />
          <stop offset="95%" stopColor="#0f172a" stopOpacity={0.9} />
        </linearGradient>
      </defs>
    </svg>
  );
}
