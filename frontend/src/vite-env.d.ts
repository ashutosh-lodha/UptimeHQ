/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key (pk_test_… / pk_live_…). Public by design. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}
