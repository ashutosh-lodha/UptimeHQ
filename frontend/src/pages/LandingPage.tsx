import { Link } from '../lib/router';
import '../styles/landing.css';

function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M6 17h5l3-7 4 13 3-6h5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const FEATURES = [
  {
    title: 'Checks every 5 seconds',
    text: 'Pick an interval from 5 s to 10 min. Each check runs on a scheduled queue with overlap protection, so slow endpoints never pile up.',
    icon: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  },
  {
    title: 'Incidents & email alerts',
    text: 'Failures open an incident with its cause and duration. You get one email when a service goes down and one when it recovers.',
    icon: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  },
  {
    title: 'Response-time history',
    text: 'Charts and uptime percentages over 24 hours, 7 days or 30 days, per monitor and across your whole fleet.',
    icon: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  },
  {
    title: 'Protected endpoints',
    text: 'Monitor private APIs with a bearer token, basic auth, an API key, custom headers or OAuth2 client credentials. Secrets are encrypted at rest.',
    icon: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  },
  {
    title: 'Safe by design',
    text: 'Every target is checked against private and internal networks, on each request and every redirect, so monitors cannot be used to probe your infrastructure.',
    icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  },
  {
    title: 'Expected status ranges',
    text: 'Choose the method, timeout and the HTTP status range that counts as healthy, from a plain 200 to a full 2xx–3xx window.',
    icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  },
];

/** Failure types the checker classifies (backend: httpCheck.classifyError + auth outcomes). */
const DETECTS = [
  { tag: 'Bad status', tone: 'down', title: 'Server errors (5xx)', text: '500, 502, 503 or 504 from a crashed app, a bad deploy or an overloaded backend.' },
  { tag: 'Bad status', tone: 'down', title: 'Unexpected status codes', text: 'A 404, 410 or any code outside the range you marked as healthy.' },
  { tag: 'Timeout', tone: 'warn', title: 'No response in time', text: 'No response within your timeout, or a connection that never completes.' },
  { tag: 'Network', tone: 'down', title: 'Connection refused or reset', text: 'Nothing listening on the port, or the server drops the connection.' },
  { tag: 'Network', tone: 'down', title: 'DNS failures', text: 'The domain stops resolving, has expired or its records are misconfigured.' },
  { tag: 'Network', tone: 'down', title: 'Host unreachable', text: 'The server or its network is offline and cannot be routed to.' },
  { tag: 'Network', tone: 'down', title: 'SSL/TLS certificate problems', text: 'Expired, self-signed or wrong-hostname certificates that browsers would reject.' },
  { tag: 'Bad status', tone: 'down', title: 'Redirect loops', text: 'A URL that keeps redirecting instead of ever returning a page.' },
  { tag: 'Auth failed', tone: 'warn', title: 'Rejected credentials (401)', text: 'Your API key, token or password stopped working or was revoked.' },
  { tag: 'Forbidden', tone: 'warn', title: 'Access denied (403)', text: 'The endpoint answers but refuses the monitor access.' },
  { tag: 'Token error', tone: 'warn', title: 'OAuth2 token failures', text: 'The token server is down or rejects the client ID and secret.' },
  { tag: 'Blocked', tone: 'muted', title: 'Unsafe destinations', text: 'URLs that resolve to private or internal addresses are refused, never fetched.' },
];

const LIFECYCLE = [
  { title: 'Scheduled check', text: 'A background worker requests your URL on your interval, from 5 seconds to 10 minutes.' },
  { title: 'Classified result', text: 'Every response is recorded with its status code, response time and failure type.' },
  { title: 'Incident opened', text: 'The first failed check opens an incident and sends a "down" email right away.' },
  { title: 'Tracked while down', text: 'Further failures stay in the same incident, so you get one alert, not a flood.' },
  { title: 'Resolved on recovery', text: 'The first successful check closes the incident, records its duration and emails you.' },
];

const STEPS = [
  { title: 'Create an account', text: 'Sign up with email or Google in a few seconds.' },
  { title: 'Add a monitor', text: 'Enter a URL, choose how often to check it and what a healthy response looks like.' },
  { title: 'Get alerted', text: 'Watch status and response times live, and receive an email the moment something breaks.' },
];

