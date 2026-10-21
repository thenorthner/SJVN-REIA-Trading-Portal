import React from 'react';
import { WifiOff, PhoneCall, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../pwa.js';
import { useGigw } from '../gigw/GigwContext.jsx';

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const { lang } = useGigw();

  if (isOnline) {
    return null;
  }

  return (
    <div className="gigw-offline-banner" role="status" aria-live="polite">
      <div className="gigw-offline-content">
        <div className="gigw-offline-msg">
          <WifiOff size={16} className="offline-icon" aria-hidden="true" />
          <span>
            {lang === 'hi'
              ? 'ऑफ़लाइन मोड: आप इंटरनेट से कनेक्ट नहीं हैं। कैश्ड डेटा और आपातकालीन संपर्क उपलब्ध हैं।'
              : lang === 'gu'
              ? 'ઑફલાઇન મોડ: ઇન્ટરનેટ કનેક્શન નથી. કેશ્ડ ડેટા અને કટોકટી સંપર્ક ઉપલબ્ધ છે.'
              : lang === 'mr'
              ? 'ऑफलाइन मोड: इंटरनेट कनेक्शन उपलब्ध नाही. कॅश केलेला डेटा आणि आणीबाणी संपर्क उपलब्ध आहेत.'
              : 'Offline Mode: You are disconnected from the network. Serving cached assets and emergency contacts.'}
          </span>
        </div>
        <div className="gigw-offline-actions">
          <a href="/offline.html" className="offline-btn-directory">
            <PhoneCall size={13} aria-hidden="true" />
            <span>{lang === 'hi' ? 'आपातकालीन निर्देशिका' : 'Emergency Directory'}</span>
          </a>
          <button
            type="button"
            className="offline-btn-reload"
            onClick={() => window.location.reload()}
            title="Retry network connection"
          >
            <RefreshCw size={13} aria-hidden="true" />
            <span>{lang === 'hi' ? 'पुनः प्रयास' : 'Retry'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
