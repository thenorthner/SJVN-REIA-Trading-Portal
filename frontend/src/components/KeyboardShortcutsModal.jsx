import React, { useState, useEffect, useRef } from 'react';
import { Keyboard, X, Search, Eye, Volume2, Moon, Globe, ArrowDownUp, CornerDownLeft, Command, ShieldCheck } from 'lucide-react';
import { useGigw } from '../gigw/GigwContext.jsx';

export const SHORTCUTS_OPEN_EVENT = 'sjvn:open-shortcuts';

export function openKeyboardShortcuts() {
  window.dispatchEvent(new CustomEvent(SHORTCUTS_OPEN_EVENT));
}

const SHORTCUT_GROUPS = [
  {
    id: 'nav',
    groupTitle: { en: 'Navigation & Discovery', hi: 'नेविगेशन एवं खोज' },
    shortcuts: [
      {
        keys: ['⌘', 'K'],
        altKeys: ['Ctrl', 'K'],
        action: { en: 'Spotlight Quick Search (CERC docs, Tenders, Forms, Desks)', hi: 'स्पॉटलाइट खोज (सीईआरसी दस्तावेज, निविदा, फॉर्म, डेस्क)' },
        icon: Search
      },
      {
        keys: ['?'],
        altKeys: ['Shift', '/'],
        action: { en: 'Open Keyboard Shortcuts Cheat Sheet (This Dialog)', hi: 'कीबोर्ड शॉर्टकट सहायता खोलें (यह संवाद)' },
        icon: Keyboard
      },
      {
        keys: ['Alt', '1'],
        altKeys: ['Alt', 'S'],
        action: { en: 'Skip to Main Content (Bypass Header)', hi: 'मुख्य सामग्री पर सीधे जाएं (हेडर छोड़ें)' },
        icon: CornerDownLeft
      },
      {
        keys: ['Esc'],
        altKeys: [],
        action: { en: 'Close active modal, search overlay or dropdown', hi: 'सक्रिय संवाद, खोज विंडो अथवा मेनू बंद करें' },
        icon: X
      }
    ]
  },
  {
    id: 'a11y',
    groupTitle: { en: 'GIGW 3.0 Accessibility & Display', hi: 'सुगमता एवं प्रदर्शन नियंत्रण' },
    shortcuts: [
      {
        keys: ['Alt', 'A'],
        altKeys: [],
        action: { en: 'Cycle Text Size (Normal A → Large A+ → Small A-)', hi: 'फ़ॉन्ट आकार चक्र (सामान्य A → बड़ा A+ → छोटा A-)' },
        icon: Eye
      },
      {
        keys: ['Alt', 'C'],
        altKeys: [],
        action: { en: 'Toggle High Contrast Mode (Black & Yellow Palette)', hi: 'उच्च कंट्रास्ट मोड चालू / बंद करें' },
        icon: ShieldCheck
      },
      {
        keys: ['Alt', 'L'],
        altKeys: [],
        action: { en: 'Switch Portal Language (English ↔ हिन्दी)', hi: 'पोर्टल भाषा बदलें (English ↔ हिन्दी)' },
        icon: Globe
      },
      {
        keys: ['Alt', 'T'],
        altKeys: [],
        action: { en: 'Toggle Theme (Light / Dark Interface Mode)', hi: 'थीम बदलें (लाइट / डार्क मोड)' },
        icon: Moon
      },
      {
        keys: ['Alt', 'U'],
        altKeys: [],
        action: { en: 'UX4G Text-to-Speech (Listen / सुनें Screen Reader)', hi: 'UX4G ऑडियो वाचक खोलें (सुनें / बोलकर पढ़ें)' },
        icon: Volume2
      }
    ]
  },
  {
    id: 'dialogs',
    groupTitle: { en: 'Spotlight & Modal Controls', hi: 'खोज एवं संवाद नियंत्रण' },
    shortcuts: [
      {
        keys: ['↑', '↓'],
        altKeys: [],
        action: { en: 'Navigate through spotlight search results list', hi: 'खोज परिणामों में ऊपर या नीचे जाएं' },
        icon: ArrowDownUp
      },
      {
        keys: ['↵ Enter'],
        altKeys: [],
        action: { en: 'Open or activate highlighted search result or button', hi: 'चयनित परिणाम या बटन खोलें' },
        icon: CornerDownLeft
      },
      {
        keys: ['Tab'],
        altKeys: ['Shift', 'Tab'],
        action: { en: 'Advance focus forward / backward through elements', hi: 'पृष्ठ तत्वों के बीच आगे / पीछे फोकस करें' },
        icon: Command
      }
    ]
  }
];

