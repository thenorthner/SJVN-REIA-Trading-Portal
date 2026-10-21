import React, { useState, useEffect, useRef } from 'react';
import { 
  Volume2, VolumeX, Play, Pause, Square, SkipForward, SkipBack, 
  X, Check, Headphones, Sparkles, SlidersHorizontal 
} from 'lucide-react';
import { useGigw } from '../gigw/GigwContext.jsx';

export const AUDIO_SPEECH_TOGGLE_EVENT = 'sjvn:toggle-speech';

export function toggleAudioSpeech() {
  window.dispatchEvent(new CustomEvent(AUDIO_SPEECH_TOGGLE_EVENT));
}

// Structured section scripts in supported regional languages
const SPEECH_SECTIONS = [
  {
    id: 'intro',
    title: { 
      en: '1. National Identity & Sovereign Mandate', 
      hi: '1. राष्ट्रीय पहचान एवं संप्रभु अधिदेश',
      gu: '1. રાષ્ટ્રીય ઓળખ અને સત્તાવાર જનાદેશ',
      mr: '1. राष्ट्रीय ओळख व सार्वभौम जनादेश'
    },
    text: {
      en: 'SJVN Limited is a Navratna CPSE under the Ministry of Power, Government of India, and a Joint Venture with the Government of Himachal Pradesh. SJVN operates across Hydro, Thermal, Solar, and Wind generation, and serves as an official Renewable Energy Implementing Agency of India.',
      hi: 'एसजेवीएन लिमिटेड भारत सरकार के विद्युत मंत्रालय के अधीन एक नवरत्न सीपीएसई है, और हिमाचल प्रदेश सरकार के साथ संयुक्त उपक्रम है। एसजेवीएन हाइड्रो, थर्मल, सौर और पवन उत्पादन में कार्यरत है तथा भारत की आधिकारिक नवीकरणीय ऊर्जा कार्यान्वयन एजेंसी है।',
      gu: 'એસજેવીએન લિમિટેડ ભારત સરકારના ઊર્જા મંત્રાલય હેઠળની એક નવરત્ન સીપીએસઈ છે, અને હિમાચલ પ્રદેશ સરકાર સાથે સંયુક્ત સાહસ છે. એસજેવીએન ભારતની સત્તાવાર પુનઃપ્રાપ્ય ઊર્જા અમલીકરણ એજન્સી તરીકે કાર્ય કરે છે.',
      mr: 'एसजेव्हीएन लिमिटेड ही भारत सरकारच्या ऊर्जा मंत्रालयाच्या अखत्यारीतील नवरत्न सीपीएसई असून हिमाचल प्रदेश सरकारसोबतचा संयुक्त उपक्रम आहे. एसजेव्हीएन भारताची अधिकृत अक्षय ऊर्जा अंमलबजावणी संस्था म्हणून कार्य करते.'
    }
  },
  {
    id: 'desks',
    title: { 
      en: '2. Four Enterprise Operating Desks', 
      hi: '2. चार प्रमुख वाणिज्यिक परिचालन डेस्क',
      gu: '2. ચાર મુખ્ય વાણિજ્યિક ઓપરેટિંગ ડેસ્ક',
      mr: '2. चार मुख्य व्यावसायिक ऑपरेटिंग डेस्क'
    },
    text: {
      en: 'The portal hosts four core commercial operating desks. First, REIA Portal for utility-scale solar and wind procurement and 25-year PPAs. Second, Power Trading Hub for synchronized exchange trading on IEX, PXIL, and HPX across DAM, GDAM, and Real-Time Markets. Third, Hydro Commercial Desk for 1,912 megawatts of hydro generating assets at Nathpa Jhakri and Rampur. Fourth, Thermal Operations Desk for the 1,320 megawatt supercritical power station at Buxar, Bihar.',
      hi: 'पोर्टल चार मुख्य वाणिज्यिक परिचालन डेस्क होस्ट करता है। पहला, उपयोगिता-पैमाने की सौर एवं पवन ऊर्जा खरीद और 25-वर्षीय पीपीए हेतु आरईआईए पोर्टल। दूसरा, डे-अहेड और रियल-टाइम मार्केट्स में आईईएक्स, पीएक्सआईएल और एचपीएक्स पर समन्वित ऊर्जा व्यापार केंद्र। तीसरा, नाथपा झाकड़ी और रामपुर में 1,912 मेगावाट जल विद्युत परिसंपत्तियों हेतु हाइड्रो डेस्क। चौथा, बक्सर, बिहार में 1,320 मेगावाट सुपरक्रिटिकल संयंत्र हेतु ताप विद्युत डेस्क।',
      gu: 'આ પોર્ટલ ચાર મુખ્ય વાણિજ્યિક ડેસ્ક ધરાવે છે: સોલાર અને વિન્ડ ખરીદી માટે REIA પોર્ટલ, પાવર ટ્રેડિંગ હબ, હાઇડ્રો કોમર્શિયલ ડેસ્ક, અને બિહારના બક્સર ખાતે થર્મલ ઓપરેશન્સ ડેસ્ક.',
      mr: 'हे पोर्टल चार मुख्य व्यावसायिक डेस्क चालवते: सौर आणि पवन खरेदीसाठी REIA पोर्टल, ऊर्जा व्यापार केंद्र, जलविद्युत व्यावसायिक डेस्क, आणि बिहारमधील बक्सर येथील औष्णिक ऊर्जा डेस्क.'
    }
  },
  {
    id: 'assets',
    title: { 
      en: '3. Flagship Assets & Clean Energy Horizon', 
      hi: '3. प्रमुख उत्पादन परिसंपत्तियां एवं स्वच्छ ऊर्जा लक्ष्य',
      gu: '3. મુખ્ય ઉત્પાદન અસ્કયામતો અને સ્વચ્છ ઊર્જા લક્ષ્યાંક',
      mr: '3. प्रमुख उत्पादन मालमत्ता आणि स्वच्छ ऊर्जा उद्दिष्ट'
    },
    text: {
      en: 'Flagship generation assets include the 1,500 megawatt Nathpa Jhakri Hydro Station in Himachal Pradesh, the 412 megawatt Rampur Hydro Station, the 1,320 megawatt Buxar Thermal Station, and over 1,200 megawatts of operational solar parks across Gujarat, Rajasthan, and Uttar Pradesh. SJVN aims to reach 25,000 megawatts by 2030 and 50,000 megawatts by 2040.',
      hi: 'प्रमुख उत्पादन परिसंपत्तियों में हिमाचल प्रदेश में 1,500 मेगावाट नाथपा झाकड़ी हाइड्रो स्टेशन, 412 मेगावाट रामपुर हाइड्रो स्टेशन, बिहार में 1,320 मेगावाट बक्सर थर्मल स्टेशन, तथा गुजरात, राजस्थान और उत्तर प्रदेश में 1,200 मेगावाट से अधिक सौर पार्क शामिल हैं। एसजेवीएन का लक्ष्य 2030 तक 25,000 मेगावाट और 2040 तक 50,000 मेगावाट क्षमता हासिल करना है।',
      gu: 'મુખ્ય અસ્કયામતોમાં 1,500 મેગાવોટ નાથપા ઝાકરી હાઇડ્રો સ્ટેશન, 412 મેગાવોટ રામપુર સ્ટેશન, અને 1,320 મેગાવોટ બક્સર સ્ટેશન સામેલ છે. એસજેવીએનનું લક્ષ્ય 2030 સુધીમાં 25,000 મેગાવોટનું છે.',
      mr: 'प्रमुख मालमत्तांमध्ये 1,500 मेगावॅट नाथपा झाकडी हायड्रो, 412 मेगावॅट रामपूर, आणि 1,320 मेगावॅट बक्सर औष्णिक प्रकल्प समाविष्ट आहेत. एसजेव्हीएनचे 2030 पर्यंत 25,000 मेगावॅटचे उद्दिष्ट आहे.'
    }
  },
  {
    id: 'compliance',
    title: { 
      en: '4. Statutory Compliance & Accessibility', 
      hi: '4. वैधानिक अनुपालन एवं सार्वभौमिक सुगमता',
      gu: '4. વૈધાનિક પાલન અને સુગમતા',
      mr: '4. वैधानिक अनुपालन आणि सुलभता'
    },
    text: {
      en: 'All commercial operations strictly comply with CERC regulations, the Indian Electricity Grid Code 2023, the Digital Personal Data Protection Act 2023, and GIGW 3.0 accessibility standards with UX4G design guidelines.',
      hi: 'सभी वाणिज्यिक संचालन सीईआरसी विनियमों, भारतीय विद्युत ग्रिड संहिता 2023, डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम 2023 एवं UX4G डिज़ाइन मानकों के साथ GIGW 3.0 सुगमता मानकों का पूर्ण अनुपालन करते हैं।',
      gu: 'તમામ કામગીરી CERC નિયમો, ડીપીડીપી એક્ટ 2023 અને GIGW 3.0 એક્સેસિબિલિટી ધોરણોનું પાલન કરે છે.',
      mr: 'सर्व व्यावसायिक ऑपरेशन्स CERC नियम, DPDP कायदा 2023 आणि GIGW 3.0 सुलभता मानकांचे पालन करतात.'
    }
  }
];

