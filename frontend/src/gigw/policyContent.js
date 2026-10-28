import { REIA_BETA } from '../reiaBeta.js';
/**
 * The statutory pages GIGW 3.0 (and the DPDP Act 2023 for the privacy notice)
 * require a government portal to publish, in English and Hindi.
 *
 * A section is { h, p: [...], list: [...] } with each text as { en, hi }. A
 * section of `type: 'contacts'` is filled from the officers configured under
 * Masters → System Parameters (gigw_* keys), so no name or address is hard-coded here.
 */
const b = (en, hi) => ({ en, hi });

export const POLICY_LINKS = [
  { to: '/privacy-policy', key: 'page.privacy' },
  { to: '/terms-of-use', key: 'page.terms' },
  { to: '/disclaimer', key: 'page.disclaimer' },
  { to: '/hyperlinking-policy', key: 'page.hyperlink' },
  { to: '/copyright-policy', key: 'page.copyright' },
  { to: '/cookie-policy', key: 'page.cookies' },
  { to: '/security-policy', key: 'page.security' },
];

export const HELP_LINKS = [
  { to: '/contact-us', key: 'page.contact' },
  { to: '/grievance-redressal', key: 'page.grievance' },
  { to: '/accessibility-statement', key: 'page.accessibility' },
  { to: '/screen-reader-access', key: 'page.screenReader' },
  { to: '/help', key: 'page.help' },
  { to: '/sitemap', key: 'page.sitemap' },
  { to: '/feedback', key: 'page.feedback' },
  { to: '/related-links', key: 'page.related' },
];

// DBIM v3 s.5.4 global navigation menu on the public pages.
export const NAV_LINKS = [
  { to: '/', key: 'page.home' },
  { to: '/about-us', key: 'page.about' },
  { to: '/circulars', key: 'page.circulars' },
  { to: '/help', key: 'page.help' },
  { to: '/feedback', key: 'page.feedback' },
  { to: '/contact-us', key: 'page.contactShort' },
];

// DBIM v3 s.5.6 "Related Links". Only official sites; each was checked by hand.
export const RELATED_LINKS = [
  { href: 'https://www.india.gov.in', en: 'National Portal of India', hi: 'भारत का राष्ट्रीय पोर्टल' },
  { href: 'https://powermin.gov.in', en: 'Ministry of Power', hi: 'विद्युत मंत्रालय' },
  { href: 'https://sjvn.nic.in', en: 'SJVN Limited — corporate website', hi: 'एसजेवीएन लिमिटेड — कॉर्पोरेट वेबसाइट' },
  { href: 'https://cercind.gov.in', en: 'Central Electricity Regulatory Commission (CERC)', hi: 'केंद्रीय विद्युत विनियामक आयोग (सीईआरसी)' },
  { href: 'https://cea.nic.in', en: 'Central Electricity Authority (CEA)', hi: 'केंद्रीय विद्युत प्राधिकरण (सीईए)' },
  { href: 'https://mnre.gov.in', en: 'Ministry of New and Renewable Energy (MNRE)', hi: 'नवीन एवं नवीकरणीय ऊर्जा मंत्रालय (एमएनआरई)' },
  { href: 'https://grid-india.in', en: 'Grid Controller of India (Grid-India)', hi: 'ग्रिड कंट्रोलर ऑफ इंडिया (ग्रिड-इंडिया)' },
  { href: 'https://www.mygov.in', en: 'MyGov', hi: 'माईगॉव' },
  { href: 'https://pgportal.gov.in', en: 'CPGRAMS — public grievances', hi: 'सीपीग्राम्स — लोक शिकायत' },
  { href: 'https://rtionline.gov.in', en: 'RTI Online', hi: 'आरटीआई ऑनलाइन' },
  { href: 'https://www.cert-in.org.in', en: 'CERT-In — report a cyber incident', hi: 'सीईआरटी-इन — साइबर घटना की सूचना' },
];

// SJVN's official handles, as linked from sjvn.nic.in (checked 22-Oct-2026).
// Add Instagram / LinkedIn here only once SJVN confirms the official handle.
export const SOCIAL_LINKS = [
  { href: 'https://x.com/SjvnLimited', name: 'X', icon: 'x' },
  { href: 'https://www.facebook.com/SJVNLtd', name: 'Facebook', icon: 'facebook' },
  { href: 'https://www.youtube.com/@sjvnlimited5476', name: 'YouTube', icon: 'youtube' },
];

