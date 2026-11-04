import { useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';

interface CheatSheetOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

const SHORTCUT_GROUPS: Array<{ title: string; shortcuts: ShortcutItem[] }> = [
  {
    title: 'Playback Transport',
    shortcuts: [
      { keys: ['Space'], description: 'Play / Pause toggle' },
      { keys: ['['], description: 'Previous track' },
      { keys: [']'], description: 'Next track' },
      { keys: ['J'], description: 'Seek -10 seconds' },
      { keys: ['L'], description: 'Seek +10 seconds' },
      { keys: ['S'], description: 'Toggle shuffle mode' },
      { keys: ['R'], description: 'Cycle repeat (Off / All / One)' },
    ],
  },
  {
    title: 'Navigation & Rooms',
    shortcuts: [
      { keys: ['/', '⌘K'], description: 'Jump to Search page' },
      { keys: ['Q'], description: 'Toggle Queue drawer' },
      { keys: ['U'], description: 'Toggle Ambient Signature room' },
      { keys: ['Esc'], description: 'Close modals / Return back' },
    ],
  },
  {
    title: 'Help & Discovery',
    shortcuts: [
      { keys: ['?'], description: 'Toggle Keyboard Shortcuts' },
    ],
  },
];

export function CheatSheetOverlay({ isOpen, onClose }: CheatSheetOverlayProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcuts Cheat Sheet"
    >
      <div
        className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="h-14 border-b border-zinc-700 px-6 flex items-center justify-between bg-zinc-950 shrink-0">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-semibold text-zinc-100">
              Keyboard Shortcuts
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="text-[11px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700">
              ESC
            </kbd>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer transition-colors"
              aria-label="Close shortcuts dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2.5">
              <h3 className="font-mono text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                {group.title}
              </h3>
              <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-md bg-zinc-950/60 overflow-hidden">
                {group.shortcuts.map((sc) => (
                  <div
                    key={sc.description}
                    className="flex items-center justify-between px-3.5 py-2 text-xs"
                  >
                    <span className="text-zinc-300 font-medium">{sc.description}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {sc.keys.map((k) => (
                        <kbd
                          key={k}
                          className="font-mono text-[11px] text-zinc-300 bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded min-w-[24px] text-center shadow-xs"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Hint */}
        <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-950 text-xs font-mono text-zinc-500 text-center">
          Press any key directly outside input fields to trigger shortcuts
        </div>
      </div>
    </div>
  );
}
