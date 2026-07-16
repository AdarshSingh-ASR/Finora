export function PaymentFlowAnimation() {
  return (
    <div className="payment-flow-canvas" aria-label="Illustration of UPI payment alerts becoming an AI-generated spending report">
      <svg className="payment-flow-svg" viewBox="0 0 1200 620" role="img" aria-labelledby="payment-flow-title payment-flow-desc">
        <title id="payment-flow-title">From UPI alerts to an expense report</title>
        <desc id="payment-flow-desc">Several sample UPI payment notifications move from a phone into the Finora AI core and emerge as a categorized report with charts.</desc>
        <defs>
          <linearGradient id="flow-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1c3026" />
            <stop offset="1" stopColor="#101a15" />
          </linearGradient>
          <linearGradient id="ai-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d7ff46" />
            <stop offset=".5" stopColor="#38e5a4" />
            <stop offset="1" stopColor="#6f8cff" />
          </linearGradient>
          <linearGradient id="report-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#38c98f" />
            <stop offset="1" stopColor="#5b7cff" />
          </linearGradient>
          <filter id="ai-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="13" result="blur" />
            <feFlood floodColor="#38e5a4" floodOpacity=".32" />
            <feComposite in2="blur" operator="in" />
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="16" stdDeviation="18" floodColor="#07110c" floodOpacity=".28" />
          </filter>
          <clipPath id="phone-screen"><rect x="72" y="94" width="226" height="414" rx="30" /></clipPath>
          <path id="route-one" d="M 302 226 C 395 226, 422 258, 520 286" />
          <path id="route-two" d="M 302 307 C 403 307, 437 304, 520 304" />
          <path id="route-three" d="M 302 388 C 396 388, 430 347, 520 322" />
          <path id="route-report" d="M 696 304 C 735 304, 758 304, 792 304" />
        </defs>

        <rect x="0" y="0" width="1200" height="620" rx="30" fill="url(#flow-bg)" />
        <g opacity=".08">
          {Array.from({ length: 15 }).map((_, index) => <line key={`v-${index}`} x1={index * 86} y1="0" x2={index * 86} y2="620" stroke="#bfffe3" />)}
          {Array.from({ length: 9 }).map((_, index) => <line key={`h-${index}`} x1="0" y1={index * 78} x2="1200" y2={index * 78} stroke="#bfffe3" />)}
        </g>

        <g className="flow-phone" filter="url(#soft-shadow)">
          <rect x="54" y="70" width="262" height="466" rx="42" fill="#0b120e" stroke="#3d5b4b" strokeWidth="2" />
          <rect x="72" y="94" width="226" height="414" rx="30" fill="#f7fbf8" />
          <rect x="137" y="80" width="96" height="20" rx="10" fill="#0b120e" />
          <g clipPath="url(#phone-screen)">
            <rect x="72" y="94" width="226" height="79" fill="#e8fff4" />
            <text x="91" y="121" className="flow-phone-time">12:42</text>
            <circle cx="274" cy="117" r="4" fill="#1e865e" />
            <text x="91" y="151" className="flow-phone-title">Payment activity</text>
            <text x="91" y="169" className="flow-phone-subtitle">UPI notifications</text>

            <g className="upi-notification upi-one">
              <rect x="86" y="188" width="198" height="68" rx="14" fill="#fff" stroke="#dce8e1" />
              <circle cx="108" cy="211" r="11" fill="#ff7a59" />
              <text x="128" y="209" className="upi-merchant">Swiggy</text>
              <text x="128" y="228" className="upi-meta">Paid via UPI</text>
              <text x="264" y="213" textAnchor="end" className="upi-amount">₹642</text>
              <text x="264" y="233" textAnchor="end" className="upi-time">12:39 PM</text>
            </g>
            <g className="upi-notification upi-two">
              <rect x="86" y="266" width="198" height="68" rx="14" fill="#fff" stroke="#dce8e1" />
              <circle cx="108" cy="289" r="11" fill="#5f7cff" />
              <text x="128" y="287" className="upi-merchant">Uber India</text>
              <text x="128" y="306" className="upi-meta">Paid via UPI</text>
              <text x="264" y="291" textAnchor="end" className="upi-amount">₹318</text>
              <text x="264" y="311" textAnchor="end" className="upi-time">11:08 AM</text>
            </g>
            <g className="upi-notification upi-three">
              <rect x="86" y="344" width="198" height="68" rx="14" fill="#fff" stroke="#dce8e1" />
              <circle cx="108" cy="367" r="11" fill="#34bd82" />
              <text x="128" y="365" className="upi-merchant">Reliance Fresh</text>
              <text x="128" y="384" className="upi-meta">Paid via UPI</text>
              <text x="264" y="369" textAnchor="end" className="upi-amount">₹1,284</text>
              <text x="264" y="389" textAnchor="end" className="upi-time">9:22 AM</text>
            </g>
            <g className="upi-notification upi-four">
              <rect x="86" y="422" width="198" height="68" rx="14" fill="#fff" stroke="#dce8e1" />
              <circle cx="108" cy="445" r="11" fill="#d7ff46" />
              <text x="128" y="443" className="upi-merchant">Netflix</text>
              <text x="128" y="462" className="upi-meta">Recurring payment</text>
              <text x="264" y="447" textAnchor="end" className="upi-amount">₹649</text>
              <text x="264" y="467" textAnchor="end" className="upi-time">Yesterday</text>
            </g>
          </g>
          <rect x="145" y="518" width="80" height="4" rx="2" fill="#577064" />
        </g>

        <g className="flow-routes" fill="none" stroke="#5ce4ad" strokeWidth="2" strokeDasharray="5 8" opacity=".42">
          <use href="#route-one"/><use href="#route-two"/><use href="#route-three"/>
          <use href="#route-report" stroke="#8da0ff" />
        </g>
        <g className="flow-particles">
          <circle r="6" fill="#d7ff46"><animateMotion dur="3.4s" begin="0s" repeatCount="indefinite"><mpath href="#route-one"/></animateMotion></circle>
          <circle r="5" fill="#39e5a4"><animateMotion dur="3.4s" begin="1.15s" repeatCount="indefinite"><mpath href="#route-two"/></animateMotion></circle>
          <circle r="5" fill="#7a8dff"><animateMotion dur="3.4s" begin="2.3s" repeatCount="indefinite"><mpath href="#route-three"/></animateMotion></circle>
          <circle r="6" fill="#d7ff46"><animateMotion dur="2.2s" begin=".8s" repeatCount="indefinite"><mpath href="#route-report"/></animateMotion></circle>
        </g>

        <g className="ai-core" filter="url(#ai-glow)">
          <circle cx="608" cy="304" r="89" fill="#15241c" stroke="url(#ai-ring)" strokeWidth="2" />
          <circle cx="608" cy="304" r="72" fill="none" stroke="#caffdf" strokeOpacity=".14" strokeDasharray="3 10" />
          <rect x="564" y="260" width="88" height="88" rx="25" fill="url(#ai-ring)" transform="rotate(8 608 304)" />
          <rect x="576" y="272" width="64" height="64" rx="19" fill="#14231c" />
          <text x="608" y="319" textAnchor="middle" className="ai-mark">F</text>
          <circle className="ai-orbit-dot" cx="608" cy="215" r="6" fill="#d7ff46" />
          <path d="M650 258l7 3 3 7 3-7 7-3-7-3-3-7-3 7z" fill="#fff" />
        </g>
        <text x="608" y="417" textAnchor="middle" className="ai-label">FINORA AI CORE</text>
        <text x="608" y="438" textAnchor="middle" className="ai-sublabel">normalize · categorize · explain</text>

        <g className="report-sheet" filter="url(#soft-shadow)">
          <rect x="792" y="48" width="362" height="524" rx="24" fill="#fbfdfb" stroke="#dce8e1" />
          <rect x="792" y="48" width="362" height="64" rx="24" fill="#e9fff4" />
          <rect x="792" y="88" width="362" height="24" fill="#e9fff4" />
          <circle cx="824" cy="79" r="15" fill="#14231c" />
          <text x="824" y="84" textAnchor="middle" className="report-f">F</text>
          <text x="850" y="76" className="report-title">July money report</text>
          <text x="850" y="94" className="report-subtitle">Built from 86 transactions</text>
          <rect x="1065" y="67" width="67" height="22" rx="11" fill="#d7ff46" />
          <text x="1099" y="81" textAnchor="middle" className="report-badge">SAMPLE</text>

          <text x="818" y="143" className="report-label">TOTAL SPENT</text>
          <text x="818" y="177" className="report-total">₹38,240</text>
          <text x="818" y="198" className="report-positive">↓ 8.4% from June</text>
          <text x="1012" y="143" className="report-label">SAVINGS RATE</text>
          <text x="1012" y="176" className="report-saving">24%</text>

          <rect x="818" y="220" width="310" height="142" rx="15" fill="#f3f7f4" />
          <text x="836" y="244" className="chart-title">Spending over time</text>
          <line x1="836" y1="333" x2="1110" y2="333" stroke="#dce6df" />
          <line x1="836" y1="287" x2="1110" y2="287" stroke="#e4ebe7" strokeDasharray="3 5" />
          <path className="report-area" d="M836 329 C865 320 879 324 901 307 S944 312 965 285 S1007 296 1028 269 S1078 279 1110 252 L1110 333 L836 333 Z" fill="url(#report-line)" opacity=".12" />
          <path className="report-trend" d="M836 329 C865 320 879 324 901 307 S944 312 965 285 S1007 296 1028 269 S1078 279 1110 252" fill="none" stroke="url(#report-line)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="1110" cy="252" r="5" fill="#fff" stroke="#5b7cff" strokeWidth="3" />

          <text x="818" y="395" className="chart-title">Top categories</text>
          <g className="report-bars">
            <text x="818" y="424" className="bar-name">Food</text><rect x="882" y="413" width="215" height="13" rx="7" fill="#e4ebe7"/><rect className="bar-fill bar-food" x="882" y="413" width="168" height="13" rx="7" fill="#38c98f"/><text x="1127" y="424" textAnchor="end" className="bar-value">₹12.6k</text>
            <text x="818" y="455" className="bar-name">Shopping</text><rect x="882" y="444" width="215" height="13" rx="7" fill="#e4ebe7"/><rect className="bar-fill bar-shopping" x="882" y="444" width="112" height="13" rx="7" fill="#6681ff"/><text x="1127" y="455" textAnchor="end" className="bar-value">₹8.4k</text>
            <text x="818" y="486" className="bar-name">Travel</text><rect x="882" y="475" width="215" height="13" rx="7" fill="#e4ebe7"/><rect className="bar-fill bar-travel" x="882" y="475" width="77" height="13" rx="7" fill="#d7ff46"/><text x="1127" y="486" textAnchor="end" className="bar-value">₹5.8k</text>
          </g>
          <rect x="818" y="515" width="310" height="37" rx="11" fill="#14231c" />
          <circle cx="837" cy="533" r="5" fill="#d7ff46" />
          <text x="850" y="536" className="report-insight">Food delivery rose 18% this month</text>
        </g>
      </svg>
      <p className="payment-flow-note">Animated product illustration · sample amounts</p>
    </div>
  );
}
