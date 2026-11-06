import { useEffect, useState } from 'react';
import RegistrationForm from './RegistrationForm';
import AdminApp from './AdminApp';
import PlayerPortal from './PlayerPortal';
import {
  ArrowDown, ArrowRight, CalendarDays, Check, ChevronDown, Compass,
  Menu, Sparkles, Trophy, Users, X
} from 'lucide-react';

type DetailId = 'prize' | 'schedule' | 'recording';

const details: { id: DetailId; number: string; title: string; summary: string; body: string }[] = [
  {
    id: 'prize',
    number: '01',
    title: 'The prize',
    summary: 'A chance to win $3,000 CAD per player. Full prize conditions will be shared by email.',
    body: 'Participation is free. If the treasure is found, the prize can be up to $3,000 CAD per player, with a minimum of $1,000 CAD per player. If the treasure is not found, no prize is awarded. Further prize conditions will be explained by email before participation.'
  },
  {
    id: 'schedule',
    number: '02',
    title: 'Scheduling and participation',
    summary: 'Sessions are planned with participants’ availability in mind.',
    body: 'We will coordinate with selected candidates to find practical session times. This is a collaborative experience, so participants should be prepared to communicate, work with others, and follow the organizer’s instructions. Full participation requirements and scheduling details will be provided before participation is confirmed.'
  },
  {
    id: 'recording',
    number: '03',
    title: 'Recording and publication',
    summary: 'The experience will be recorded, and selected footage may be published online.',
    body: 'Cameras may record parts of the experience, and footage may be edited and published on major social media platforms. This is disclosed now so you can make an informed decision before applying. Selected candidates will receive the relevant privacy information and consent documents before taking part. Formal recording and publication consent will be handled separately during the onboarding process.'
  }
];