export default function KeyboardShortcutsModal({ open: controlledOpen, onClose: controlledOnClose }) {
  const { lang } = useGigw();
  const modalRef = useRef(null);
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const handleClose = () => {
    if (isControlled) {
      controlledOnClose?.();
    } else {
      setInternalOpen(false);
    }
  };

  useEffect(() => {
    const handleOpen = () => setInternalOpen(true);
    window.addEventListener(SHORTCUTS_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(SHORTCUTS_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className="shortcuts-modal-overlay" 
      onClick={handleClose}
      role="presentation"
    >
      <div 
        ref={modalRef}
        className="shortcuts-modal-dialog" 
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
      >
        {/* Header */}
        <div className="shortcuts-modal-header">
          <div className="shortcuts-modal-title-wrap">
            <div className="shortcuts-icon-pill">
              <Keyboard size={20} />
            </div>
            <div>
              <h2 id="shortcuts-modal-title">
                {lang === 'hi' ? 'कीबोर्ड शॉर्टकट निर्देशिका' : 'Keyboard Shortcuts Cheat Sheet'}
              </h2>
              <p className="shortcuts-modal-subtitle">
                {lang === 'hi' 
                  ? 'GIGW 3.0 एवं UX4G अनुरूप त्वरित कीबोर्ड संचालन' 
                  : 'Fast navigation & accessibility controls conforming to GIGW 3.0 & UX4G'}
              </p>
            </div>
          </div>
          <button 
            type="button" 
            className="shortcuts-close-btn"
            onClick={onClose}
            aria-label={lang === 'hi' ? 'शॉर्टकट संवाद बंद करें' : 'Close shortcuts cheat sheet'}
            title={lang === 'hi' ? 'बंद करें (Esc)' : 'Close (Esc)'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body content with category cards */}
        <div className="shortcuts-modal-body">
          {SHORTCUT_GROUPS.map((group) => {
            const groupTitle = group.groupTitle[lang] || group.groupTitle.en;
            return (
              <div key={group.id} className="shortcuts-group-card">
                <h3 className="shortcuts-group-title">{groupTitle}</h3>
                <div className="shortcuts-list">
                  {group.shortcuts.map((sc, idx) => {
                    const actionText = sc.action[lang] || sc.action.en;
                    const Icon = sc.icon;
                    return (
                      <div key={idx} className="shortcuts-row">
                        <div className="shortcuts-row-desc">
                          <Icon size={14} className="shortcuts-row-icon" />
                          <span>{actionText}</span>
                        </div>
                        <div className="shortcuts-row-keys">
                          <div className="shortcuts-key-cluster">
                            {sc.keys.map((k, kIdx) => (
                              <React.Fragment key={kIdx}>
                                {kIdx > 0 && <span className="shortcuts-key-plus">+</span>}
                                <kbd className="shortcuts-kbd">{k}</kbd>
                              </React.Fragment>
                            ))}
                          </div>
                          {sc.altKeys && sc.altKeys.length > 0 && (
                            <>
                              <span className="shortcuts-key-or">/</span>
                              <div className="shortcuts-key-cluster">
                                {sc.altKeys.map((ak, akIdx) => (
                                  <React.Fragment key={akIdx}>
                                    {akIdx > 0 && <span className="shortcuts-key-plus">+</span>}
                                    <kbd className="shortcuts-kbd">{ak}</kbd>
                                  </React.Fragment>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="shortcuts-modal-footer">
          <div className="shortcuts-footer-hint">
            <span>
              {lang === 'hi' 
                ? 'सुझाव: पोर्टल पर किसी भी समय ? दबाकर यह विंडो दोबारा खोल सकते हैं।' 
                : 'Tip: Press ? anytime on the portal to reopen this shortcuts cheat sheet.'}
            </span>
          </div>
          <button 
            type="button" 
            className="shortcuts-modal-done-btn"
            onClick={onClose}
          >
            {lang === 'hi' ? 'समझ गया (Done)' : 'Close & Return (Esc)'}
          </button>
        </div>
      </div>
    </div>
  );
}
