import React, { useState, useRef, useEffect, useMemo } from 'react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/** Parse various formats (DD-MM-YYYY, DD-MMM-YYYY, YYYY-MM-DD) into ISO YYYY-MM-DD */
export function toIsoDate(val) {
  if (!val) return null;
  val = String(val).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(val)) {
    const [d, m, y] = val.split('-');
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }
  const parts = val.split('-');
  if (parts.length === 3) {
    const d = parts[0].padStart(2, '0');
    const mStr = parts[1].toLowerCase().slice(0, 3);
    const y = parts[2];
    if (MONTH_MAP[mStr] !== undefined) {
      const m = String(MONTH_MAP[mStr] + 1).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return null;
}

/** Format YYYY-MM-DD into DD-MM-YYYY */
export function toDisplayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** Format YYYY-MM-DD into DD-MMM-YYYY */
export function toChartDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  return `${d}-${SHORT_MONTHS[monthIdx]}-${y}`;
}

export default function MarketDatePicker({
  label,
  value,
  onChange,
  availableDates = [],
  minDate,
  maxDate,
  placeholder = 'DD-MM-YYYY'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Parse current value to ISO
  const currentIso = useMemo(() => toIsoDate(value), [value]);

  // Set of available ISO date strings for O(1) lookup
  const availableSet = useMemo(() => {
    const set = new Set();
    for (const d of availableDates) {
      const iso = toIsoDate(d);
      if (iso) set.add(iso);
    }
    return set;
  }, [availableDates]);

  // Determine initial calendar view month & year
  const initialDate = useMemo(() => {
    if (currentIso) {
      const [y, m] = currentIso.split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    if (availableSet.size > 0) {
      const first = Array.from(availableSet).sort()[0];
      const [y, m] = first.split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    return { year: 2026, month: 7 }; // August 2026 default
  }, [currentIso, availableSet]);

  const [viewYear, setViewYear] = useState(initialDate.year);
  const [viewMonth, setViewMonth] = useState(initialDate.month);

  // Sync calendar view if value changes externally
  useEffect(() => {
    if (currentIso) {
      const [y, m] = currentIso.split('-').map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
    }
  }, [currentIso]);

  // Close calendar on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const minIso = useMemo(() => toIsoDate(minDate), [minDate]);
  const maxIso = useMemo(() => toIsoDate(maxDate), [maxDate]);

  // Navigation handlers
  const prevMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const jumpToAvailable = (e) => {
    e.stopPropagation();
    if (availableSet.size > 0) {
      const first = Array.from(availableSet).sort()[0];
      const [y, m] = first.split('-').map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
    }
  };

  // Classic Calendar Grid Calculation (6 rows x 7 days = 42 cells)
  const daysGrid = useMemo(() => {
    const grid = [];
    const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
    const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    // 1. Preceding month filler days
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      grid.push({
        day,
        isCurrentMonth: false,
        iso: null,
        isSelectable: false,
        isSelected: false,
        key: `prev-${day}`
      });
    }

    // 2. Current month days
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const mStr = String(viewMonth + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      const iso = `${viewYear}-${mStr}-${dStr}`;

      const hasData = availableSet.has(iso);
      const isBeforeMin = minIso && iso < minIso;
      const isAfterMax = maxIso && iso > maxIso;
      const isSelectable = hasData && !isBeforeMin && !isAfterMax;
      const isSelected = currentIso === iso;

      grid.push({
        day: d,
        isCurrentMonth: true,
        iso,
        hasData,
        isSelectable,
        isSelected,
        key: iso
      });
    }

    // 3. Trailing next month filler days to complete 35 or 42 grid cells
    const remaining = (7 - (grid.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      grid.push({
        day: d,
        isCurrentMonth: false,
        iso: null,
        isSelectable: false,
        isSelected: false,
        key: `next-${d}`
      });
    }

    return grid;
  }, [viewYear, viewMonth, availableSet, minIso, maxIso, currentIso]);

  const handleSelectDay = (dayObj, e) => {
    e.stopPropagation();
    if (!dayObj.isSelectable) return;
    const display = toDisplayDate(dayObj.iso);
    onChange(display);
    setIsOpen(false);
  };

  // Count available in this month
  const availableInThisMonth = useMemo(() => {
    const prefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
    return Array.from(availableSet).filter(iso => iso.startsWith(prefix)).length;
  }, [availableSet, viewYear, viewMonth]);

  // Year choices for dropdown
  const yearOptions = [2024, 2025, 2026, 2027, 2028];

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      {label && (
        <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
          {label}
        </label>
      )}
      
      {/* Input box trigger with classic SVG calendar icon */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#ffffff',
          border: isOpen ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
          borderRadius: '6px',
          padding: '5px 9px',
          cursor: 'pointer',
          minWidth: '135px',
          height: '34px',
          boxSizing: 'border-box',
          boxShadow: isOpen ? '0 0 0 3px rgba(37, 99, 235, 0.12)' : 'none',
          transition: 'all 0.15s ease'
        }}
        title="Click to select date"
      >
        <input
          type="text"
          readOnly
          value={value || ''}
          placeholder={placeholder}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            width: '90px',
            fontSize: '13px',
            fontWeight: 500,
            color: value ? '#0f172a' : '#94a3b8',
            cursor: 'pointer'
          }}
        />
        {/* Classic crisp SVG Calendar Icon (replaces emoji) */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: '#64748b' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
      </div>

      {/* Classic Calendar Dropdown Popover */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: label ? '75px' : '0',
          zIndex: 1000,
          background: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.1)',
          width: '300px',
          boxSizing: 'border-box',
          userSelect: 'none',
          overflow: 'hidden'
        }}>
          {/* Classic Calendar Header with Navigation Controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0'
          }}>
            {/* Previous Month SVG Button */}
            <button
              type="button"
              onClick={prevMonth}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                width: '26px',
                height: '26px',
                flexShrink: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#475569',
                padding: 0
              }}
              title="Previous Month"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            {/* Classic Month and Year Dropdowns */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                value={viewMonth}
                onChange={(e) => {
                  e.stopPropagation();
                  setViewMonth(Number(e.target.value));
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '108px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#1e293b',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  padding: '3px 4px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx}>{name}</option>
                ))}
              </select>

              <select
                value={viewYear}
                onChange={(e) => {
                  e.stopPropagation();
                  setViewYear(Number(e.target.value));
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '68px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#1e293b',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  padding: '3px 4px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {yearOptions.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>

            {/* Next Month SVG Button */}
            <button
              type="button"
              onClick={nextMonth}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                width: '26px',
                height: '26px',
                flexShrink: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#475569',
                padding: 0
              }}
              title="Next Month"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Quick Notice Banner if current month has no market data */}
          {availableInThisMonth === 0 && (
            <div style={{
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              padding: '6px 12px',
              fontSize: '11px',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>No data in {MONTH_NAMES[viewMonth]}</span>
              <button
                type="button"
                onClick={jumpToAvailable}
                style={{
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '3px',
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  color: '#1d4ed8',
                  cursor: 'pointer'
                }}
              >
                Jump to Data
              </button>
            </div>
          )}

          {/* Calendar Body */}
          <div style={{ padding: '10px 12px 8px' }}>
            {/* Weekday Row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              textAlign: 'center',
              marginBottom: '6px'
            }}>
              {WEEKDAYS.map(w => (
                <div key={w} style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', padding: '2px 0' }}>
                  {w}
                </div>
              ))}
            </div>

            {/* Days Table Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '2px'
            }}>
              {daysGrid.map((item) => {
                // Adjacent month days (filler)
                if (!item.isCurrentMonth) {
                  return (
                    <div
                      key={item.key}
                      style={{
                        height: '30px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#cbd5e1',
                        fontSize: '12px',
                        cursor: 'not-allowed',
                        opacity: 0.45
                      }}
                    >
                      {item.day}
                    </div>
                  );
                }

                // Selected Day
                if (item.isSelected) {
                  return (
                    <div
                      key={item.key}
                      onClick={(e) => handleSelectDay(item, e)}
                      style={{
                        height: '30px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        background: '#2563eb',
                        border: '1px solid #2563eb',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer',
                        boxShadow: '0 1px 3px rgba(37, 99, 235, 0.35)'
                      }}
                      title={`Selected date: ${item.iso}`}
                    >
                      {item.day}
                    </div>
                  );
                }

                // Available Date with Market Data
                if (item.isSelectable) {
                  return (
                    <div
                      key={item.key}
                      onClick={(e) => handleSelectDay(item, e)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#eff6ff';
                        e.currentTarget.style.borderColor = '#3b82f6';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#f8fafc';
                        e.currentTarget.style.borderColor = '#93c5fd';
                      }}
                      style={{
                        height: '30px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        background: '#f8fafc',
                        border: '1px solid #93c5fd',
                        color: '#0f172a',
                        fontWeight: 600,
                        fontSize: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                      title={`Market Clearing Data available for ${item.iso}`}
                    >
                      {item.day}
                    </div>
                  );
                }

                // Disabled Day (No Market Data or Out of Min/Max Range)
                return (
                  <div
                    key={item.key}
                    style={{
                      height: '30px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                      color: '#94a3b8',
                      fontSize: '12px',
                      cursor: 'not-allowed',
                      opacity: 0.4
                    }}
                    title="No market clearing data available for this date"
                  >
                    {item.day}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Classic Footer / Legend */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#475569'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#2563eb', display: 'inline-block' }} />
              <span>Selected</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#f8fafc', border: '1px solid #93c5fd', display: 'inline-block' }} />
              <span>Available</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#e2e8f0', display: 'inline-block' }} />
              <span>No Data</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