function App() {
  const [expanded, setExpanded] = useState<DetailId[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [route, setRoute] = useState(window.location.hash);
  const isRegistrationPage = route === '#/register';
  const isAdminPage = route === '#/admin';
  const isPlayerPage = route === '#/player';

  useEffect(() => {
    const syncRoute = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  const toggleDetail = (id: DetailId) => {
    setExpanded(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  const registrationHref = '#/register';

  const handleRegistrationClick = () => setMenuOpen(false);

  if (isRegistrationPage) return <RegistrationForm />;
  if (isAdminPage) return <AdminApp />;
  if (isPlayerPage) return <PlayerPortal />;

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Immersive Games Studio home">
          <span className="brand-mark"><Compass size={23} strokeWidth={1.4} /></span>
          <span className="brand-name">IMMERSIVE GAMES <em>STUDIO</em></span>
        </a>
        <button className="menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <nav className={menuOpen ? 'nav nav-open' : 'nav'}>
          <a href="#experience" onClick={() => setMenuOpen(false)}>The Experience</a>
          <a href="#prize" onClick={() => setMenuOpen(false)}>The Prize</a>
          <a href="#details" onClick={() => setMenuOpen(false)}>Before You Apply</a>
          <a className="nav-cta" href={registrationHref} onClick={handleRegistrationClick}>Start registration <ArrowRight size={15} /></a>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-content">
            <p className="eyebrow"><span /> AN IMMERSIVE REAL-WORLD EXPERIENCE</p>
            <h1>The hunt<br /><i>begins here.</i></h1>
            <p className="hero-copy">A treasure has been lost. The path to finding it awaits those willing to take the challenge.</p>
            <a className="button button-gold" href="#experience">Discover the hunt <ArrowDown size={16} /></a>
            <div className="hero-note"><span className="note-line" /> A new kind of adventure from Immersive Games Studio</div>
          </div>
          <div className="hero-art" role="img" aria-label="Illustrated vintage treasure map with a winding route and compass">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="map-card">
              <div className="map-topline"><span>FIELD NOTES · 001</span><span>EST. UNKNOWN</span></div>
              <div className="map-compass"><Compass size={76} strokeWidth={0.7} /></div>
              <svg className="route-svg" viewBox="0 0 340 260" aria-hidden="true">
                <path d="M35 205 C75 178, 84 225, 128 166 S178 133, 195 158 S248 106, 287 53" fill="none" stroke="#8f5b2e" strokeWidth="2.2" strokeDasharray="5 7" />
                <circle cx="35" cy="205" r="5" fill="#8f5b2e" />
                <path d="M279 46 L295 62 M295 46 L279 62" stroke="#8f3d2d" strokeWidth="3" />
              </svg>
              <div className="map-coast coast-a" />
              <div className="map-coast coast-b" />
              <div className="map-footer"><span>FOLLOW NO ORDINARY PATH</span><span>✦</span></div>
            </div>
            <div className="floating-seal"><Sparkles size={18} /><span>THE<br />UNKNOWN<br />AWAITS</span></div>
          </div>
          <div className="hero-bottom"><span>01 / AN INVITATION</span><span>SCROLL TO EXPLORE ↓</span></div>
        </section>

        <section className="intro section-wrap" id="experience">
          <div className="section-kicker">THE EXPERIENCE</div>
          <div className="intro-grid">
            <h2>Not just a<br /><i>treasure hunt.</i></h2>
            <div className="intro-text">
              <p className="lead">Step into a real-world experience shaped by puzzles, discoveries, and decisions.</p>
              <p>Work together, think differently, and find your way forward. The story remains untold. Your journey begins when you enter.</p>
              <div className="rule-mark"><span /><Compass size={17} /><span /></div>
            </div>
          </div>
          <div className="feature-grid">
            <article className="feature-card"><span className="feature-icon"><Users size={22} /></span><h3>Collaborative</h3><p>Share ideas, solve challenges, and move forward together.</p></article>
            <article className="feature-card"><span className="feature-icon"><CalendarDays size={22} /></span><h3>Built around you</h3><p>Sessions are coordinated around participants’ availability.</p></article>
            <article className="feature-card"><span className="feature-icon"><Trophy size={22} /></span><h3>Free to enter</h3><p>There is no registration fee to take part in the experience.</p></article>
          </div>
        </section>

        <section className="prize-section" id="prize">
          <div className="prize-inner">
            <div className="section-kicker section-kicker-light">THE REWARD</div>
            <div className="prize-grid">
              <div>
                <p className="eyebrow eyebrow-light">FIND THE TREASURE</p>
                <h2>$3,000 <small>CAD</small></h2>
                <p className="prize-per-player">PER PLAYER</p>
              </div>
              <div className="prize-description">
                <h3>The treasure awaits.</h3>
                <p>A chance to win up to $3,000 CAD per player.</p>
              </div>
            </div>
            <div className="prize-foot"><span>NO REGISTRATION FEE</span><span>THE OUTCOME DEPENDS ON FINDING THE TREASURE</span></div>
          </div>
        </section>

        <section className="details-section section-wrap" id="details">
          <div className="section-kicker">GOOD TO KNOW <span>—</span> 03</div>
          <div className="details-heading">
            <h2>Before you<br /><i>begin.</i></h2>
            <p>A few important details before you decide whether to apply. The mystery can wait; the practical information shouldn’t.</p>
          </div>
          <div className="detail-list">
            {details.map(detail => {
              const isOpen = expanded.includes(detail.id);
              return (
                <article className={isOpen ? 'detail-row detail-row-open' : 'detail-row'} key={detail.id}>
                  <button className="detail-trigger" aria-expanded={isOpen} onClick={() => toggleDetail(detail.id)}>
                    <span className="detail-number">{detail.number}</span>
                    <span className="detail-copy"><strong>{detail.title}</strong><span>{detail.summary}</span></span>
                    <span className="detail-action">{isOpen ? <X size={18} /> : <ChevronDown size={20} />}</span>
                  </button>
                  {isOpen && <div className="detail-expanded"><p>{detail.body}</p></div>}
                </article>
              );
            })}
          </div>
        </section>

        <section className="final-cta" id="registration">
          <div className="cta-ornament"><Compass size={29} strokeWidth={1.2} /></div>
          <p className="eyebrow">YOUR NEXT CHAPTER</p>
          <h2>Ready to take<br /><i>the first step?</i></h2>
          <p className="cta-copy">Tell us a little about yourself. Start with the registration questionnaire and see whether this adventure is right for you.</p>
          <a className="button button-dark" href={registrationHref} onClick={handleRegistrationClick}>Start registration <ArrowRight size={16} /></a>
          <p className="free-note"><Check size={13} /> FREE TO PARTICIPATE <span>✦</span> NO STORY SPOILERS</p>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#top">
          <span className="brand-mark"><Compass size={21} strokeWidth={1.4} /></span>
          <span className="brand-name">IMMERSIVE GAMES <em>STUDIO</em></span>
        </a>
        <p>Every great adventure starts with a question.</p>
        <div className="footer-links"><a href="#details">Participation information</a><a href="#top">Back to top ↑</a></div>
        <small>© {new Date().getFullYear()} Immersive Games Studio. All rights reserved. Final rules and consent documents will be provided before participation.</small>
      </footer>
    </div>
  );
}

export default App;