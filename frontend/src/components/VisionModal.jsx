import React, { useEffect, useRef } from 'react';
import { X, Target, Compass, Sparkles, Leaf, Users, Lightbulb, TrendingUp, ShieldCheck, Award } from 'lucide-react';
import { useGigw } from '../gigw/GigwContext.jsx';

export const VISION_OPEN_EVENT = 'sjvn:open-vision';

export function openVisionModal() {
  window.dispatchEvent(new CustomEvent(VISION_OPEN_EVENT));
}

export const OFFICIAL_VISION = {
  vision: {
    en: 'To be a best-in-class Indian Power Company globally admired for developing affordable clean power and creating sustainable value for all stakeholders.',
    hi: 'भारतीय विद्युत क्षेत्र की सर्वश्रेष्ठ कंपनी बनने की दिशा में निरंतर प्रयासरत रहना तथा स्वच्छ और किफायती विद्युत उत्पादन करते हुए सभी हितधारकों के लिए सतत मूल्य सृजन करने वाली कंपनी के रूप में वैश्विक स्तर पर सराहना प्राप्त करना।',
  },
  missionIntro: {
    en: "To drive socio-economic growth and optimize shareholders' and stakeholders' interest by:",
    hi: 'निम्नलिखित माध्यमों से सामाजिक-आर्थिक विकास को बढ़ावा देना तथा शेयरधारकों एवं हितधारकों के हितों का अधिकतम ध्यान रखना:',
  },
  missionPillars: [
    {
      icon: Leaf,
      color: '#10b981',
      title: { en: 'Eco-Friendly Projects', hi: 'पर्यावरण-अनुकूल परियोजनाएं' },
      desc: {
        en: 'Developing power projects in a cost-effective and environmentally friendly manner with minimal ecological footprint.',
        hi: 'किफायती लागत पर सामाजिक एवं पर्यावरण के अनुकूल तरीके से जल, सौर एवं पवन परियोजनाओं का निर्माण करना।',
      },
    },
    {
      icon: Users,
      color: '#3b82f6',
      title: { en: 'Nurturing Talent', hi: 'मानव संसाधन संवर्धन' },
      desc: {
        en: 'Nurturing human resource talent through transparent empowerment, professional safety, and a growth-oriented work culture.',
        hi: 'समर्पित भाव एवं संवेदनशीलता के साथ मानव प्रतिभा का पोषण करना और विकासोन्मुखी कार्य संस्कृति का निर्माण करना।',
      },
    },
    {
      icon: Lightbulb,
      color: '#f59e0b',
      title: { en: 'Innovative Technology', hi: 'नवोन्मेषी प्रौद्योगिकी' },
      desc: {
        en: 'Adopting state-of-the-art engineering practices, digital energy commerce, and cutting-edge operational technologies.',
        hi: 'प्रौद्योगिकी उत्कृष्टता के लिए नवोन्मेषी पद्धतियों, डिजिटल ऊर्जा वाणिज्य एवं आधुनिक तकनीकों को अपनाना।',
      },
    },
    {
      icon: TrendingUp,
      color: '#8b5cf6',
      title: { en: 'Growth & Diversification', hi: 'सतत विकास एवं विविधीकरण' },
      desc: {
        en: 'Accelerating portfolio expansion across Hydro, Solar, Wind, Thermal, and Power Trading to emerge as a global green utility.',
        hi: 'जल, सौर, पवन, ताप विद्युत एवं विद्युत व्यापार में क्षमता विस्तार और सतत विविधीकरण पर विशेष बल देना।',
      },
    },
  ],
  sharedTargets: [
    { year: '2030', capacity: '25,000 MW', label: { en: 'Clean Energy Target', hi: 'स्वच्छ ऊर्जा लक्ष्य' } },
    { year: '2040', capacity: '50,000 MW', label: { en: 'Shared Horizon Vision', hi: 'दीर्घकालिक साझा विज़न' } },
  ],
  coreValues: [
    { key: 'integrity', label: { en: 'Integrity', hi: 'सत्यनिष्ठा' }, desc: { en: 'Highest ethics in energy trading & statutory governance', hi: 'ऊर्जा व्यापार एवं शासन में सर्वोच्च नैतिक मानक' } },
    { key: 'teamwork', label: { en: 'Teamwork', hi: 'टीम भावना' }, desc: { en: 'Collaborative synergy with state utilities & RE developers', hi: 'राज्य डिस्कॉम एवं विकासकर्ताओं के साथ सहयोगी तालमेल' } },
    { key: 'care', label: { en: 'Care', hi: 'संवेदनशीलता' }, desc: { en: 'Commitment to community welfare and ecological balance', hi: 'सामुदायिक कल्याण एवं पारिस्थितिकी के प्रति प्रतिबद्धता' } },
    { key: 'excellence', label: { en: 'Excellence', hi: 'उत्कृष्टता' }, desc: { en: 'Benchmark plant availability & commercial precision', hi: 'मानक संयंत्र उपलब्धता एवं सटीक वाणिज्यिक निपटान' } },
    { key: 'innovation', label: { en: 'Innovation', hi: 'नवाचार' }, desc: { en: 'Smart market bidding and REIA automated workflows', hi: 'स्मार्ट बाज़ार बोली एवं आरईआईए स्वचालित कार्यप्रवाह' } },
  ],
};

