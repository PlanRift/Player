// The secret ships in client JS, which is acceptable for this single-user self-hosted app, NOT for a public multi-user service.

import { create } from 'zustand';
import { lastFmClient } from '@player/shared';

const STORAGE_API_KEY = 'planrift.lastfm.apiKey';
const STORAGE_API_SECRET = 'planrift.lastfm.apiSecret';
const STORAGE_SESSION_KEY = 'planrift.lastfm.sessionKey';
const STORAGE_USERNAME = 'planrift.lastfm.username';
const STORAGE_ENABLED = 'planrift.lastfm.enabled';

interface LastFmState {
  apiKey: string;
  apiSecret: string;
  sessionKey: string | null;
  username: string | null;
  isEnabled: boolean;
  isLoading: boolean;
  error: string | null;

  setCredentials: (apiKey: string, apiSecret: string) => void;
  clearCredentials: () => void;
  connect: (overrideApiKey?: string, overrideApiSecret?: string) => void;
  handleCallbackToken: (token: string) => Promise<boolean>;
  disconnect: () => void;
  setIsEnabled: (enabled: boolean) => void;
  isConnected: () => boolean;
}

const envApiKey = (import.meta as any).env?.VITE_LASTFM_API_KEY || '';
const envApiSecret = (import.meta as any).env?.VITE_LASTFM_API_SECRET || '';

export const useLastFmStore = create<LastFmState>((set, get) => {
  const initialApiKey =
    (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_API_KEY) : null) ||
    envApiKey;
  const initialApiSecret =
    (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_API_SECRET) : null) ||
    envApiSecret;
  const initialSession =
    typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_SESSION_KEY) : null;
  const initialUser =
    typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_USERNAME) : null;
  const initialEnabled =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_ENABLED) !== 'false'
      : true;

  return {
    apiKey: initialApiKey,
    apiSecret: initialApiSecret,
    sessionKey: initialSession,
    username: initialUser,
    isEnabled: initialEnabled,
    isLoading: false,
    error: null,

    isConnected: () => {
      const { sessionKey, apiKey, apiSecret } = get();
      return Boolean(sessionKey && apiKey && apiSecret);
    },

    setCredentials: (apiKey: string, apiSecret: string) => {
      const cleanKey = apiKey.trim();
      const cleanSecret = apiSecret.trim();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_API_KEY, cleanKey);
        localStorage.setItem(STORAGE_API_SECRET, cleanSecret);
      }
      set({ apiKey: cleanKey, apiSecret: cleanSecret, error: null });
    },

    clearCredentials: () => {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_API_KEY);
        localStorage.removeItem(STORAGE_API_SECRET);
        localStorage.removeItem(STORAGE_SESSION_KEY);
        localStorage.removeItem(STORAGE_USERNAME);
      }
      set({
        apiKey: '',
        apiSecret: '',
        sessionKey: null,
        username: null,
        error: null,
      });
    },

    connect: (overrideApiKey?: string, overrideApiSecret?: string) => {
      if (overrideApiKey !== undefined && overrideApiSecret !== undefined) {
        get().setCredentials(overrideApiKey, overrideApiSecret);
      }

      const { apiKey, apiSecret } = get();
      if (!apiKey) {
        set({ error: 'Please provide a Last.fm API Key to connect.' });
        return;
      }
      if (!apiSecret) {
        set({ error: 'Please provide a Last.fm API Shared Secret to connect.' });
        return;
      }

      if (typeof window === 'undefined') return;
      const callbackUrl = window.location.origin + window.location.pathname;
      const authUrl = lastFmClient.getAuthUrl(apiKey, callbackUrl);
      window.location.href = authUrl;
    },

    handleCallbackToken: async (token: string) => {
      const { apiKey, apiSecret } = get();
      if (!apiKey || !apiSecret) {
        set({ error: 'Missing Last.fm API Key or Secret in configuration.' });
        return false;
      }

      set({ isLoading: true, error: null });
      try {
        const session = await lastFmClient.getSession(token, apiKey, apiSecret);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_SESSION_KEY, session.key);
          localStorage.setItem(STORAGE_USERNAME, session.name);
          localStorage.setItem(STORAGE_ENABLED, 'true');
        }
        set({
          sessionKey: session.key,
          username: session.name,
          isEnabled: true,
          isLoading: false,
          error: null,
        });
        return true;
      } catch (err: any) {
        console.error('Failed to authenticate Last.fm session:', err);
        set({
          isLoading: false,
          error: err?.message || 'Authentication with Last.fm failed.',
        });
        return false;
      }
    },

    disconnect: () => {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_SESSION_KEY);
        localStorage.removeItem(STORAGE_USERNAME);
      }
      set({
        sessionKey: null,
        username: null,
        error: null,
      });
    },

    setIsEnabled: (enabled: boolean) => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_ENABLED, enabled ? 'true' : 'false');
      }
      set({ isEnabled: enabled });
    },
  };
});
