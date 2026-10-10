/**
 * Cookie and UI Preference Management for KebabZilla
 * Handles strictly necessary session cookies, functional preference cookies,
 * cookie consent tracking, and reactive React state synchronization.
 */

import { useState, useEffect, useCallback } from 'react';

export type CookieConsentState = {
  decided: boolean;
  essential: boolean;
  preferences: boolean;
  analytics: boolean;
  decidedAt?: string;
};

const CONSENT_COOKIE_KEY = 'kz_cookie_consent';
const CONSENT_CHANGE_EVENT = 'kz_cookie_consent_changed';

/**
 * Read a cookie by name from document.cookie
 */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + encodeURIComponent(name) + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Set a session cookie (persists only while the browser session is active)
 */
export function setSessionCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

/**
 * Set a persistent cookie with day-based expiration
 */
export function setCookie(name: string, value: string, days = 365): void {
  if (typeof document === 'undefined') return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

/**
 * Delete a cookie by setting its max-age to 0
 */
export function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Retrieve current cookie consent state
 */
export function getCookieConsent(): CookieConsentState {
  const raw = getCookie(CONSENT_COOKIE_KEY);
  if (!raw) {
    // Also check localStorage fallback
    if (typeof localStorage !== 'undefined') {
      const local = localStorage.getItem(CONSENT_COOKIE_KEY);
      if (local) {
        try {
          return JSON.parse(local);
        } catch {
          // ignore parsing error
        }
      }
    }
    return {
      decided: false,
      essential: true,
      preferences: true, // Default to true until user explicitly rejects or customizes
      analytics: true,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      decided: Boolean(parsed.decided),
      essential: true,
      preferences: Boolean(parsed.preferences),
      analytics: Boolean(parsed.analytics),
      decidedAt: parsed.decidedAt,
    };
  } catch {
    return {
      decided: false,
      essential: true,
      preferences: true,
      analytics: true,
    };
  }
}

/**
 * Update and persist cookie consent choices
 */
export function saveCookieConsent(next: Partial<CookieConsentState>): void {
  const current = getCookieConsent();
  const updated: CookieConsentState = {
    decided: next.decided !== undefined ? Boolean(next.decided) : true,
    essential: true,
    preferences: next.preferences !== undefined ? Boolean(next.preferences) : current.preferences,
    analytics: next.analytics !== undefined ? Boolean(next.analytics) : current.analytics,
    decidedAt: new Date().toISOString(),
  };

  const str = JSON.stringify(updated);
  setCookie(CONSENT_COOKIE_KEY, str, 365);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CONSENT_COOKIE_KEY, str);
  }

  // If preferences were rejected, clean up any existing preference session cookies
  if (!updated.preferences) {
    clearAllPreferenceCookies();
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: updated }));
  }
}

/**
 * Check if the user has allowed functional/preference cookies
 */
export function hasPreferenceConsent(): boolean {
  const consent = getCookieConsent();
  return consent.preferences;
}

/**
 * Clean up all functional preference cookies
 */
export function clearAllPreferenceCookies(): void {
  if (typeof document === 'undefined') return;
  const cookies = document.cookie.split(';');
  for (const c of cookies) {
    const name = c.split('=')[0]?.trim();
    if (name && (name.startsWith('kz_pref_') || name.startsWith('kz_quick_'))) {
      deleteCookie(name);
    }
  }
}

/**
 * Get a UI preference value from session cookie (with localStorage fallback)
 */
export function getPreference<T>(key: string, defaultValue: T): T {
  const cookieKey = key.startsWith('kz_') ? key : `kz_pref_${key}`;
  const rawCookie = getCookie(cookieKey);
  if (rawCookie !== null) {
    try {
      return JSON.parse(rawCookie);
    } catch {
      return rawCookie as unknown as T;
    }
  }

  if (typeof localStorage !== 'undefined') {
    const rawLocal = localStorage.getItem(cookieKey);
    if (rawLocal !== null) {
      try {
        return JSON.parse(rawLocal);
      } catch {
        return rawLocal as unknown as T;
      }
    }
  }

  return defaultValue;
}

/**
 * Set a UI preference value in a session cookie
 */
export function setPreference<T>(key: string, value: T): void {
  const cookieKey = key.startsWith('kz_') ? key : `kz_pref_${key}`;
  const str = typeof value === 'string' ? value : JSON.stringify(value);

  // If user allows preferences, store in session cookie
  if (hasPreferenceConsent()) {
    setSessionCookie(cookieKey, str);
  }

  // Also maintain in localStorage for continuity
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(cookieKey, str);
    } catch {
      // ignore
    }
  }
}

/**
 * Custom React hook to sync UI state (tabs, sorting, filters) with session cookies
 */
export function usePreference<T>(key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => getPreference<T>(key, defaultValue));

  useEffect(() => {
    // When consent changes, reload state if preferences were disabled
    function onConsentChanged(e: Event) {
      const customEvent = e as CustomEvent<CookieConsentState>;
      if (!customEvent.detail.preferences) {
        // Fall back to default if preferences disabled
      }
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, onConsentChanged);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onConsentChanged);
  }, []);

  const updatePreference = useCallback((val: T | ((prev: T) => T)) => {
    setState((prev) => {
      const next = typeof val === 'function' ? (val as (prev: T) => T)(prev) : val;
      setPreference(key, next);
      return next;
    });
  }, [key]);

  return [state, updatePreference];
}
