import { create } from 'zustand';
import { subsonicClient } from '@player/shared';

export type ConnectionStatus = 'online' | 'offline' | 'checking' | 'error';

interface ConnectionState {
  status: ConnectionStatus;
  statusTitle: string | null;
  statusMessage: string | null;
  showRetry: boolean;

  checkConnection: () => Promise<boolean>;
  showStatus: (params: { title: string; message: string; showRetry?: boolean }) => void;
  hideStatus: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'checking',
  statusTitle: null,
  statusMessage: null,
  showRetry: false,

  checkConnection: async () => {
    set({ status: 'checking' });
    try {
      const ok = await subsonicClient.ping();
      if (ok) {
        set({
          status: 'online',
          statusTitle: null,
          statusMessage: null,
          showRetry: false,
        });
        return true;
      } else {
        set({
          status: 'error',
          statusTitle: 'Navidrome Server Unreachable',
          statusMessage: 'Could not communicate with the Navidrome server. Check your credentials and server URL.',
          showRetry: true,
        });
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        status: 'error',
        statusTitle: 'Connection Error',
        statusMessage: msg,
        showRetry: true,
      });
      return false;
    }
  },

  showStatus: ({ title, message, showRetry = false }) => {
    set({
      statusTitle: title,
      statusMessage: message,
      showRetry,
    });
  },

  hideStatus: () => {
    set({
      statusTitle: null,
      statusMessage: null,
      showRetry: false,
    });
  },
}));
