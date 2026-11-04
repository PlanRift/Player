import { create } from 'zustand';

const SIDEBAR_STORAGE_KEY = 'planrift.sidebar.collapsed';

interface SidebarState {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

function loadInitialState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isCollapsed: loadInitialState(),

  toggleSidebar: () => {
    set((state) => {
      const next = !state.isCollapsed;
      if (typeof window !== 'undefined') {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      }
      return { isCollapsed: next };
    });
  },

  setCollapsed: (collapsed: boolean) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    }
    set({ isCollapsed: collapsed });
  },
}));
