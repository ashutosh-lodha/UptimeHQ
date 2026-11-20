import type { ReactNode } from 'react';
import { SignIn, SignUp } from '@clerk/react';
import { Link } from '../lib/router';

/** Clerk's components styled to match the app (blue accent, neutral surfaces). */
export const clerkAppearance = {
  variables: {
    colorPrimary: '#2563eb',
    colorText: '#111827',
    colorTextSecondary: '#6b7280',
    colorBackground: '#ffffff',
    colorInputBackground: '#ffffff',
    borderRadius: '8px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  elements: {
    // Fluid on phones: the card shrinks to the screen instead of overflowing it.
    rootBox: { width: '100%', display: 'flex', justifyContent: 'center' },
    cardBox: { width: '100%', maxWidth: '400px', boxShadow: '0 1px 2px rgba(16, 24, 40, 0.05)', border: '1px solid #e5e7eb' },
    card: { width: '100%' },
  },
};

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-stack">
        <Link to="/" className="auth-brand" aria-label="UptimeHQ home">
          <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path d="M6 17h5l3-7 4 13 3-6h5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>UptimeHQ</span>
        </Link>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  return (
    <AuthShell>
      <SignIn routing="path" path="/login" signUpUrl="/register" fallbackRedirectUrl="/" appearance={clerkAppearance} />
    </AuthShell>
  );
}

export function RegisterPage() {
  return (
    <AuthShell>
      <SignUp routing="path" path="/register" signInUrl="/login" fallbackRedirectUrl="/" appearance={clerkAppearance} />
    </AuthShell>
  );
}