export default function VisionModal({ open, onClose }) {
  const { lang } = useGigw();
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="vision-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vision-modal-title"
    >
      <div className="vision-modal-container" ref={modalRef}>
        {/* Header Strip */}
        <div className="vision-modal-header">
          <div className="vision-modal-brand">
            <img src="/sjvn-logo.png" alt="SJVN Logo" className="vision-logo" width="40" height="40" />
            <div>
              <span className="vision-org-tag">
                {lang === 'hi' ? 'एसजेवीएन लिमिटेड (नवरत्न सीपीएसई · भारत सरकार)' : 'SJVN Limited (A Navratna CPSE · Govt. of India)'}
              </span>
              <h2 id="vision-modal-title" className="vision-title">
                {lang === 'hi' ? 'हमारी दूरदृष्टि एवं ध्येय (Vision & Mission)' : 'Our Corporate Vision & Mission'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="vision-close-btn"
            onClick={onClose}
            aria-label={lang === 'hi' ? 'बंद करें' : 'Close'}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="vision-modal-body">
          {/* Main Vision Quote Box */}
          <div className="vision-quote-card">
            <div className="vision-badge">
              <Compass size={14} />
              <span>{lang === 'hi' ? 'आधिकारिक दूरदृष्टि (Vision)' : 'Official Corporate Vision'}</span>
            </div>
            <blockquote className="vision-quote-text">
              “{OFFICIAL_VISION.vision[lang]}”
            </blockquote>
            <div className="vision-quote-footer">
              <span className="vision-quote-source">
                — {lang === 'hi' ? 'एसजेवीएन लिमिटेड आधिकारिक कॉर्पोरेट जनादेश' : 'Official Corporate Mandate · SJVN Limited (sjvn.nic.in)'}
              </span>
            </div>
          </div>

          {/* Mission Section */}
          <div className="vision-section">
            <div className="vision-section-heading">
              <Target size={18} className="text-primary" />
              <h3>{lang === 'hi' ? 'हमारा मिशन (Our Mission)' : 'Our Corporate Mission'}</h3>
            </div>
            <p className="vision-section-lead">{OFFICIAL_VISION.missionIntro[lang]}</p>

            <div className="vision-pillars-grid">
              {OFFICIAL_VISION.missionPillars.map((p, idx) => {
                const Icon = p.icon;
                return (
                  <div key={idx} className="vision-pillar-card">
                    <div className="vision-pillar-icon" style={{ backgroundColor: `${p.color}18`, color: p.color }}>
                      <Icon size={20} />
                    </div>
                    <div>
                      <h4 className="vision-pillar-title">{p.title[lang]}</h4>
                      <p className="vision-pillar-desc">{p.desc[lang]}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Shared Vision Milestones (Targets) */}
          <div className="vision-targets-row">
            <div className="vision-targets-info">
              <Sparkles size={18} className="text-amber" />
              <strong>{lang === 'hi' ? 'राष्ट्रीय क्षमता लक्ष्य (Capacity Targets):' : 'National Clean Energy Targets:'}</strong>
            </div>
            <div className="vision-targets-badges">
              {OFFICIAL_VISION.sharedTargets.map((st) => (
                <div key={st.year} className="vision-target-pill">
                  <span className="target-year">{st.year}</span>
                  <strong className="target-cap">{st.capacity}</strong>
                  <span className="target-desc">{st.label[lang]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Shared Values */}
          <div className="vision-values-section">
            <h4 className="vision-values-title">
              <ShieldCheck size={16} />
              <span>{lang === 'hi' ? 'हमारे मूल मंत्र एवं मूल्य (Core Values)' : 'Core Organizational Values'}</span>
            </h4>
            <div className="vision-values-grid">
              {OFFICIAL_VISION.coreValues.map((v) => (
                <div key={v.key} className="vision-value-item">
                  <span className="value-dot" />
                  <div>
                    <strong>{v.label[lang]}</strong>
                    <span className="value-sub">{v.desc[lang]}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="vision-modal-footer">
          <span className="vision-footer-status">
            ✓ {lang === 'hi' ? 'भारत के ऊर्जा संक्रमण हेतु आधिकारिक रूप से संरेखित' : 'Formally aligned with India’s 500 GW Non-Fossil Commitment by 2030'}
          </span>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {lang === 'hi' ? 'समझ गया / बंद करें' : 'Acknowledge & Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
