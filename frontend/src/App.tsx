import { useEffect } from 'react';
import { useAuth } from './lib/auth';
import { Link, matchPath, useRouter } from './lib/router';
import { Layout } from './components/Layout';
import { EmptyState, Spinner } from './components/ui';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { MonitorsPage } from './pages/MonitorsPage';
import { MonitorFormPage } from './pages/MonitorFormPage';
import { MonitorDetailPage } from './pages/MonitorDetailPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { SettingsPage } from './pages/SettingsPage';

function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(to, { replace: true }), [to, navigate]);
  return null;
}

function protectedRoute(path: string) {
  if (path === '/' || path === '') return <DashboardPage />;
  if (path === '/monitors') return <MonitorsPage />;
  if (path === '/monitors/new') return <MonitorFormPage />;
  let m = matchPath('/monitors/:id/edit', path);
  if (m) return <MonitorFormPage key={m.id} id={m.id} />;
  m = matchPath('/monitors/:id', path);
  if (m) return <MonitorDetailPage key={m.id} id={m.id} />;
  if (path === '/incidents') return <IncidentsPage />;
  if (path === '/settings') return <SettingsPage />;
  return (
    <div className="card">
      <EmptyState
        title="Page not found"
        action={
          <Link to="/" className="btn btn-primary">
            Go to dashboard
          </Link>
        }
      />
    </div>
  );
}

export function App() {
  const { path } = useRouter();
  const { user, loading, error, retry, logout } = useAuth();

  // Clerk's sign-in/sign-up use sub-paths (e.g. /login/factor-one, /register/verify-email-address).
  const onAuthPage = path === '/login' || path.startsWith('/login/') || path === '/register' || path.startsWith('/register/');
  if (onAuthPage && !error) {
    if (user) return <Redirect to="/" />;
    return path.startsWith('/login') ? <LoginPage /> : <RegisterPage />;
  }

  if (loading) return <Spinner label="Loading UptimeHQ…" />;

  // Signed-out visitors on "/" get the public landing page; signed-in users get the dashboard.
  if (!user && !error && (path === '/' || path === '')) return <LandingPage />;

  if (error) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h1>We couldn’t open your account</h1>
          <p className="subtitle" style={{ margin: '8px 0 20px' }}>
            {error.message}
          </p>
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={logout}>
              Sign out
            </button>
            <button className="btn btn-primary" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;

  return <Layout>{protectedRoute(path)}</Layout>;
}
