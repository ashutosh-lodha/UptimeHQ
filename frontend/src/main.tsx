import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { RouterProvider, useRouter } from './lib/router';
import { ToastProvider } from './components/Toast';
import './styles/global.css';

/** Baked in at build time (Docker build arg / frontend .env). Publishable keys are safe to expose. */
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/** Lets Clerk's components navigate with the app's router (no full page reloads). */
function ClerkWithRouter({ children }: { children: ReactNode }) {
  const { navigate } = useRouter();
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY!}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/login"
      signUpUrl="/register"
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}

function MissingClerkConfig() {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>Sign-in is not configured</h1>
        <p className="subtitle" style={{ marginTop: 8 }}>
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> (Docker: <code>CLERK_PUBLISHABLE_KEY</code> in <code>.env</code>) and rebuild the frontend. See README
          “Clerk setup”.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {PUBLISHABLE_KEY ? (
      <RouterProvider>
        <ClerkWithRouter>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </ClerkWithRouter>
      </RouterProvider>
    ) : (
      <MissingClerkConfig />
    )}
  </StrictMode>,
);