export const POLICIES = {
  'privacy-policy': {
    key: 'page.privacy',
    intro: REIA_BETA ? b(
      'This notice explains what personal data the SJVN REIA Commercial Portal (Beta) processes, why, for how long, and the rights you have over it under the Digital Personal Data Protection Act, 2023 (DPDP Act). SJVN Limited is the Data Fiduciary.',
      'यह सूचना बताती है कि एसजेवीएन REIA वाणिज्यिक पोर्टल (बीटा) कौन-सा व्यक्तिगत डेटा, किस उद्देश्य से एवं कितनी अवधि तक संसाधित करता है, तथा डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 (डीपीडीपी अधिनियम) के अंतर्गत आपके क्या अधिकार हैं। एसजेवीएन लिमिटेड डेटा न्यासी (Data Fiduciary) है।'
    ) : b(
      'This notice explains what personal data the SJVN Integrated Energy Commercial & Trading Platform processes, why, for how long, and the rights you have over it under the Digital Personal Data Protection Act, 2023 (DPDP Act). SJVN Limited is the Data Fiduciary.',
      'यह सूचना बताती है कि एसजेवीएन एकीकृत ऊर्जा वाणिज्यिक एवं व्यापार प्लेटफ़ॉर्म कौन-सा व्यक्तिगत डेटा, किस उद्देश्य से एवं कितनी अवधि तक संसाधित करता है, तथा डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 (डीपीडीपी अधिनियम) के अंतर्गत आपके क्या अधिकार हैं। एसजेवीएन लिमिटेड डेटा न्यासी (Data Fiduciary) है।'
    ),
    sections: [
      {
        h: b('1. Data we collect', '1. हम कौन-सा डेटा एकत्र करते हैं'),
        list: [
          b('Identity and contact details of users: name, official e-mail address, mobile number, designation and the organisation you represent.', 'उपयोगकर्ताओं की पहचान एवं संपर्क विवरण: नाम, आधिकारिक ई-मेल पता, मोबाइल नंबर, पदनाम एवं आपके द्वारा प्रतिनिधित्व किया गया संगठन।'),
          b('KYC records of counterparties: PAN, GSTIN, CIN, bank account details and authorised-signatory documents submitted for onboarding.', 'प्रतिपक्षों के केवाईसी अभिलेख: पैन, जीएसटीआईएन, सीआईएन, बैंक खाता विवरण एवं ऑनबोर्डिंग हेतु प्रस्तुत अधिकृत हस्ताक्षरकर्ता दस्तावेज़।'),
          b('Transaction records: bids, contracts, energy accounts, invoices, approvals, payment-security instruments and the statutory declarations you accept.', 'लेन-देन अभिलेख: बोलियाँ, अनुबंध, ऊर्जा लेखा, बीजक, अनुमोदन, भुगतान-सुरक्षा लिखत एवं आपके द्वारा स्वीकृत वैधानिक घोषणाएँ।'),
          b('Security logs: sign-in and sign-out times, failed attempts, IP address, browser details and an audit trail of every change you make.', 'सुरक्षा लॉग: साइन-इन एवं साइन-आउट समय, असफल प्रयास, आईपी पता, ब्राउज़र विवरण एवं आपके द्वारा किए गए प्रत्येक परिवर्तन का ऑडिट ट्रेल।'),
        ],
      },
      {
        h: b('2. Purpose of processing', '2. संसाधन का उद्देश्य'),
        p: [REIA_BETA ? b(
          'Data is processed only for: power procurement and sale as a Renewable Energy Implementing Agency; execution and administration of PPAs and PSAs; payment security and settlement; and statutory filings to CERC, CEA, MNRE, the Ministry of Power, tax authorities and auditors. It is not used for marketing and is not sold or shared for any other purpose.',
          'डेटा का संसाधन केवल इन उद्देश्यों हेतु किया जाता है: नवीकरणीय ऊर्जा कार्यान्वयन एजेंसी के रूप में विद्युत क्रय-विक्रय; पीपीए एवं पीएसए का निष्पादन एवं प्रशासन; भुगतान सुरक्षा एवं निपटान; तथा सीईआरसी, सीईए, एमएनआरई, विद्युत मंत्रालय, कर प्राधिकरणों एवं लेखा परीक्षकों को वैधानिक प्रस्तुतियाँ। इसका उपयोग विपणन हेतु नहीं किया जाता तथा इसे किसी अन्य प्रयोजन हेतु बेचा या साझा नहीं किया जाता।'
        ) : b(
          'Data is processed only for: power procurement and sale as a Renewable Energy Implementing Agency; power trading on exchanges and bilaterally; billing of SJVN’s hydro and thermal stations; execution and administration of PPAs and PSAs; payment security and settlement; and statutory filings to CERC, CEA, MNRE, the Ministry of Power, tax authorities and auditors. It is not used for marketing and is not sold or shared for any other purpose.',
          'डेटा का संसाधन केवल इन उद्देश्यों हेतु किया जाता है: नवीकरणीय ऊर्जा कार्यान्वयन एजेंसी के रूप में विद्युत क्रय-विक्रय; एक्सचेंज एवं द्विपक्षीय विद्युत व्यापार; एसजेवीएन के जल एवं ताप विद्युत केंद्रों की बिलिंग; पीपीए एवं पीएसए का निष्पादन एवं प्रशासन; भुगतान सुरक्षा एवं निपटान; तथा सीईआरसी, सीईए, एमएनआरई, विद्युत मंत्रालय, कर प्राधिकरणों एवं लेखा परीक्षकों को वैधानिक प्रस्तुतियाँ। इसका उपयोग विपणन हेतु नहीं किया जाता तथा इसे किसी अन्य प्रयोजन हेतु बेचा या साझा नहीं किया जाता।'
        )],
      },
      {
        h: b('3. Legal basis and consent', '3. विधिक आधार एवं सहमति'),
        p: [b(
          'Processing rests on the performance of contracts with SJVN, compliance with law (Electricity Act 2003, CERC Regulations, Companies Act 2013, Income-tax and GST law) and, where required, your consent. Consent is never pre-ticked or bundled: the cookie notice and each statutory declaration ask for it separately, and you may withdraw consent at any time from your profile, which does not affect processing already done or processing the law requires.',
          'संसाधन एसजेवीएन के साथ अनुबंधों के निष्पादन, विधि के अनुपालन (विद्युत अधिनियम 2003, सीईआरसी विनियम, कंपनी अधिनियम 2013, आयकर एवं जीएसटी विधि) तथा जहाँ आवश्यक हो, आपकी सहमति पर आधारित है। सहमति कभी पूर्व-चिह्नित या संयुक्त नहीं होती: कुकी सूचना एवं प्रत्येक वैधानिक घोषणा इसे पृथक रूप से माँगती है, तथा आप अपनी प्रोफ़ाइल से किसी भी समय सहमति वापस ले सकते हैं; इससे पूर्व में किए गए या विधि द्वारा अपेक्षित संसाधन पर प्रभाव नहीं पड़ता।'
        )],
      },
      {
        h: b('4. Your rights as a Data Principal', '4. डेटा प्रधान के रूप में आपके अधिकार'),
        list: [
          b('Right to access a summary of your personal data and the processing done on it.', 'अपने व्यक्तिगत डेटा एवं उस पर किए गए संसाधन का सारांश प्राप्त करने का अधिकार।'),
          b('Right to correction, completion, updating and erasure of your personal data, subject to retention the law requires.', 'विधि द्वारा अपेक्षित प्रतिधारण के अधीन, अपने व्यक्तिगत डेटा के सुधार, पूर्णता, अद्यतन एवं विलोपन का अधिकार।'),
          b('Right of grievance redressal, first with the Grievance Officer and then with the Data Protection Board of India.', 'शिकायत निवारण का अधिकार, पहले शिकायत अधिकारी के समक्ष एवं तत्पश्चात भारतीय डेटा संरक्षण बोर्ड के समक्ष।'),
          b('Right to nominate another person to exercise these rights in the event of your death or incapacity.', 'आपकी मृत्यु या अक्षमता की स्थिति में इन अधिकारों का प्रयोग करने हेतु किसी अन्य व्यक्ति को नामित करने का अधिकार।'),
        ],
        p: [b(
          'Signed-in users exercise these rights from Profile → Privacy & data rights, which records the request and routes it to the Data Protection Officer. Others may write to the officer named below.',
          'साइन-इन उपयोगकर्ता प्रोफ़ाइल → गोपनीयता एवं डेटा अधिकार से इन अधिकारों का प्रयोग करते हैं, जहाँ अनुरोध अभिलिखित होकर डेटा संरक्षण अधिकारी को भेजा जाता है। अन्य व्यक्ति नीचे नामित अधिकारी को लिख सकते हैं।'
        )],
      },
      {
        h: b('5. Retention', '5. प्रतिधारण'),
        p: [b(
          'Commercial and financial records (contracts, invoices, settlements, payment security) are kept for at least eight years from the end of the financial year to which they relate, as required by Section 128 of the Companies Act 2013 and tax law, and longer while a dispute, audit or regulatory proceeding is open. Security and audit logs are kept for at least 180 days as directed by CERT-In, and the tamper-evident audit trail is kept for the life of the records it describes. User accounts are deactivated, not deleted, when access ends, so that past approvals remain attributable.',
          'वाणिज्यिक एवं वित्तीय अभिलेख (अनुबंध, बीजक, निपटान, भुगतान सुरक्षा) कंपनी अधिनियम 2013 की धारा 128 एवं कर विधि के अनुसार संबंधित वित्तीय वर्ष की समाप्ति से कम-से-कम आठ वर्ष तक, तथा किसी विवाद, लेखा परीक्षा या विनियामक कार्यवाही के लंबित रहने तक, रखे जाते हैं। सुरक्षा एवं ऑडिट लॉग सीईआरटी-इन के निर्देशानुसार कम-से-कम 180 दिन तक रखे जाते हैं, तथा छेड़छाड़-प्रकट ऑडिट ट्रेल संबंधित अभिलेखों के जीवनकाल तक रखा जाता है। पहुँच समाप्त होने पर उपयोगकर्ता खाते निष्क्रिय किए जाते हैं, हटाए नहीं जाते, ताकि पूर्व अनुमोदनों का उत्तरदायित्व बना रहे।'
        )],
      },
      {
        h: b('6. Security and sharing', '6. सुरक्षा एवं साझाकरण'),
        p: [b(
          'Data is hosted on SJVN-controlled infrastructure in India. Access is role-based, every change is recorded in a hash-chained audit log, and sessions end after inactivity. Data is shared only with the regulators, grid operators, exchanges, banks and auditors that a transaction or the law requires. A personal-data breach will be reported to the Data Protection Board and to affected persons as the DPDP Act requires, and to CERT-In within six hours.',
          'डेटा भारत में एसजेवीएन-नियंत्रित अवसंरचना पर रखा जाता है। पहुँच भूमिका-आधारित है, प्रत्येक परिवर्तन हैश-श्रृंखलित ऑडिट लॉग में अभिलिखित होता है, तथा निष्क्रियता पर सत्र समाप्त हो जाते हैं। डेटा केवल उन्हीं विनियामकों, ग्रिड संचालकों, एक्सचेंजों, बैंकों एवं लेखा परीक्षकों से साझा किया जाता है जिनकी किसी लेन-देन या विधि द्वारा अपेक्षा हो। व्यक्तिगत डेटा उल्लंघन की सूचना डीपीडीपी अधिनियम के अनुसार डेटा संरक्षण बोर्ड एवं प्रभावित व्यक्तियों को, तथा छह घंटे के भीतर सीईआरटी-इन को दी जाएगी।'
        )],
      },
      { type: 'contacts', roles: ['dpo', 'grievance'], h: b('7. Data Protection Officer and Grievance Officer', '7. डेटा संरक्षण अधिकारी एवं शिकायत अधिकारी') },
    ],
  },

  'terms-of-use': {
    key: 'page.terms',
    intro: REIA_BETA ? b(
      'These terms govern access to and use of the SJVN REIA Commercial Portal (Beta). By signing in you accept them.',
      'ये शर्तें एसजेवीएन REIA वाणिज्यिक पोर्टल (बीटा) तक पहुँच एवं उसके उपयोग को नियंत्रित करती हैं। साइन इन करके आप इन्हें स्वीकार करते हैं।'
    ) : b(
      'These terms govern access to and use of the SJVN Integrated Energy Commercial & Trading Platform. By signing in you accept them.',
      'ये शर्तें एसजेवीएन एकीकृत ऊर्जा वाणिज्यिक एवं व्यापार प्लेटफ़ॉर्म तक पहुँच एवं उसके उपयोग को नियंत्रित करती हैं। साइन इन करके आप इन्हें स्वीकार करते हैं।'
    ),
    sections: [
      {
        h: b('1. Authorised use', '1. अधिकृत उपयोग'),
        p: [b(
          'The platform is a restricted computer resource of SJVN Limited. Only users issued credentials by SJVN or by their organisation’s administrator may use it, and only for the business of their role. Credentials are personal and must not be shared; every action taken with them is attributed to the holder.',
          'यह प्लेटफ़ॉर्म एसजेवीएन लिमिटेड का प्रतिबंधित कंप्यूटर संसाधन है। केवल वे उपयोगकर्ता, जिन्हें एसजेवीएन या उनके संगठन के प्रशासक द्वारा क्रेडेंशियल जारी किए गए हैं, अपनी भूमिका के कार्य हेतु ही इसका उपयोग कर सकते हैं। क्रेडेंशियल व्यक्तिगत हैं एवं साझा नहीं किए जाने चाहिए; उनसे की गई प्रत्येक कार्यवाही धारक के नाम दर्ज होती है।'
        )],
      },
      {
        h: b('2. Prohibited conduct', '2. निषिद्ध आचरण'),
        list: [
          b('Unauthorised access, or attempts to access data or functions outside your role.', 'अनधिकृत पहुँच, या अपनी भूमिका से बाहर के डेटा या कार्यों तक पहुँचने का प्रयास।'),
          b('Tampering with bid books, energy accounts, invoices, approvals or audit records.', 'बोली पुस्तिकाओं, ऊर्जा लेखा, बीजकों, अनुमोदनों या ऑडिट अभिलेखों से छेड़छाड़।'),
          b('Automated scraping, load testing or vulnerability scanning without SJVN’s written permission.', 'एसजेवीएन की लिखित अनुमति के बिना स्वचालित स्क्रैपिंग, लोड परीक्षण या भेद्यता स्कैनिंग।'),
          b('Uploading malicious code, or documents you are not entitled to submit.', 'दुर्भावनापूर्ण कोड, या ऐसे दस्तावेज़ अपलोड करना जिन्हें प्रस्तुत करने का आपको अधिकार नहीं है।'),
        ],
        p: [b(
          'Such conduct may attract civil liability under Section 43 and criminal liability under Sections 66 and 66C of the Information Technology Act, 2000, besides contractual consequences.',
          'ऐसा आचरण संविदात्मक परिणामों के अतिरिक्त सूचना प्रौद्योगिकी अधिनियम, 2000 की धारा 43 के अंतर्गत सिविल दायित्व एवं धारा 66 व 66C के अंतर्गत आपराधिक दायित्व आकर्षित कर सकता है।'
        )],
      },
      {
        h: b('3. Suspension and termination', '3. निलंबन एवं समाप्ति'),
        p: [b(
          'SJVN may suspend or end access at once where credentials appear compromised, where these terms are breached, or where a user’s role ends. All open sessions of a suspended account are ended.',
          'क्रेडेंशियल के समझौता होने की आशंका, इन शर्तों के उल्लंघन, या उपयोगकर्ता की भूमिका समाप्त होने पर एसजेवीएन तत्काल पहुँच निलंबित या समाप्त कर सकता है। निलंबित खाते के सभी खुले सत्र समाप्त कर दिए जाते हैं।'
        )],
      },
      {
        h: b('4. Electronic records', '4. इलेक्ट्रॉनिक अभिलेख'),
        p: [b(
          'Approvals, declarations and submissions made on the platform are electronic records under the Information Technology Act, 2000 and are binding on the user and the organisation they represent.',
          'प्लेटफ़ॉर्म पर किए गए अनुमोदन, घोषणाएँ एवं प्रस्तुतियाँ सूचना प्रौद्योगिकी अधिनियम, 2000 के अंतर्गत इलेक्ट्रॉनिक अभिलेख हैं तथा उपयोगकर्ता एवं उसके द्वारा प्रतिनिधित्व किए गए संगठन पर बाध्यकारी हैं।'
        )],
      },
      {
        h: b('5. Governing law and jurisdiction', '5. शासी विधि एवं क्षेत्राधिकार'),
        p: [b(
          'These terms are governed by the laws of India. Subject to any dispute-resolution clause in the underlying contract, the courts at Shimla, Himachal Pradesh shall have exclusive jurisdiction.',
          'ये शर्तें भारत की विधियों द्वारा शासित हैं। मूल अनुबंध के किसी विवाद-समाधान खंड के अधीन, शिमला, हिमाचल प्रदेश के न्यायालयों को अनन्य क्षेत्राधिकार होगा।'
        )],
      },
    ],
  },

  'disclaimer': {
    key: 'page.disclaimer',
    intro: REIA_BETA ? b(
      'This portal is maintained by SJVN Limited (A Navratna CPSE, Govt. of India) for its business as a Renewable Energy Implementing Agency: contracts, energy accounting, billing and settlement. The materials and figures published herein are governed by statutory guidelines and regulatory frameworks.',
      'यह पोर्टल एसजेवीएन लिमिटेड (भारत सरकार के अधीन नवरत्न उद्यम) द्वारा नवीकरणीय ऊर्जा कार्यान्वयन एजेंसी के कार्य हेतु प्रबंधित किया जाता है: अनुबंध, ऊर्जा लेखा, बिलिंग एवं निपटान। यहाँ प्रकाशित सामग्री एवं आँकड़े वैधानिक दिशानिर्देशों एवं विनियामक तंत्र के अधीन हैं।'
    ) : b(
      'This portal is maintained by SJVN Limited (A Navratna CPSE, Govt. of India) to facilitate official energy commerce, commercial settlements, REIA procurement, and power trading. The materials and figures published herein are governed by statutory guidelines and regulatory frameworks.',
      'यह पोर्टल एसजेवीएन लिमिटेड (भारत सरकार के अधीन नवरत्न उद्यम) द्वारा आधिकारिक ऊर्जा वाणिज्य, वाणिज्यिक निपटान, आरईआईए खरीद एवं विद्युत व्यापार के संचालन हेतु प्रबंधित किया जाता है। यहाँ प्रकाशित सामग्री एवं आँकड़े वैधानिक दिशानिर्देशों एवं विनियामक तंत्र के अधीन हैं।'
    ),
    sections: [
      {
        h: b('1. Accuracy of Information & Official Records', '1. सूचना की सटीकता एवं आधिकारिक अभिलेख'),
        p: [
          b(
            'While SJVN Limited exercises all reasonable care and diligence to ensure that the information, calculations, and registers published on this platform are accurate and up to date, the information is provided on an “as is” operational basis. In the event of any discrepancy or conflict between the figures displayed on this portal and the formal signed statutory instruments — including executed Power Purchase Agreements (PPAs), Power Sale Agreements (PSAs), Central Electricity Regulatory Commission (CERC) tariff orders, or Regional Energy Accounts (REA) issued by Regional Power Committees (RPCs) — the signed statutory contracts and regulatory orders shall prevail.',
            'यद्यपि एसजेवीएन लिमिटेड इस प्लेटफ़ॉर्म पर प्रकाशित जानकारी, गणनाओं एवं रजिस्टरों की सटीकता एवं अद्यतन स्थिति सुनिश्चित करने हेतु सभी उचित सावधानी एवं तत्परता बरतता है, तथापि यह जानकारी “जैसी है” परिचालन आधार पर प्रदान की जाती है। इस पोर्टल पर प्रदर्शित आँकड़ों एवं औपचारिक हस्ताक्षरित वैधानिक लिखतों — निष्पादित विद्युत क्रय अनुबंध (PPA), विद्युत विक्रय अनुबंध (PSA), केंद्रीय विद्युत विनियामक आयोग (CERC) के टैरिफ आदेश, या क्षेत्रीय विद्युत समितियों (RPC) द्वारा जारी क्षेत्रीय ऊर्जा लेखा (REA) — के बीच किसी भी विसंगति या विरोध की स्थिति में, हस्ताक्षरित वैधानिक अनुबंध एवं विनियामक आदेश ही मान्य होंगे।'
          ),
        ],
      },
      ...(REIA_BETA ? [] : [
      {
        h: b('2. Power Market & Scheduling Feeds', '2. विद्युत बाज़ार एवं शेड्यूलिंग फ़ीड्स'),
        p: [
          b(
            'Market clearing prices, traded volumes, and day-ahead / real-time schedules reflect automated electronic data feeds from synchronized power exchanges (IEX, PXIL, HPX) and Grid-India (NLDC / RLDC). Transmission curtailments, schedule revisions, and deviation charges are subject to statutory settlement and reconciliation as per the applicable CERC Deviation Settlement Mechanism (DSM) Regulations.',
            'बाज़ार समाशोधन मूल्य, व्यापारिक मात्रा एवं दिन-आगे / वास्तविक समय की समय-सारणी सिंक्रनाइज़्ड पावर एक्सचेंजों (IEX, PXIL, HPX) एवं ग्रिड-इंडिया (NLDC / RLDC) से स्वचालित इलेक्ट्रॉनिक डेटा फ़ीड को दर्शाती हैं। ट्रांसमिशन कटौती, शेड्यूल संशोधन एवं विचलन प्रभार लागू CERC विचलन निपटान तंत्र (DSM) विनियमों के अनुसार वैधानिक निपटान एवं समाधान के अधीन हैं।'
          ),
        ],
      },
      ]),
      {
        h: b('3. Availability & Technical Outages', '3. उपलब्धता एवं तकनीकी व्यवधान'),
        p: [
          b(
            'SJVN Limited endeavors to provide continuous and uninterrupted portal access. However, SJVN shall not be held liable for any loss, delay, or damage arising from scheduled statutory maintenance, telecommunication gateway interruptions, banking clearing delays, or cyber incidents beyond reasonable operational control. Scheduled outages are notified in advance on the portal notification desk.',
            'एसजेवीएन लिमिटेड निरंतर एवं निर्बाध पोर्टल पहुँच प्रदान करने का प्रयास करता है। तथापि, नियोजित वैधानिक रखरखाव, दूरसंचार गेटवे व्यवधान, बैंकिंग समाशोधन विलंब, या उचित परिचालन नियंत्रण से परे साइबर घटनाओं से उत्पन्न किसी भी हानि, विलंब या क्षति हेतु एसजेवीएन उत्तरदायी नहीं होगा। नियोजित व्यवधानों की सूचना पोर्टल के सूचना पटल पर पहले से दी जाती है।'
          ),
        ],
      },
      {
        h: b('4. No Commercial or Legal Advice', '4. व्यावसायिक या विधिक परामर्श नहीं'),
        p: [
          b(
            'The contents of this portal do not constitute financial, investment, or legal advice. Users, market participants, and counterparties are advised to exercise independent professional judgment and verify governing CERC/SERC regulations before undertaking commercial commitments.',
            'इस पोर्टल की सामग्री वित्तीय, निवेश या विधिक परामर्श नहीं है। उपयोगकर्ताओं, बाज़ार प्रतिभागियों एवं प्रतिपक्षों को सलाह दी जाती है कि वे व्यावसायिक प्रतिबद्धताएँ करने से पूर्व स्वतंत्र पेशेवर विवेक का प्रयोग करें एवं संबंधित CERC/SERC विनियमों का सत्यापन करें।'
          ),
        ],
      },
      {
        h: b('5. Hyperlinks to External Websites', '5. बाहरी वेबसाइटों के हाइपरलिंक'),
        p: [
          b(
            'Hyperlinks to third-party or other Government of India websites (e.g. Ministry of Power, CERC, CEA, CPGRAMS, RTI Online) are provided solely for public convenience. SJVN Limited exercises no editorial control over such external domains, does not endorse their content, and accepts no responsibility for their operational availability or privacy policies.',
            'तृतीय-पक्ष या भारत सरकार की अन्य वेबसाइटों (जैसे विद्युत मंत्रालय, CERC, CEA, CPGRAMS, RTI Online) के हाइपरलिंक केवल सार्वजनिक सुविधा हेतु प्रदान किए गए हैं। एसजेवीएन लिमिटेड ऐसे बाहरी डोमेन पर कोई संपादकीय नियंत्रण नहीं रखता, उनकी सामग्री का समर्थन नहीं करता, तथा उनकी परिचालन उपलब्धता या गोपनीयता नीतियों हेतु कोई दायित्व स्वीकार नहीं करता।'
          ),
        ],
      },
      { type: 'contacts', roles: ['wim', 'grievance', 'dpo'], h: b('6. Questions & Clarifications', '6. प्रश्न एवं स्पष्टीकरण') },
    ],
  },

  'hyperlinking-policy': {
    key: 'page.hyperlink',
    sections: [
      {
        h: b('Links to external websites', 'बाह्य वेबसाइटों के लिंक'),
        p: [b(
          'This portal links to websites of other government bodies and market institutions (for example MNRE, CEA, CERC, Grid-India/NLDC, the exchanges). SJVN is not responsible for the contents or reliability of linked websites and does not necessarily endorse the views expressed there. Such links open in a new tab and are marked so.',
          'यह पोर्टल अन्य सरकारी निकायों एवं बाज़ार संस्थाओं (उदाहरणार्थ एमएनआरई, सीईए, सीईआरसी, ग्रिड-इंडिया/एनएलडीसी, एक्सचेंज) की वेबसाइटों से लिंक करता है। लिंक की गई वेबसाइटों की सामग्री या विश्वसनीयता हेतु एसजेवीएन उत्तरदायी नहीं है एवं वहाँ व्यक्त विचारों का अनिवार्यतः समर्थन नहीं करता। ऐसे लिंक नए टैब में खुलते हैं एवं इस रूप में चिह्नित हैं।'
        )],
      },
      {
        h: b('Links to this portal', 'इस पोर्टल के लिंक'),
        p: [b(
          'Other websites may link to the public home page of this portal without permission. Linking to inner pages, or loading this portal’s pages inside a frame on another site, requires SJVN’s prior written permission; write to the Web Information Manager stating the page and the purpose.',
          'अन्य वेबसाइटें बिना अनुमति इस पोर्टल के सार्वजनिक मुख पृष्ठ से लिंक कर सकती हैं। आंतरिक पृष्ठों से लिंक करने, या इस पोर्टल के पृष्ठों को किसी अन्य साइट पर फ़्रेम में लोड करने हेतु एसजेवीएन की पूर्व लिखित अनुमति आवश्यक है; पृष्ठ एवं उद्देश्य बताते हुए वेब सूचना प्रबंधक को लिखें।'
        )],
      },
    ],
  },

  'copyright-policy': {
    key: 'page.copyright',
    sections: [
      {
        h: b('Copyright', 'कॉपीराइट'),
        p: [b(
          'The content of this portal — including tender and bidding documents, manuals, report formats, calculation methods and software — is the property of SJVN Limited unless stated otherwise, and is protected under the Copyright Act, 1957. It may not be reproduced, republished or used commercially without SJVN’s written permission.',
          'इस पोर्टल की सामग्री — निविदा एवं बोली दस्तावेज़, नियमावलियाँ, रिपोर्ट प्रारूप, गणना पद्धतियाँ एवं सॉफ़्टवेयर सहित — अन्यथा उल्लेख न होने पर एसजेवीएन लिमिटेड की संपत्ति है तथा कॉपीराइट अधिनियम, 1957 के अंतर्गत संरक्षित है। एसजेवीएन की लिखित अनुमति के बिना इसका पुनरुत्पादन, पुनर्प्रकाशन या वाणिज्यिक उपयोग नहीं किया जा सकता।'
        )],
      },
      {
        h: b('Permitted use', 'अनुमत उपयोग'),
        p: [b(
          'Counterparties may download and keep their own invoices, statements and certificates for their records. Material reproduced with permission must be reproduced accurately, not in a misleading context, and with the source acknowledged. Material identified as the copyright of a third party (for example exchange or regulator data) needs the permission of that party.',
          'प्रतिपक्ष अपने अभिलेखों हेतु अपने बीजक, विवरण एवं प्रमाणपत्र डाउनलोड कर रख सकते हैं। अनुमति से पुनरुत्पादित सामग्री सटीक रूप से, भ्रामक संदर्भ के बिना एवं स्रोत के उल्लेख सहित पुनरुत्पादित की जानी चाहिए। किसी तृतीय पक्ष के कॉपीराइट के रूप में चिह्नित सामग्री (उदाहरणार्थ एक्सचेंज या विनियामक डेटा) हेतु उस पक्ष की अनुमति आवश्यक है।'
        )],
      },
    ],
  },

  'cookie-policy': {
    key: 'page.cookies',
    intro: b(
      'The portal keeps a small amount of data in your browser. This page lists all of it.',
      'पोर्टल आपके ब्राउज़र में अल्प मात्रा में डेटा रखता है। यह पृष्ठ उसकी पूरी सूची देता है।'
    ),
    sections: [
      {
        h: b('Essential (always on)', 'आवश्यक (सदैव चालू)'),
        list: [
          b('sjvn_token, sjvn_user — your signed-in session. Removed when you sign out or the session ends.', 'sjvn_token, sjvn_user — आपका साइन-इन सत्र। साइन आउट करने या सत्र समाप्त होने पर हटाया जाता है।'),
          b('sjvn_cookie_consent_v1 — your answer to the cookie notice, with its date and version.', 'sjvn_cookie_consent_v1 — कुकी सूचना पर आपका उत्तर, तिथि एवं संस्करण सहित।'),
          b('sjvn_theme, sjvn_lang, sjvn_text_size, sjvn_contrast — your display choices.', 'sjvn_theme, sjvn_lang, sjvn_text_size, sjvn_contrast — आपकी प्रदर्शन पसंद।'),
        ],
      },
      {
        h: b('Functionality (only with consent)', 'कार्यक्षमता (केवल सहमति से)'),
        list: [
          b('sjvn_command_recents — your last five searches in the portal search.', 'sjvn_command_recents — पोर्टल खोज में आपकी अंतिम पाँच खोजें।'),
          b('sjvn_recent_company_ids — the companies you opened most recently on the company users screen.', 'sjvn_recent_company_ids — कंपनी उपयोगकर्ता स्क्रीन पर हाल में खोली गई कंपनियाँ।'),
        ],
        p: [b(
          'These are written only if you choose “Accept all”, or turn on “Functionality” under “Customise”. Rejecting them, or turning them off later from “Cookie preferences” in the footer, deletes them. The portal sets no analytics, advertising or social-media tracking cookies.',
          'ये केवल तभी लिखे जाते हैं जब आप “सभी स्वीकार करें” चुनें, या “अनुकूलित करें” में “कार्यक्षमता” चालू करें। इन्हें अस्वीकार करने पर, या बाद में फ़ुटर में “कुकी प्राथमिकताएँ” से बंद करने पर, ये हटा दिए जाते हैं। पोर्टल कोई विश्लेषण, विज्ञापन या सोशल-मीडिया ट्रैकिंग कुकी नहीं लगाता।'
        )],
      },
    ],
  },

  'security-policy': {
    key: 'page.security',
    sections: [
      {
        h: b('Security practices', 'सुरक्षा पद्धतियाँ'),
        list: [
          b('Role-based access with maker–checker–approver separation; the officer who prepares a record cannot approve it.', 'मेकर–चेकर–अनुमोदक पृथक्करण सहित भूमिका-आधारित पहुँच; अभिलेख तैयार करने वाला अधिकारी उसे अनुमोदित नहीं कर सकता।'),
          b('Account lock-out after repeated failed sign-ins, and automatic sign-out after inactivity.', 'बार-बार असफल साइन-इन पर खाता लॉक, एवं निष्क्रियता पर स्वतः साइन-आउट।'),
          b('An append-only, hash-chained audit log of sign-ins, sign-outs, failed attempts and every submission, check and approval, with server timestamps — retained beyond the 180 days CERT-In directs.', 'साइन-इन, साइन-आउट, असफल प्रयासों एवं प्रत्येक प्रस्तुति, जाँच व अनुमोदन का सर्वर समय-मुहर सहित केवल-जोड़ने योग्य, हैश-श्रृंखलित ऑडिट लॉग — सीईआरटी-इन द्वारा निर्देशित 180 दिनों से अधिक अवधि तक संरक्षित।'),
          b('Server clocks synchronised to the national time reference (NPL / NIC NTP servers).', 'सर्वर घड़ियाँ राष्ट्रीय समय संदर्भ (एनपीएल / एनआईसी एनटीपी सर्वर) से समकालिक।'),
          b('HTTP security headers (Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) on every response.', 'प्रत्येक प्रतिक्रिया पर एचटीटीपी सुरक्षा हेडर (कंटेंट-सिक्योरिटी-पॉलिसी, एचएसटीएस, एक्स-फ़्रेम-ऑप्शंस, एक्स-कंटेंट-टाइप-ऑप्शंस, रेफ़रर-पॉलिसी)।'),
        ],
      },
      {
        h: b('Reporting a vulnerability or incident', 'भेद्यता या घटना की सूचना'),
        p: [b(
          'Report a suspected vulnerability or security incident to the Web Information Manager below. Please do not test it further or disclose it publicly until SJVN has responded. Incidents are reported to CERT-In within six hours as its directions of 28 April 2022 require.',
          'संदिग्ध भेद्यता या सुरक्षा घटना की सूचना नीचे दिए गए वेब सूचना प्रबंधक को दें। एसजेवीएन के उत्तर तक कृपया उसका आगे परीक्षण या सार्वजनिक प्रकटीकरण न करें। सीईआरटी-इन के 28 अप्रैल 2022 के निर्देशानुसार घटनाओं की सूचना छह घंटे के भीतर सीईआरटी-इन को दी जाती है।'
        )],
      },
      { type: 'contacts', roles: ['wim'], h: b('Contact', 'संपर्क') },
    ],
  },

  'accessibility-statement': {
    key: 'page.accessibility',
    intro: b(
      'SJVN is committed to making this portal usable by everyone, including persons with disabilities, in line with the Rights of Persons with Disabilities Act 2016, GIGW 3.0 and WCAG 2.1 Level AA.',
      'एसजेवीएन दिव्यांगजन अधिकार अधिनियम 2016, GIGW 3.0 एवं WCAG 2.1 स्तर AA के अनुरूप इस पोर्टल को दिव्यांगजनों सहित सभी के लिए उपयोगी बनाने हेतु प्रतिबद्ध है।'
    ),
    sections: [
      {
        h: b('Features', 'सुविधाएँ'),
        list: [
          b('A “Skip to main content” link as the first item on every page.', 'प्रत्येक पृष्ठ पर पहले तत्व के रूप में “मुख्य सामग्री पर जाएँ” लिंक।'),
          b('Text size controls (A- / A / A+) and a high-contrast scheme in the top bar; browser zoom up to 200% is never blocked.', 'शीर्ष पट्टी में पाठ आकार नियंत्रण (A- / A / A+) एवं उच्च-कंट्रास्ट योजना; ब्राउज़र ज़ूम 200% तक कभी अवरुद्ध नहीं।'),
          b('Full keyboard operation with a visible focus ring; dialogs keep focus inside and close with Escape.', 'दृश्यमान फ़ोकस रिंग सहित पूर्ण कीबोर्ड संचालन; संवाद-बॉक्स फ़ोकस भीतर रखते हैं एवं Escape से बंद होते हैं।'),
          b('Labelled form fields, error messages announced to screen readers, and data tables with column headers.', 'लेबलयुक्त फ़ॉर्म फ़ील्ड, स्क्रीन रीडर को घोषित त्रुटि संदेश, एवं स्तंभ शीर्षकों सहित डेटा तालिकाएँ।'),
          b('Content in English and Hindi.', 'अंग्रेज़ी एवं हिंदी में सामग्री।'),
        ],
      },
      {
        h: b('GIGW 3.0 & DBIM v3 Conformance Matrix', 'GIGW 3.0 एवं DBIM v3 अनुपालन मैट्रिक्स'),
        p: [
          b(
            'This portal has been designed and audited against the Guidelines for Indian Government Websites (GIGW 3.0 by STQC / MeitY) and the Digital Brand Identity Manual (DBIM Version 3, Jan 2025 by Digital Governance Division, MeitY). Core conformance parameters include:',
            'इस पोर्टल की संरचना भारत सरकार की वेबसाइटों हेतु दिशानिर्देश (GIGW 3.0, STQC/MeitY) एवं डिजिटल ब्रांड पहचान नियमावली (DBIM संस्करण 3, जनवरी 2025, डिजिटल गवर्नेंस प्रभाग, MeitY) के अनुरूप तैयार एवं जाँची गई है। मुख्य अनुपालन मानक निम्नलिखित हैं:'
          )
        ],
        list: [
          b('Typography & Design System (DBIM Sec 4.1): Mandated Noto Sans typeface loaded for Latin, Devanagari, and Gujarati scripts; standardized 8px grid and functional color palette.', 'टाइपोग्राफी एवं डिज़ाइन प्रणाली (DBIM धारा 4.1): लैटिन, देवनागरी एवं गुजराती लिपियों हेतु अनिवार्य Noto Sans टाइपफ़ेस; मानकीकृत 8px ग्रिड एवं कार्यात्मक रंग पटल।'),
          b('Statutory PSU Lineage (DBIM Sec 5.6): Official PSU identification statement reflecting administrative ministry (Ministry of Power) and joint venture status (Govt. of India & Govt. of Himachal Pradesh).', 'वैधानिक पीएसयू वंशानुक्रम (DBIM धारा 5.6): प्रशासनिक मंत्रालय (विद्युत मंत्रालय) एवं संयुक्त उद्यम स्थिति (भारत सरकार एवं हिमाचल प्रदेश सरकार) को दर्शाने वाला आधिकारिक वक्तव्य।'),
          b('Perceivable (WCAG 2.1 AA / GIGW 3.0): Contrast ratio exceeds 4.5:1 for standard text and 3:1 for graphical UI elements; high-contrast black/yellow mode (7:1+ ratio) provided.', 'प्रत्यक्ष ग्राह्यता (WCAG 2.1 AA / GIGW 3.0): सामान्य पाठ हेतु कंट्रास्ट अनुपात 4.5:1 से अधिक तथा ग्राफ़िकल घटकों हेतु 3:1 से अधिक; उच्च कंट्रास्ट काला/पीला मोड (7:1+ अनुपात) उपलब्ध।'),
          b('Operable (WCAG 2.1 AA / GIGW 3.0): First focusable link is “Skip to main content”; full keyboard navigation without keyboard traps; interactive dialogs trap focus and dismiss with Escape.', 'संचालनीयता (WCAG 2.1 AA / GIGW 3.0): प्रथम फ़ोकस योग्य तत्व “मुख्य सामग्री पर जाएँ” लिंक; बिना कीबोर्ड ट्रैप के पूर्ण कीबोर्ड संचालन; संवाद-बॉक्स फ़ोकस भीतर रखते हैं और Escape से बंद होते हैं।'),
          b('Understandable (GIGW 3.0): Bilingual and multilingual support (English, Hindi, Gujarati, Marathi) with persistent language switching and clear error identification.', 'बोधगम्यता (GIGW 3.0): स्थायी भाषा विकल्प सहित द्विभाषी एवं बहुभाषी सहायता (अंग्रेज़ी, हिंदी, गुजराती, मराठी) तथा स्पष्ट त्रुटि पहचान।'),
          b('Robust (WCAG 2.1 AA): Clean semantic HTML5 elements, ARIA roles, live regions for notifications, and compatibility with leading screen readers.', 'दृढ़ता (WCAG 2.1 AA): स्वच्छ सेमांटिक HTML5 तत्व, ARIA भूमिकाएँ, सूचनाओं हेतु लाइव क्षेत्र, तथा अग्रणी स्क्रीन रीडर्स के साथ पूर्ण अनुकूलता।'),
          b('Digital Personal Data Protection (DPDP Act 2023): Granular cookie consent banner with essential and performance modes, without third-party tracking.', 'डिजिटल व्यक्तिगत डेटा संरक्षण (डीपीडीपी अधिनियम 2023): आवश्यक एवं प्रदर्शन मोड सहित सूक्ष्म कुकी सहमति बैनर, बिना किसी तृतीय-पक्ष ट्रैकिंग के।')
        ]
      },
      {
        h: b('Known limitations', 'ज्ञात सीमाएँ'),
        p: [b(
          'Some charts and 3-D illustrations convey trends visually; the figures behind them are available in the tables on the same screen. Scanned documents uploaded by counterparties may not be readable by screen readers. Navigation menus of the signed-in desks are in English.',
          'कुछ चार्ट एवं त्रि-आयामी चित्र प्रवृत्तियों को दृश्य रूप में दर्शाते हैं; उनके पीछे के आँकड़े उसी स्क्रीन की तालिकाओं में उपलब्ध हैं। प्रतिपक्षों द्वारा अपलोड किए गए स्कैन दस्तावेज़ स्क्रीन रीडर द्वारा पठनीय न हों, ऐसा संभव है। साइन-इन डेस्कों के नेविगेशन मेनू अंग्रेज़ी में हैं।'
        )],
      },
      {
        h: b('Feedback', 'प्रतिक्रिया'),
        p: [b(
          'If you have difficulty using any part of the portal, tell the Web Information Manager, naming the page and the problem. We aim to respond within 15 working days.',
          'यदि पोर्टल के किसी भाग के उपयोग में कठिनाई हो, तो पृष्ठ एवं समस्या बताते हुए वेब सूचना प्रबंधक को सूचित करें। हमारा लक्ष्य 15 कार्य-दिवसों में उत्तर देना है।'
        )],
      },
      { type: 'contacts', roles: ['wim'], h: b('Contact', 'संपर्क') },
    ],
  },

  'screen-reader-access': {
    key: 'page.screenReader',
    intro: b(
      'The portal follows WCAG 2.1 Level AA, so people with visual impairments can use it with assistive technologies such as screen readers and magnifiers.',
      'पोर्टल WCAG 2.1 स्तर AA का अनुपालन करता है, जिससे दृष्टिबाधित व्यक्ति स्क्रीन रीडर एवं आवर्धक जैसी सहायक तकनीकों से इसका उपयोग कर सकते हैं।'
    ),
    sections: [
      { type: 'screen-readers', h: b('Screen readers', 'स्क्रीन रीडर') },
      {
        h: b('Tips', 'सुझाव'),
        list: [
          b('Press Tab once on any page to reach “Skip to main content”.', 'किसी भी पृष्ठ पर “मुख्य सामग्री पर जाएँ” तक पहुँचने हेतु एक बार Tab दबाएँ।'),
          b('Use your screen reader’s landmark and heading navigation: every page has banner, navigation, main and footer regions.', 'अपने स्क्रीन रीडर के लैंडमार्क एवं शीर्षक नेविगेशन का उपयोग करें: प्रत्येक पृष्ठ में बैनर, नेविगेशन, मुख्य एवं फ़ुटर क्षेत्र हैं।'),
          b('Switch the page to Hindi with the “हिंदी” button in the top bar; the page language changes with it so the reader uses the right voice.', 'शीर्ष पट्टी में “हिंदी” बटन से पृष्ठ को हिंदी में बदलें; पृष्ठ की भाषा भी बदलती है जिससे रीडर सही आवाज़ का उपयोग करता है।'),
        ],
      },
    ],
  },

  'grievance-redressal': {
    key: 'page.grievance',
    intro: b(
      'Grievances about this portal, about the handling of your personal data, or requests for information under the Right to Information Act, 2005 may be raised with the officers below.',
      'इस पोर्टल, आपके व्यक्तिगत डेटा के प्रबंधन से संबंधित शिकायतें, या सूचना का अधिकार अधिनियम, 2005 के अंतर्गत सूचना हेतु अनुरोध नीचे दिए गए अधिकारियों के समक्ष प्रस्तुत किए जा सकते हैं।'
    ),
    sections: [
      {
        h: b('How grievances are handled', 'शिकायतों का निपटारा कैसे होता है'),
        list: [
          b('Signed-in users: raise it from Profile → Privacy & data rights; it is recorded with a reference number and you are notified of each update.', 'साइन-इन उपयोगकर्ता: प्रोफ़ाइल → गोपनीयता एवं डेटा अधिकार से प्रस्तुत करें; यह संदर्भ संख्या सहित अभिलिखित होती है एवं प्रत्येक अद्यतन की सूचना आपको दी जाती है।'),
          b('Others: write to the Grievance Officer by e-mail or post.', 'अन्य: ई-मेल या डाक द्वारा शिकायत अधिकारी को लिखें।'),
          b('Acknowledged within 3 working days; resolved within 30 days, or the reason for further time is given.', '3 कार्य-दिवसों में पावती; 30 दिनों में निवारण, अन्यथा अतिरिक्त समय का कारण बताया जाता है।'),
          b('If unsatisfied, you may approach CPGRAMS (pgportal.gov.in) or, for personal-data grievances, the Data Protection Board of India.', 'असंतुष्ट होने पर आप सीपीग्राम्स (pgportal.gov.in) या व्यक्तिगत डेटा संबंधी शिकायतों हेतु भारतीय डेटा संरक्षण बोर्ड से संपर्क कर सकते हैं।'),
        ],
      },
      { type: 'contacts', roles: ['grievance', 'dpo', 'rti_cpio', 'rti_appellate'], h: b('Designated officers', 'नामित अधिकारी') },
      {
        h: b('Right to Information', 'सूचना का अधिकार'),
        p: [b(
          'RTI applications to SJVN Limited may also be filed online at rtionline.gov.in. Disclosures under Section 4(1)(b) of the RTI Act are published on SJVN’s corporate website.',
          'एसजेवीएन लिमिटेड को आरटीआई आवेदन rtionline.gov.in पर ऑनलाइन भी प्रस्तुत किए जा सकते हैं। आरटीआई अधिनियम की धारा 4(1)(ख) के अंतर्गत प्रकटीकरण एसजेवीएन की कॉर्पोरेट वेबसाइट पर प्रकाशित हैं।'
        )],
      },
    ],
  },

  'about-us': {
    key: 'page.about',
    intro: REIA_BETA ? b(
      'SJVN Limited is a Navratna Central Public Sector Enterprise under the Ministry of Power, Government of India, and a joint venture of the Government of India and the Government of Himachal Pradesh. This portal is SJVN’s REIA Commercial Portal, now in beta.',
      'एसजेवीएन लिमिटेड विद्युत मंत्रालय, भारत सरकार के अधीन एक नवरत्न केंद्रीय सार्वजनिक क्षेत्र उपक्रम है तथा भारत सरकार एवं हिमाचल प्रदेश सरकार का संयुक्त उपक्रम है। यह पोर्टल एसजेवीएन का REIA वाणिज्यिक पोर्टल है, जो अभी बीटा में है।'
    ) : b(
      'SJVN Limited is a Navratna Central Public Sector Enterprise under the Ministry of Power, Government of India, and a joint venture of the Government of India and the Government of Himachal Pradesh. This portal is SJVN’s Integrated Energy Commercial & Trading Platform.',
      'एसजेवीएन लिमिटेड विद्युत मंत्रालय, भारत सरकार के अधीन एक नवरत्न केंद्रीय सार्वजनिक क्षेत्र उपक्रम है तथा भारत सरकार एवं हिमाचल प्रदेश सरकार का संयुक्त उपक्रम है। यह पोर्टल एसजेवीएन का एकीकृत ऊर्जा वाणिज्यिक एवं व्यापार प्लेटफ़ॉर्म है।'
    ),
    sections: [
      {
        h: b('Ownership', 'स्वामित्व'),
        list: [
          b('Government of India — 55.00%', 'भारत सरकार — 55.00%'),
          b('Government of Himachal Pradesh — 26.85%', 'हिमाचल प्रदेश सरकार — 26.85%'),
          b('Public — 18.15%', 'जनता — 18.15%'),
        ],
        p: [b('Shareholding as published on sjvn.nic.in.', 'sjvn.nic.in पर प्रकाशित शेयरधारिता के अनुसार।')],
      },
      {
        h: b('What this portal does', 'यह पोर्टल क्या करता है'),
        list: [
          b('Renewable Energy Implementing Agency (REIA): power purchase and sale agreements, energy accounts, bills, payment security and reconciliation with developers and discoms.', 'नवीकरणीय ऊर्जा कार्यान्वयन एजेंसी (आरईआईए): विकासकर्ताओं एवं डिस्कॉम के साथ विद्युत क्रय एवं विक्रय अनुबंध, ऊर्जा लेखा, बिल, भुगतान सुरक्षा एवं मिलान।'),
          b('Power trading: exchange and bilateral transactions, settlement and billing for trading clients.', 'विद्युत व्यापार: एक्सचेंज एवं द्विपक्षीय लेन-देन, व्यापार ग्राहकों हेतु निपटान एवं बिलिंग।'),
          b('Hydro and thermal stations: billing of beneficiaries for SJVN’s generating stations.', 'जल एवं ताप विद्युत केंद्र: एसजेवीएन के उत्पादन केंद्रों हेतु लाभार्थियों की बिलिंग।'),
        ].slice(0, REIA_BETA ? 1 : undefined),
      },
      {
        h: b('Who uses it', 'इसका उपयोग कौन करता है'),
        p: [b(
          `SJVN officers, renewable energy developers${REIA_BETA ? ' and distribution companies' : ', distribution companies and trading clients'}. Every account is issued by SJVN; there is no public registration.`,
          `एसजेवीएन अधिकारी, नवीकरणीय ऊर्जा विकासकर्ता, ${REIA_BETA ? 'एवं वितरण कंपनियाँ' : 'वितरण कंपनियाँ एवं व्यापार ग्राहक'}। प्रत्येक खाता एसजेवीएन द्वारा जारी किया जाता है; कोई सार्वजनिक पंजीकरण नहीं है।`
        )],
      },
      {
        h: b('More about SJVN', 'एसजेवीएन के बारे में अधिक'),
        p: [b(
          'The company’s history, projects, management, annual reports and RTI disclosures are on its corporate website, sjvn.nic.in.',
          'कंपनी का इतिहास, परियोजनाएँ, प्रबंधन, वार्षिक रिपोर्ट एवं आरटीआई प्रकटीकरण इसकी कॉर्पोरेट वेबसाइट sjvn.nic.in पर उपलब्ध हैं।'
        )],
        links: [{ href: 'https://sjvn.nic.in', en: 'sjvn.nic.in', hi: 'sjvn.nic.in' }],
      },
    ],
  },

  'related-links': {
    key: 'page.related',
    intro: b(
      'Official websites of the Government of India and the power-sector bodies this portal works with. Each link opens in a new tab.',
      'भारत सरकार एवं उन विद्युत-क्षेत्र निकायों की आधिकारिक वेबसाइटें जिनके साथ यह पोर्टल कार्य करता है। प्रत्येक लिंक नए टैब में खुलता है।'
    ),
    sections: [
      { h: b('Government and power sector', 'सरकार एवं विद्युत क्षेत्र'), links: 'RELATED' },
    ],
  },

  'contact-us': {
    key: 'page.contact',
    intro: b(
      'Questions about the content or working of this portal go to the Web Information Manager. Commercial questions about a contract or bill go to the desk named on that document.',
      'इस पोर्टल की सामग्री या कार्यप्रणाली संबंधी प्रश्न वेब सूचना प्रबंधक को भेजें। किसी अनुबंध या बिल संबंधी वाणिज्यिक प्रश्न उस दस्तावेज़ पर नामित डेस्क को भेजें।'
    ),
    sections: [
      { type: 'contacts', roles: ['wim', 'grievance', 'dpo', 'rti_cpio'], h: b('Officers', 'अधिकारी') },
    ],
  },

  help: {
    key: 'page.help',
    // The REIA beta build names the REIA desk alone.
    intro: REIA_BETA ? b(
      'Welcome to the Help & User Guidance Centre for the SJVN REIA Commercial Portal (Beta). This desk provides operational instructions for internal officers, renewable energy developers and state discoms.',
      'एसजेवीएन REIA वाणिज्यिक पोर्टल (बीटा) के सहायता एवं उपयोगकर्ता मार्गदर्शन केंद्र में आपका स्वागत है। यह डेस्क आंतरिक अधिकारियों, नवीकरणीय ऊर्जा विकासकर्ताओं एवं राज्य डिस्कॉम हेतु परिचालन संबंधी निर्देश प्रदान करती है।'
    ) : b(
      'Welcome to the Help & User Guidance Centre for the SJVN Integrated Energy Commercial & Trading Platform. This desk provides operational instructions for internal officers, renewable energy developers, state discoms, and power trading counterparties.',
      'एसजेवीएन एकीकृत ऊर्जा वाणिज्यिक एवं व्यापार प्लेटफ़ॉर्म के सहायता एवं उपयोगकर्ता मार्गदर्शन केंद्र में आपका स्वागत है। यह डेस्क आंतरिक अधिकारियों, नवीकरणीय ऊर्जा विकासकर्ताओं, राज्य डिस्कॉम एवं विद्युत व्यापार प्रतिपक्षों हेतु परिचालन संबंधी निर्देश प्रदान करती है।'
    ),
    sections: [
      {
        h: b('1. Access Control & Sign-in Protocol', '1. पहुँच नियंत्रण एवं साइन-इन प्रक्रिया'),
        p: [
          b(
            `The platform is a secure, role-restricted government system. Internal SJVN officers access through enterprise credentials, while external developers (sellers)${REIA_BETA ? ' and discoms (buyers)' : ', discoms (buyers), and trading clients'} receive digitally verified credentials from the platform administrator.`,
            `यह प्लेटफ़ॉर्म एक सुरक्षित, भूमिका-प्रतिबंधित सरकारी प्रणाली है। आंतरिक एसजेवीएन अधिकारी उद्यम क्रेडेंशियल के माध्यम से पहुँचते हैं, जबकि बाहरी विकासकर्ता (विक्रेता), ${REIA_BETA ? 'एवं डिस्कॉम (क्रेता)' : 'डिस्कॉम (क्रेता) एवं व्यापार ग्राहक'} प्लेटफ़ॉर्म प्रशासक से डिजिटल रूप से सत्यापित क्रेडेंशियल प्राप्त करते हैं।`
          ),
          b(
            'Upon first sign-in, users must update their temporary password. In compliance with CERT-In directives, accounts enforce strong passphrase standards, automatic session lockouts after 15 minutes of inactivity, and temporary lockout upon multiple failed authentication attempts.',
            'प्रथम साइन-इन पर, उपयोगकर्ताओं को अपना अस्थायी पासवर्ड बदलना अनिवार्य है। सीईआरटी-इन निर्देशों के अनुपालन में, खाते मजबूत पासफ़्रेज़ मानकों, 15 मिनट की निष्क्रियता के बाद स्वतः सत्र लॉकआउट, तथा एकाधिक असफल प्रमाणीकरण प्रयासों पर अस्थायी लॉकआउट लागू करते हैं।'
          ),
        ],
      },
      {
        h: REIA_BETA ? b('2. The REIA Desk', '2. REIA डेस्क') : b('2. The Four Operational Enterprise Desks', '2. चार परिचालन उद्यम डेस्क'),
        list: [
          b(
            'REIA Desk (Renewable Energy Implementing Agency): End-to-end administration of Solar, Wind, and Hybrid PPAs/PSAs; monthly REA/SEA energy uploads; automated billing generation; Letter of Credit / Bank Guarantee payment-security monitoring; dispute resolution; and reconciliation.',
            'आरईआईए डेस्क (नवीकरणीय ऊर्जा कार्यान्वयन एजेंसी): सौर, पवन एवं हाइब्रिड पीपीए/पीएसए का संपूर्ण प्रशासन; मासिक आरईए/एसईए ऊर्जा अपलोड; स्वचालित बिलिंग निर्माण; साख पत्र (LC) / बैंक गारंटी (BG) भुगतान-सुरक्षा निगरानी; विवाद समाधान; एवं समाधान/मिलान।'
          ),
          b(
            'Power Trading Hub: Direct interface with power exchanges (IEX, PXIL, HPX) for Day-Ahead Market (DAM), Real-Time Market (RTM), and Green Day-Ahead Market (G-DAM); bilateral contract execution; NOAR (National Open Access Registry) application tracking; and CERC Form-IV statutory filing.',
            'विद्युत व्यापार केंद्र: डे-अहेड मार्केट (DAM), रियल-टाइम मार्केट (RTM), एवं ग्रीन डे-अहेड मार्केट (G-DAM) हेतु पावर एक्सचेंजों (IEX, PXIL, HPX) के साथ सीधा इंटरफ़ेस; द्विपक्षीय अनुबंध निष्पादन; NOAR (राष्ट्रीय खुली पहुँच रजिस्ट्री) आवेदन ट्रैकिंग; एवं CERC फॉर्म-IV वैधानिक विवरणी।'
          ),
          b(
            'Hydro Commercial Desk: Billing for SJVN’s mega hydro stations (Nathpa Jhakri 1500 MW & Rampur 412 MW) based on RPC Regional Energy Accounts; PAF-linked Capacity Charges (AFC); Energy Charges; Beneficiary State Allocations; Supplementary Bills; and Late Payment Surcharges (LPS).',
            'जल विद्युत वाणिज्यिक डेस्क: आरपीसी क्षेत्रीय ऊर्जा लेखा (REA) के आधार पर एसजेवीएन के विशाल जल विद्युत केंद्रों (नाथपा झाकड़ी 1500 मेगावाट एवं रामपुर 412 मेगावाट) की बिलिंग; पीएएफ-लिंक्ड क्षमता प्रभार (AFC); ऊर्जा प्रभार; लाभार्थी राज्य आवंटन; पूरक बिल; एवं विलंब भुगतान अधिभार (LPS)।'
          ),
          b(
            'Thermal Billing Desk: Commercial settlement and billing for Buxar Thermal Power Plant (1320 MW) under CERC Tariff Regulations, including monthly Fixed Capacity Charges, Energy Charge Rates (ECR) derived from landed fuel costs, GCV adjustments, and station month-close audits.',
            'ताप विद्युत बिलिंग डेस्क: सीईआरसी टैरिफ विनियमों के अंतर्गत बक्सर ताप विद्युत परियोजना (1320 मेगावाट) का वाणिज्यिक निपटान एवं बिलिंग, जिसमें मासिक निश्चित क्षमता प्रभार, ईंधन लागत से प्राप्त ऊर्जा प्रभार दर (ECR), जीसीवी समायोजन एवं केंद्र माह-समापन ऑडिट शामिल हैं।'
          ),
        ].slice(0, REIA_BETA ? 1 : undefined),
      },
      {
        h: b('3. Document Generation, Digital Signatures & Formats', '3. दस्तावेज़ निर्माण, डिजिटल हस्ताक्षर एवं प्रारूप'),
        p: [
          b(
            'All tax invoices, debit/credit notes, payment receipts, and reconciliation statements comply with GST e-Invoicing standards and standard electronic records provisions of the Information Technology Act, 2000. Documents can be downloaded directly in tamper-evident PDF formats and high-precision Excel (XLSX) workbooks.',
            'सभी कर बीजक, डेबिट/क्रेडिट नोट, भुगतान रसीदें एवं समाधान विवरण जीएसटी ई-इनवॉयसिंग मानकों एवं सूचना प्रौद्योगिकी अधिनियम, 2000 के मानक इलेक्ट्रॉनिक रिकॉर्ड प्रावधानों के अनुरूप हैं। दस्तावेज़ों को छेड़छाड़-प्रकट पीडीएफ़ प्रारूपों एवं उच्च-सटीक एक्सेल (XLSX) वर्कबुक में सीधे डाउनलोड किया जा सकता है।'
          ),
        ],
      },
      {
        h: b('4. 3-Tier Maker-Checker-Approver Workflow', '4. 3-स्तरीय मेकर-चेकर-अनुमोदक कार्यप्रवाह'),
        p: [
          b(
            'To maintain absolute fiduciary rigor, high-value commercial actions (tariff revisions, invoice releases, LC encashments, payment authorizations) undergo strict three-tier verification. An officer preparing a draft (Maker) cannot review (Checker) or finalize (Approver) the record. Every lifecycle step carries a cryptographic timestamp in the immutable audit log.',
            'पूर्ण वित्तीय विश्वसनीयता बनाए रखने हेतु, उच्च-मूल्य वाली वाणिज्यिक कार्रवाइयां (टैरिफ संशोधन, चालान जारी करना, एलसी भुनाना, भुगतान प्राधिकरण) सख्त त्रि-स्तरीय सत्यापन से गुजरती हैं। ड्राफ्ट तैयार करने वाला अधिकारी (मेकर) रिकॉर्ड की समीक्षा (चेकर) या अंतिम रूप (अनुमोदक) नहीं दे सकता। प्रत्येक जीवनचक्र चरण अपरिवर्तनीय ऑडिट लॉग में एक क्रिप्टोग्राफ़िक टाइमस्टैम्प वहन करता है।'
          ),
        ],
      },
      {
        h: b('5. Assistive Technology & Accessibility Controls', '5. सहायक तकनीक एवं सुगम्यता नियंत्रण'),
        list: [
          b(
            'Top Masthead Controls: Switch effortlessly between English and Hindi, toggle 7:1 High Contrast mode, and adjust text magnification (A- / A / A+) without loss of layout fidelity.',
            'शीर्ष मस्टहेड नियंत्रण: अंग्रेज़ी एवं हिंदी के बीच सहजता से स्विच करें, 7:1 उच्च कंट्रास्ट मोड टॉगल करें, तथा लेआउट अखंडता खोए बिना पाठ आवर्धन (A- / A / A+) को समायोजित करें।'
          ),
          b(
            'Keyboard Shortcuts & Focus Rings: Press Tab to trigger "Skip to main content". All interactive buttons, tables, and dialogs possess prominent WCAG 2.1 AA focus rings and close with the Escape key.',
            'कीबोर्ड शॉर्टकट एवं फ़ोकस रिंग: "मुख्य सामग्री पर जाएँ" सक्रिय करने हेतु Tab दबाएं। सभी इंटरैक्टिव बटन, टेबल और डायलॉग प्रमुख WCAG 2.1 AA फ़ोकस रिंग रखते हैं तथा Escape कुंजी से बंद होते हैं।'
          ),
          b(
            'Screen Readers: The entire portal structure adheres to ARIA Landmark specifications (banner, navigation, main, contentinfo) verified with NVDA, JAWS, and Windows Narrator.',
            'स्क्रीन रीडर्स: संपूर्ण पोर्टल संरचना ARIA लैंडमार्क विनिर्देशों (बैनर, नेविगेशन, मुख्य, सामग्री-सूचना) का पालन करती है जिसे NVDA, JAWS और विंडोज़ नैरेटर के साथ सत्यापित किया गया है।'
          ),
        ],
      },
      { type: 'contacts', roles: ['wim', 'grievance'], h: b('6. Helpdesk & Statutory Support', '6. सहायता केंद्र एवं वैधानिक संपर्क') },
    ],
  },
};

