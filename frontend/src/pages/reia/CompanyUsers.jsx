import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client.js';
import { functionalConsented } from '../../gigw/CookieConsent.jsx';
import { PageHeader, Card, Badge } from '../../components/ui.jsx';
import Team from '../shared/Team.jsx';
import { Search, X, Building2, Users, Check, ArrowRight, Clock, RotateCcw } from 'lucide-react';

const RECENT_KEY = 'sjvn_recent_company_ids';

function getStoredRecentIds() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredRecentId(id) {
  // Kept only with functionality consent (DBIM v3 s.7.6.3.2).
  if (!functionalConsented()) return getStoredRecentIds();
  try {
    const prev = getStoredRecentIds().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

// A seller's or buyer's users, opened from SJVN's side. Inside a company its
// admin runs the team; nobody there can reset or switch off the admin's own
// account, so that falls to SJVN's administrators here.
export default function CompanyUsers() {
  const [companies, setCompanies] = useState(null);
  const [entityId, setEntityId] = useState('');
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filterType, setFilterType] = useState('ALL');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isSwitching, setIsSwitching] = useState(false);
  const [recentIds, setRecentIds] = useState(() => getStoredRecentIds());

  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.team.companies()
      .then(setCompanies)
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  // Close suggestions popover when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedCompany = useMemo(() => {
    if (!entityId || !companies) return null;
    return companies.find((c) => c.id === entityId) || null;
  }, [entityId, companies]);

  const recentCompanies = useMemo(() => {
    if (!companies || recentIds.length === 0) return [];
    return recentIds
      .map((id) => companies.find((c) => c.id === id))
      .filter(Boolean);
  }, [companies, recentIds]);

  const displayGridCompanies = useMemo(() => {
    if (!companies) return [];
    if (recentCompanies.length === 0) {
      return companies.slice(0, 9);
    }
    const recentSet = new Set(recentCompanies.map((c) => c.id));
    const others = companies.filter((c) => !recentSet.has(c.id));
    return [...recentCompanies, ...others].slice(0, Math.max(9, recentCompanies.length));
  }, [companies, recentCompanies]);

  const filteredCompanies = useMemo(() => {
    if (!companies) return [];
    let list = companies;
    if (filterType !== 'ALL') {
      list = list.filter((c) => c.entity_type === filterType);
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      if (recentIds.length > 0) {
        const recentSet = new Set(recentIds);
        const recents = recentIds
          .map((id) => list.find((c) => c.id === id))
          .filter(Boolean);
        const others = list.filter((c) => !recentSet.has(c.id));
        return [...recents, ...others];
      }
      return list;
    }
    const matches = list.filter((c) => {
      const nameMatch = (c.name || '').toLowerCase().includes(q);
      const idMatch = (c.id || '').toLowerCase().includes(q);
      const typeMatch = (c.entity_type || '').toLowerCase().includes(q);
      return nameMatch || idMatch || typeMatch;
    });
    if (recentIds.length > 0) {
      const recentIndexMap = new Map(recentIds.map((id, idx) => [id, idx]));
      return matches.sort((a, b) => {
        const aRecent = recentIndexMap.has(a.id);
        const bRecent = recentIndexMap.has(b.id);
        if (aRecent && !bRecent) return -1;
        if (!aRecent && bRecent) return 1;
        if (aRecent && bRecent) return recentIndexMap.get(a.id) - recentIndexMap.get(b.id);
        return 0;
      });
    }
    return matches;
  }, [companies, searchQuery, filterType, recentIds]);

  const sellersCount = (companies || []).filter((c) => c.entity_type === 'SELLER').length;
  const buyersCount = (companies || []).filter((c) => c.entity_type === 'BUYER').length;

  function handleSelect(company) {
    setEntityId(company.id);
    const updated = saveStoredRecentId(company.id);
    setRecentIds(updated);
    setSearchQuery('');
    setIsOpen(false);
    setIsSwitching(false);
    setFocusedIndex(-1);
  }

  function handleClearRecent(e) {
    e?.stopPropagation?.();
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {}
    setRecentIds([]);
  }

  function handleKeyDown(e) {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev < filteredCompanies.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev > 0 ? prev - 1 : filteredCompanies.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < filteredCompanies.length) {
        handleSelect(filteredCompanies[focusedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Company Users"
        subtitle="Manage users, access levels, passwords, and permissions across sellers and buyers"
      />

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Selected Company Bar (Active context) */}
      {selectedCompany && !isSwitching ? (
        <div style={{
          background: 'linear-gradient(135deg, var(--surface) 0%, var(--slate-50) 100%)',
          border: '1px solid var(--slate-200, var(--slate-200))',
          borderRadius: 12,
          padding: '14px 20px',
          marginBottom: 20,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {selectedCompany.logo_url ? (
              <img
                src={selectedCompany.logo_url}
                alt={selectedCompany.name}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  objectFit: 'contain',
                  background: 'var(--surface)',
                  border: '1px solid var(--slate-200)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                  flexShrink: 0,
                }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: selectedCompany.entity_type === 'SELLER'
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              color: '#fff',
              display: selectedCompany.logo_url ? 'none' : 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 700,
              boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
              flexShrink: 0,
            }}>
              {selectedCompany.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--slate-900)' }}>
                  {selectedCompany.name}
                </span>
                <span style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: selectedCompany.entity_type === 'SELLER' ? 'var(--t-green-50)' : 'var(--t-blue-50)',
                  color: selectedCompany.entity_type === 'SELLER' ? 'var(--on-green)' : 'var(--on-blue)',
                  border: `1px solid ${selectedCompany.entity_type === 'SELLER' ? 'var(--t-green-100)' : 'var(--t-blue-line)'}`,
                }}>
                  {selectedCompany.entity_type === 'SELLER' ? 'Seller' : 'Buyer'}
                </span>
              </div>
              <div style={{ fontSize: 15, color: 'var(--slate-500)', marginTop: 2, display: 'flex', gap: 12 }}>
                <span>{selectedCompany.active_users} active user{selectedCompany.active_users === 1 ? '' : 's'}</span>
                <span>•</span>
                <span>ID: {selectedCompany.id}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setIsSwitching(true);
                setIsOpen(true);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            >
              <Search size={14} /> Switch Company
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                setEntityId('');
                setSearchQuery('');
                setIsSwitching(false);
              }}
              title="Clear selection"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        /* Search & Suggest Combobox */
        <div ref={containerRef} style={{ position: 'relative', marginBottom: 24 }}>
          {/* Quick Filter Chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--slate-500)' }}>Filter:</span>
            {[
              { key: 'ALL', label: `All (${(companies || []).length})` },
              { key: 'SELLER', label: `Sellers (${sellersCount})` },
              { key: 'BUYER', label: `Buyers (${buyersCount})` },
            ].map((f) => (
              <button
                key={f.key}
                type="button"
                className={`nb-chip ${filterType === f.key ? 'active' : ''}`}
                onClick={() => setFilterType(f.key)}
                style={{ padding: '3px 10px', fontSize: 15 }}
              >
                {f.label}
              </button>
            ))}
            {isSwitching && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIsSwitching(false)}
                style={{ marginLeft: 'auto', fontSize: 15 }}
              >
                Cancel switch
              </button>
            )}
          </div>

          {/* Search Input Box */}
          <div style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            background: 'var(--surface)',
            border: isOpen ? '1.5px solid #2563eb' : '1.5px solid var(--slate-300, var(--slate-300))',
            borderRadius: 10,
            padding: '10px 14px',
            boxShadow: isOpen ? '0 0 0 3px rgba(37,99,235,0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.2s ease',
          }}>
            <Search size={18} color="var(--slate-400)" style={{ flexShrink: 0, marginRight: 10 }} />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsOpen(true);
                setFocusedIndex(0);
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Type to search company by name or code (e.g. Sunrise Solar, HPSEB, Discom)..."
              style={{
                border: 'none',
                outline: 'none',
                width: '100%',
                fontSize: 15.5,
                fontWeight: 500,
                color: 'var(--slate-900)',
                background: 'transparent',
              }}
              aria-label="Search company"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  inputRef.current?.focus();
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: 'var(--slate-400)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Suggestion Popover Dropdown */}
          {isOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              zIndex: 99,
              background: 'var(--surface)',
              borderRadius: 12,
              border: '1px solid var(--slate-200, var(--slate-200))',
              boxShadow: '0 12px 32px rgba(15,23,42,0.15), 0 4px 12px rgba(15,23,42,0.08)',
              maxHeight: 380,
              overflowY: 'auto',
            }}>
              <div style={{
                padding: '8px 14px',
                fontSize: 14.5,
                fontWeight: 600,
                color: 'var(--slate-400)',
                background: 'var(--slate-50, var(--slate-50))',
                borderBottom: '1px solid var(--slate-100, var(--slate-100))',
                display: 'flex',
                justifyContent: 'space-between',
              }}>
                <span>
                  {!searchQuery && recentIds.length > 0
                    ? `Recent searches & stakeholders (${filteredCompanies.length})`
                    : `Matching stakeholders (${filteredCompanies.length})`}
                </span>
                <span>Use ↑ ↓ to navigate, Enter to select</span>
              </div>

              {filteredCompanies.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--slate-500)', fontSize: 15 }}>
                  No companies found matching "<strong>{searchQuery}</strong>". Try a different name or clear the filter.
                </div>
              ) : (
                <div style={{ padding: '4px 0' }}>
                  {filteredCompanies.map((c, index) => {
                    const isSelected = c.id === entityId;
                    const isFocused = index === focusedIndex;
                    return (
                      <div
                        key={c.id}
                        onClick={() => handleSelect(c)}
                        onMouseEnter={() => setFocusedIndex(index)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 16px',
                          cursor: 'pointer',
                          background: isFocused ? 'var(--t-blue-50)' : isSelected ? 'var(--slate-50)' : 'transparent',
                          transition: 'background 0.15s ease',
                          borderBottom: '1px solid var(--slate-50, var(--slate-50))',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {c.logo_url ? (
                            <img
                              src={c.logo_url}
                              alt={c.name}
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                objectFit: 'contain',
                                background: 'var(--surface)',
                                border: '1px solid var(--slate-200)',
                                flexShrink: 0,
                              }}
                              onError={(e) => {
                                e.target.style.display = 'none';
                                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: c.entity_type === 'SELLER'
                              ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                              : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                            color: '#fff',
                            display: c.logo_url ? 'none' : 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 14.5,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}>
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--slate-900)' }}>
                              {c.name}
                            </div>
                            <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>
                              {c.id}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {recentIds.includes(c.id) && (
                            <span style={{
                              fontSize: 14,
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'var(--t-blue-50)',
                              color: 'var(--on-blue)',
                              border: '1px solid var(--t-blue-line)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}>
                              <Clock size={10} /> Recent
                            </span>
                          )}
                          <span style={{
                            fontSize: 14.5,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: c.entity_type === 'SELLER' ? 'var(--t-green-50)' : 'var(--t-blue-50)',
                            color: c.entity_type === 'SELLER' ? 'var(--on-green)' : 'var(--on-blue)',
                          }}>
                            {c.entity_type === 'SELLER' ? 'Seller' : 'Buyer'}
                          </span>
                          <span style={{ fontSize: 15, color: 'var(--slate-500)', fontWeight: 500 }}>
                            {c.active_users} active
                          </span>
                          {isSelected && <Check size={16} color="#059669" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Content: Either the selected company's Team desk, or Quick Pick grid */}
      {entityId ? (
        <Team key={entityId} entityId={entityId} />
      ) : (
        <Card>
          <div style={{ padding: '24px 20px' }}>
            <div style={{
              marginBottom: 18,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--slate-900)', margin: 0 }}>
                    {recentCompanies.length > 0 ? 'Recently accessed & quick select' : 'Quick select a stakeholder'}
                  </h3>
                  {recentCompanies.length > 0 && (
                    <span style={{
                      fontSize: 14.5,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'var(--t-blue-50)',
                      color: 'var(--on-blue)',
                      border: '1px solid var(--t-blue-line)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}>
                      <Clock size={11} /> {recentCompanies.length} recent
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 14.5, color: 'var(--slate-500)', margin: '4px 0 0' }}>
                  {recentCompanies.length > 0
                    ? 'Updated automatically based on your recent searches. Click any company or use search above.'
                    : 'Click any company below or use the search box above to instantly inspect users, levels, and credentials.'}
                </p>
              </div>

              {recentCompanies.length > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-xs"
                  onClick={handleClearRecent}
                  style={{
                    fontSize: 14.5,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    color: 'var(--slate-600)',
                  }}
                  title="Clear recent searches history"
                >
                  <RotateCcw size={12} /> Clear recent
                </button>
              )}
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}>
              {displayGridCompanies.map((c) => {
                const isRecent = recentIds.includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => handleSelect(c)}
                    style={{
                      border: isRecent ? '1.5px solid #93c5fd' : '1px solid var(--slate-200, var(--slate-200))',
                      borderRadius: 10,
                      padding: '12px 14px',
                      cursor: 'pointer',
                      background: isRecent ? 'linear-gradient(135deg, var(--surface) 0%, var(--surface) 100%)' : 'var(--surface)',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      boxShadow: isRecent ? '0 1px 4px rgba(37,99,235,0.06)' : 'none',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#2563eb';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(37,99,235,0.1)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = isRecent ? '#93c5fd' : 'var(--slate-200, #e2e8f0)';
                      e.currentTarget.style.boxShadow = isRecent ? '0 1px 4px rgba(37,99,235,0.06)' : 'none';
                      e.currentTarget.style.transform = 'none';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      {c.logo_url ? (
                        <img
                          src={c.logo_url}
                          alt={c.name}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            objectFit: 'contain',
                            background: 'var(--surface)',
                            border: '1px solid var(--slate-200)',
                            flexShrink: 0,
                          }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: c.entity_type === 'SELLER'
                          ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                          : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                        color: '#fff',
                        display: c.logo_url ? 'none' : 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14.5,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: 'var(--slate-900)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {c.name}
                        </div>
                        <div style={{
                          fontSize: 14.5,
                          color: 'var(--slate-500)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 2,
                        }}>
                          <span>{c.active_users} active user{c.active_users === 1 ? '' : 's'}</span>
                          {isRecent && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              fontSize: 14,
                              color: 'var(--on-blue)',
                              fontWeight: 600,
                              background: 'var(--t-blue-50)',
                              padding: '1px 5px',
                              borderRadius: 4,
                            }}>
                              <Clock size={10} /> Recent
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ArrowRight size={15} color="var(--slate-400)" style={{ flexShrink: 0, marginLeft: 8 }} />
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
