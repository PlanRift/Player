import { useState } from 'react';
import { X, GripVertical, ListMusic, ChevronUp, ChevronDown } from 'lucide-react';
import { usePlaybackStore } from '../../stores/playbackStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { CoverImage } from '../common/CoverImage';
import { TrackContextMenu } from '../common/TrackContextMenu';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function QueueDrawer() {
  const {
    queue,
    currentIndex,
    isQueueOpen,
    toggleQueue,
    playIndex,
    clearQueue,
    removeFromQueue,
    reorderQueue,
  } = usePlaybackStore();

  const { createPlaylist } = useLibraryStore();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  if (!isQueueOpen) return null;

  const handleSaveAsPlaylist = async () => {
    if (queue.length === 0) return;
    const name = window.prompt('Playlist name:');
    if (name?.trim()) {
      try {
        await createPlaylist(
          name.trim(),
          queue.map((q) => q.song.id)
        );
        alert(`Saved ${queue.length} tracks to playlist "${name.trim()}".`);
      } catch (err) {
        console.error('Failed to save queue as playlist:', err);
      }
    }
  };

  return (
    <aside
      className="fixed inset-y-0 right-0 w-80 sm:w-96 border-l border-zinc-700 bg-zinc-900 z-50 shadow-2xl flex flex-col justify-between select-none animate-in slide-in-from-right duration-200"
      aria-label="Playback Queue"
    >
      {/* Header */}
      <div className="h-14 border-b border-zinc-700 px-4 flex items-center justify-between bg-zinc-950 shrink-0">
        <div className="flex items-center gap-2">
          <ListMusic className="w-4 h-4 text-emerald-400" />
          <h2 className="font-semibold text-sm tracking-tight text-zinc-100">
            Playback Queue
          </h2>
          <span className="font-mono text-xs text-zinc-400">
            ({queue.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {queue.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              className="text-zinc-400 hover:text-red-400 font-mono text-xs px-2 py-1 cursor-pointer transition-colors"
            >
              CLEAR
            </button>
          )}
          <button
            type="button"
            onClick={toggleQueue}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer transition-colors"
            aria-label="Close queue drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Queue Items with HTML5 Drag-and-Drop */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800">
        {queue.length === 0 ? (
          <div className="p-8 text-center font-mono text-xs text-zinc-400">
            Queue is empty. Select an album or track to begin listening.
          </div>
        ) : (
          queue.map((item, idx) => {
            const isActive = idx === currentIndex;
            const isDragging = draggedIndex === idx;
            const isOver = dragOverIndex === idx;

            return (
              <div
                key={item.sessionId}
                draggable
                onDragStart={(e) => {
                  setDraggedIndex(idx);
                  e.dataTransfer.setData('text/plain', String(idx));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverIndex !== idx) setDragOverIndex(idx);
                }}
                onDragEnd={() => {
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                  if (!isNaN(fromIndex) && fromIndex !== idx) {
                    reorderQueue(fromIndex, idx);
                  }
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                onClick={() => playIndex(idx)}
                className={`flex items-center justify-between p-3 cursor-pointer transition-all group ${
                  isDragging ? 'opacity-40 bg-zinc-950' : ''
                } ${
                  isOver && !isDragging
                    ? 'border-t-2 border-emerald-400 bg-zinc-800/80'
                    : ''
                } ${
                  isActive
                    ? 'bg-zinc-800 text-emerald-400 border-l-2 border-emerald-400'
                    : 'hover:bg-zinc-800/60 text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  {/* Drag Handle & Arrow Up/Down Fallback */}
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <div
                      className="cursor-grab active:cursor-grabbing text-zinc-600 group-hover:text-zinc-400 transition-colors p-0.5 shrink-0"
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex flex-col items-center">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => reorderQueue(idx, idx - 1)}
                        className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 disabled:hover:text-zinc-600 p-0.5 cursor-pointer disabled:cursor-default"
                        title="Move up"
                        aria-label="Move track up in queue"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === queue.length - 1}
                        onClick={() => reorderQueue(idx, idx + 1)}
                        className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 disabled:hover:text-zinc-600 p-0.5 cursor-pointer disabled:cursor-default"
                        title="Move down"
                        aria-label="Move track down in queue"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="w-9 h-9 rounded shrink-0 border border-zinc-700 bg-zinc-950 overflow-hidden">
                    <CoverImage
                      coverId={item.song.coverArt || item.song.id}
                      songId={item.song.id}
                      alt=""
                      size={80}
                    />
                  </div>

                  <div className="min-w-0">
                    <div
                      className={`text-xs truncate ${
                        isActive ? 'font-semibold text-emerald-400' : 'text-zinc-100'
                      }`}
                    >
                      {item.song.title}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate">
                      {item.song.artist || 'Unknown'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-xs text-zinc-400">
                    {formatDuration(item.song.duration || 0)}
                  </span>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <TrackContextMenu
                      song={item.song}
                      isQueueContext={true}
                      onRemoveFromQueue={() => removeFromQueue(item.sessionId)}
                    />
                    <button
                      type="button"
                      onClick={() => removeFromQueue(item.sessionId)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 p-1 cursor-pointer transition-opacity"
                      title="Remove from queue"
                      aria-label="Remove from queue"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Drawer Info & Actions */}
      <div className="p-3 border-t border-zinc-800 bg-zinc-950 text-xs font-mono text-zinc-400 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between">
          <span>Now Playing #{currentIndex >= 0 ? currentIndex + 1 : 0}</span>
          <span>Total: {queue.length}</span>
        </div>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={handleSaveAsPlaylist}
            className="w-full py-1.5 px-3 rounded bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 text-center transition-colors cursor-pointer text-[11px]"
          >
            Save Queue As Playlist
          </button>
        )}
      </div>
    </aside>
  );
}