/** Product screenshots in public/screens, taken against the test lab (testlab/). */
function Preview() {
  return (
    <a className="lp-preview" href="/screens/dashboard.webp" target="_blank" rel="noreferrer">
      <div className="lp-preview-bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <img src="/screens/dashboard.webp" width={1440} height={960} alt="UptimeHQ dashboard with a coloured response-time line for each monitor" />
    </a>
  );
}

const EXAMPLES = [
  { shot: 'server-error', title: 'A server error' },
  { shot: 'dns', title: 'A DNS failure' },
];

export function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link to="/" className="lp-brand">
            <BrandMark />
            <span>UptimeHQ</span>
          </Link>
          <nav className="lp-nav-links" aria-label="Page sections">
            <a href="#features">Features</a>
            <a href="#detects">What it detects</a>
            <a href="#incidents">Incidents</a>
            <a href="#how">Get started</a>
          </nav>
          <div className="lp-nav-actions">
            <Link to="/login" className="btn btn-ghost">
              Sign in
            </Link>
            <Link to="/register" className="btn btn-primary">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-container lp-hero-inner">
            <div className="lp-hero-copy">
              <span className="lp-eyebrow">Website &amp; API uptime monitoring</span>
              <h1>Know the moment your site goes down.</h1>
              <p className="lp-lead">
                UptimeHQ checks your websites and APIs as often as every 5 seconds, records every response, opens incidents
                automatically and emails you when something breaks and when it recovers.
              </p>
              <div className="lp-cta">
                <Link to="/register" className="btn btn-primary lp-btn-lg">
                  Start monitoring for free
                </Link>
                <Link to="/login" className="btn btn-secondary lp-btn-lg">
                  Sign in
                </Link>
              </div>
              <ul className="lp-checks">
                <li>5 s – 10 min intervals</li>
                <li>Email alerts</li>
                <li>Authenticated APIs</li>
              </ul>
            </div>
            <Preview />
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="lp-container">
            <div className="lp-section-head">
              <h2>Everything you need to watch your services</h2>
              <p>From a single landing page to a fleet of private APIs.</p>
            </div>
            <div className="lp-features">
              {FEATURES.map((f) => (
                <article key={f.title} className="lp-feature">
                  <span className="lp-feature-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d={f.icon} />
                    </svg>
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="detects" className="lp-section lp-section-alt">
          <div className="lp-container">
            <div className="lp-section-head">
              <h2>What UptimeHQ detects</h2>
              <p>Every failed check is classified, so you know why a service is down, not just that it is.</p>
            </div>
            <ul className="lp-detects">
              {DETECTS.map((d) => (
                <li key={d.title}>
                  <span className={`lp-chip lp-chip-${d.tone}`}>{d.tag}</span>
                  <div>
                    <h3>{d.title}</h3>
                    <p>{d.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="lp-examples">
              {EXAMPLES.map((e) => (
                <figure key={e.shot}>
                  <a className="lp-shot" href={`/screens/down-${e.shot}.webp`} target="_blank" rel="noreferrer">
                    <img src={`/screens/down-${e.shot}.webp`} loading="lazy" alt={`UptimeHQ detecting ${e.title.toLowerCase()}`} />
                  </a>
                  <figcaption>Example: {e.title.toLowerCase()}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section id="incidents" className="lp-section">
          <div className="lp-container">
            <div className="lp-section-head">
              <h2>How an incident works</h2>
              <p>From the first failed request to the recovery email.</p>
            </div>
            <ol className="lp-timeline">
              {LIFECYCLE.map((s, i) => (
                <li key={s.title}>
                  <span className={`lp-tl-dot ${i === 2 || i === 3 ? 'down' : i === 4 ? 'up' : ''}`} aria-hidden="true" />
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="how" className="lp-section lp-section-alt">
          <div className="lp-container">
            <div className="lp-section-head">
              <h2>Up and running in a minute</h2>
            </div>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-step-num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-container">
            <div className="lp-band">
              <div>
                <h2>Start monitoring your first site</h2>
                <p>Create an account and add a monitor. The first check runs immediately.</p>
              </div>
              <div className="lp-cta">
                <Link to="/register" className="btn lp-btn-light lp-btn-lg">
                  Create account
                </Link>
                <Link to="/login" className="btn lp-btn-outline-light lp-btn-lg">
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <span className="lp-brand lp-brand-sm">
            <BrandMark size={22} />
            <span>UptimeHQ</span>
          </span>
          <span className="muted small">Website and API uptime monitoring.</span>
        </div>
      </footer>
    </div>
  );
}
