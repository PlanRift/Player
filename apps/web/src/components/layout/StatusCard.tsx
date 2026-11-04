import { useConnectionStore } from '../../stores/connectionStore';

export function StatusCard() {
  const { statusTitle, statusMessage, showRetry, checkConnection, hideStatus } = useConnectionStore();

  if (!statusTitle) return null;

  return (
    <div className="p-6 pb-0 max-w-7xl mx-auto w-full">
      <section aria-live="polite" className="studio-panel rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-100">
              {statusTitle}
            </h2>
            <p className="text-sm text-zinc-300">{statusMessage}</p>
          </div>
          <div className="flex items-center gap-2">
            {showRetry && (
              <button
                type="button"
                onClick={() => checkConnection()}
                className="min-h-[40px] px-4 py-2 rounded-md bg-emerald-400 text-zinc-950 font-semibold text-sm hover:bg-emerald-300 active:bg-emerald-500 transition-colors cursor-pointer"
              >
                Retry Connection
              </button>
            )}
            <button
              type="button"
              onClick={hideStatus}
              className="px-3 py-1.5 text-zinc-400 hover:text-zinc-100 font-mono text-xs cursor-pointer"
            >
              [DISMISS]
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