const SPEECH_RATES = [
  { rate: 0.75, label: '0.75x' },
  { rate: 1.0, label: '1x' },
  { rate: 1.25, label: '1.25x' },
  { rate: 1.5, label: '1.5x' },
];

export default function AudioSpeechWidget({ open, onClose }) {
  const { lang } = useGigw();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [rateIdx, setRateIdx] = useState(1); // default 1x
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const [supported, setSupported] = useState(true);

  const synthRef = useRef(null);
  const utteranceRef = useRef(null);

  // Check speech synthesis support
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    } else {
      setSupported(false);
    }

    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // Whenever modal closes, cancel any ongoing speech
  useEffect(() => {
    if (!open && synthRef.current) {
      synthRef.current.cancel();
      setIsPlaying(false);
      setIsPaused(false);
    }
  }, [open]);

  // Clean utterance handler
  function speakCurrentSection(sectionIdx = activeSectionIdx, speedRate = SPEECH_RATES[rateIdx].rate) {
    if (!synthRef.current) return;

    synthRef.current.cancel();

    const sec = SPEECH_SECTIONS[sectionIdx];
    if (!sec) return;

    const rawText = sec.text[lang] || sec.text.en;
    const utterance = new SpeechSynthesisUtterance(rawText);
    utteranceRef.current = utterance;

    // Rate & Pitch
    utterance.rate = speedRate;
    utterance.pitch = 1.0;

    // Voice Selection
    const voices = synthRef.current.getVoices ? synthRef.current.getVoices() : [];
    let selectedVoice = null;

    if (lang === 'hi') {
      selectedVoice = voices.find((v) => v.lang.startsWith('hi') || v.name.toLowerCase().includes('hindi'));
    } else if (lang === 'gu') {
      selectedVoice = voices.find((v) => v.lang.startsWith('gu'));
    } else if (lang === 'mr') {
      selectedVoice = voices.find((v) => v.lang.startsWith('mr'));
    }

    if (!selectedVoice) {
      // Find Indian English or standard English
      selectedVoice = voices.find((v) => v.lang === 'en-IN') || 
                      voices.find((v) => v.lang.startsWith('en'));
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.onstart = () => {
      setIsPlaying(true);
      setIsPaused(false);
      setStatusAnnouncement(
        lang === 'hi' 
          ? `पढ़ रहा है: ${sec.title[lang] || sec.title.en}` 
          : `Reading: ${sec.title[lang] || sec.title.en}`
      );
    };

    utterance.onend = () => {
      // If there are more sections, auto-advance
      if (sectionIdx + 1 < SPEECH_SECTIONS.length) {
        setActiveSectionIdx(sectionIdx + 1);
        speakCurrentSection(sectionIdx + 1, speedRate);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
        setStatusAnnouncement(lang === 'hi' ? 'पाठ पूर्ण हुआ' : 'Audio reading complete');
      }
    };

    utterance.onerror = (e) => {
      console.warn('SpeechSynthesis error:', e);
      setIsPlaying(false);
      setIsPaused(false);
      setStatusAnnouncement(lang === 'hi' ? 'ऑडियो वाचन रुका' : 'Audio reading stopped');
    };

    synthRef.current.speak(utterance);
  }

  function handlePlayPause() {
    if (!synthRef.current) return;

    if (isPlaying && !isPaused) {
      synthRef.current.pause();
      setIsPaused(true);
      setStatusAnnouncement(lang === 'hi' ? 'ऑडियो रोक दिया गया है' : 'Speech paused');
    } else if (isPaused) {
      synthRef.current.resume();
      setIsPaused(false);
      setStatusAnnouncement(lang === 'hi' ? 'ऑडियो फिर से शुरू किया गया' : 'Speech resumed');
    } else {
      speakCurrentSection(activeSectionIdx);
    }
  }

  function handleStop() {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setStatusAnnouncement(lang === 'hi' ? 'ऑडियो बंद किया गया' : 'Speech stopped');
  }

  function handleNext() {
    if (activeSectionIdx + 1 < SPEECH_SECTIONS.length) {
      const nextIdx = activeSectionIdx + 1;
      setActiveSectionIdx(nextIdx);
      if (isPlaying) {
        speakCurrentSection(nextIdx);
      }
    }
  }

  function handlePrev() {
    if (activeSectionIdx > 0) {
      const prevIdx = activeSectionIdx - 1;
      setActiveSectionIdx(prevIdx);
      if (isPlaying) {
        speakCurrentSection(prevIdx);
      }
    }
  }

  function handleCycleRate() {
    const nextRateIdx = (rateIdx + 1) % SPEECH_RATES.length;
    setRateIdx(nextRateIdx);
    if (isPlaying) {
      speakCurrentSection(activeSectionIdx, SPEECH_RATES[nextRateIdx].rate);
    }
  }

  if (!open) return null;

  const currentSection = SPEECH_SECTIONS[activeSectionIdx];
  const sectionTitle = currentSection.title[lang] || currentSection.title.en;
  const sectionText = currentSection.text[lang] || currentSection.text.en;

  return (
    <div 
      className="gigw-audio-widget-container" 
      role="region" 
      aria-label={lang === 'hi' ? 'UX4G टेक्स्ट-टू-स्पीच ऑडियो प्लेयर' : 'UX4G Text-to-Speech Audio Widget'}
    >
      {/* Live region for screen reader accessibility */}
      <div className="sr-only" aria-live="polite">
        {statusAnnouncement}
      </div>

      <div className="gigw-audio-widget-card">
        {/* Header Strip */}
        <div className="gigw-audio-widget-header">
          <div className="gigw-audio-widget-title">
            <Volume2 size={16} className="gigw-audio-icon-pulse" />
            <span>{lang === 'hi' ? 'UX4G स्क्रीन रीडर वाचक (Audio)' : 'UX4G Screen Reader Audio'}</span>
            <span className="gigw-audio-badge">WCAG AAA</span>
          </div>
          <button 
            type="button" 
            className="gigw-audio-close-btn"
            onClick={onClose}
            aria-label={lang === 'hi' ? 'ऑडियो प्लेयर बंद करें' : 'Close audio player'}
            title={lang === 'hi' ? 'बंद करें (Esc)' : 'Close (Esc)'}
          >
            <X size={15} />
          </button>
        </div>

        {/* Content Preview & Tracker */}
        <div className="gigw-audio-body">
          <div className="gigw-audio-section-info">
            <span className="gigw-audio-section-step">
              {lang === 'hi' 
                ? `खंड ${activeSectionIdx + 1} / ${SPEECH_SECTIONS.length}` 
                : `Section ${activeSectionIdx + 1} of ${SPEECH_SECTIONS.length}`}
            </span>
            <span className="gigw-audio-section-name">{sectionTitle}</span>
          </div>

          <p className="gigw-audio-snippet" lang={lang}>
            "{sectionText}"
          </p>

          {!supported && (
            <div className="gigw-audio-unsupported">
              {lang === 'hi' 
                ? 'आपका ब्राउज़र वेब स्पीच ऑडियो को सपोर्ट नहीं करता है।' 
                : 'Your browser does not support native Web Speech Synthesis.'}
            </div>
          )}
        </div>

        {/* Playback Controls Toolbar */}
        <div className="gigw-audio-controls">
          <button
            type="button"
            className="gigw-audio-btn gigw-audio-btn-nav"
            onClick={handlePrev}
            disabled={activeSectionIdx === 0}
            aria-label={lang === 'hi' ? 'पिछला खंड' : 'Previous section'}
            title={lang === 'hi' ? 'पिछला खंड' : 'Previous section'}
          >
            <SkipBack size={15} />
          </button>

          <button
            type="button"
            className={`gigw-audio-btn gigw-audio-btn-play ${isPlaying && !isPaused ? 'is-playing' : ''}`}
            onClick={handlePlayPause}
            aria-label={
              isPlaying && !isPaused 
                ? (lang === 'hi' ? 'रोकें (Pause)' : 'Pause Audio') 
                : (lang === 'hi' ? 'सुनाएं (Play)' : 'Play Audio')
            }
          >
            {isPlaying && !isPaused ? <Pause size={17} /> : <Play size={17} />}
            <span>
              {isPlaying && !isPaused 
                ? (lang === 'hi' ? 'रोकें' : 'Pause') 
                : (isPaused ? (lang === 'hi' ? 'जारी रखें' : 'Resume') : (lang === 'hi' ? 'सुनें' : 'Listen'))}
            </span>
          </button>

          <button
            type="button"
            className="gigw-audio-btn gigw-audio-btn-stop"
            onClick={handleStop}
            disabled={!isPlaying && !isPaused}
            aria-label={lang === 'hi' ? 'ऑडियो समाप्त करें' : 'Stop audio'}
            title={lang === 'hi' ? 'समाप्त करें' : 'Stop'}
          >
            <Square size={14} />
          </button>

          <button
            type="button"
            className="gigw-audio-btn gigw-audio-btn-nav"
            onClick={handleNext}
            disabled={activeSectionIdx === SPEECH_SECTIONS.length - 1}
            aria-label={lang === 'hi' ? 'अगला खंड' : 'Next section'}
            title={lang === 'hi' ? 'अगला खंड' : 'Next section'}
          >
            <SkipForward size={15} />
          </button>

          {/* Rate Button */}
          <button
            type="button"
            className="gigw-audio-btn gigw-audio-btn-rate"
            onClick={handleCycleRate}
            aria-label={lang === 'hi' ? `वाचन गति: ${SPEECH_RATES[rateIdx].label}` : `Speech speed: ${SPEECH_RATES[rateIdx].label}`}
            title={lang === 'hi' ? 'वाचन गति बदलें' : 'Change speech speed'}
          >
            <SlidersHorizontal size={13} />
            <span>{SPEECH_RATES[rateIdx].label}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