export const SCREEN_READERS = [
  { name: 'NVDA (Non Visual Desktop Access)', site: 'https://www.nvaccess.org', kind: b('Free', 'निःशुल्क') },
  { name: 'JAWS', site: 'https://www.freedomscientific.com/products/software/jaws/', kind: b('Commercial', 'व्यावसायिक') },
  { name: 'Windows Narrator', site: 'https://support.microsoft.com/windows/complete-guide-to-narrator-e4397a0d-ef4f-b386-d8ae-c172f109bdb1', kind: b('Built into Windows', 'विंडोज़ में अंतर्निहित') },
  { name: 'VoiceOver', site: 'https://www.apple.com/accessibility/vision/', kind: b('Built into macOS and iOS', 'मैकओएस एवं आईओएस में अंतर्निहित') },
  { name: 'TalkBack', site: 'https://support.google.com/accessibility/android/answer/6283677', kind: b('Built into Android', 'एंड्रॉइड में अंतर्निहित') },
  { name: 'Orca', site: 'https://help.gnome.org/users/orca/stable/', kind: b('Free, Linux', 'निःशुल्क, लिनक्स') },
];

export const CONTACT_ROLES = {
  wim: b('Web Information Manager', 'वेब सूचना प्रबंधक'),
  grievance: b('Grievance Officer', 'शिकायत अधिकारी'),
  dpo: b('Data Protection Officer', 'डेटा संरक्षण अधिकारी'),
  rti_cpio: b('Central Public Information Officer (RTI)', 'केंद्रीय जन सूचना अधिकारी (आरटीआई)'),
  rti_appellate: b('First Appellate Authority (RTI)', 'प्रथम अपीलीय प्राधिकारी (आरटीआई)'),
};
