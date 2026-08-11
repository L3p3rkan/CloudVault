import { useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, X, ChevronDown, ChevronUp, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { type UploadItem, type UploadQueueHandle } from '@/hooks/use-upload-queue';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface UploadQueuePanelProps {
  handle: UploadQueueHandle;
}

export function UploadQueuePanel({ handle }: UploadQueuePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { items, cancel, retry, dismiss } = handle;

  if (items.length === 0) return null;

  const doneCount = items.filter(i => i.status === 'done').length;
  const errorCount = items.filter(i => i.status === 'error').length;
  const activeCount = items.filter(i => i.status === 'uploading').length;
  const total = items.length;
  const allSettled = items.every(i => i.status === 'done' || i.status === 'error' || i.status === 'cancelled');

  const headerLabel = activeCount > 0
    ? `Uploading ${activeCount} file${activeCount !== 1 ? 's' : ''}…`
    : allSettled
      ? errorCount > 0
        ? `${doneCount} done · ${errorCount} failed`
        : `${doneCount} file${doneCount !== 1 ? 's' : ''} uploaded`
      : `${doneCount} of ${total} complete`;

  return (
    <div className={cn(
      "fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-card shadow-2xl shadow-black/40 overflow-hidden",
      "transition-all duration-200"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 min-w-0">
          {activeCount > 0 && (
            <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" />
          )}
          {allSettled && errorCount === 0 && (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          {allSettled && errorCount > 0 && (
            <XCircle className="w-4 h-4 text-destructive shrink-0" />
          )}
          <span className="text-sm font-medium truncate">{headerLabel}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {allSettled && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={dismiss}
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* File list */}
      {!collapsed && (
        <div className="max-h-72 overflow-y-auto divide-y divide-border/50">
          {items.map(item => (
            <UploadRow key={item.id} item={item} onCancel={() => cancel(item.id)} onRetry={() => retry(item.id)} />
          ))}
        </div>
      )}

      {/* Overall progress bar (collapsed state) */}
      {collapsed && total > 0 && (
        <div className="px-4 py-2">
          <Progress value={(doneCount / total) * 100} className="h-1" />
        </div>
      )}
    </div>
  );
}

function UploadRow({ item, onCancel, onRetry }: {
  item: UploadItem;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const pct = item.total > 0 ? Math.round((item.loaded / item.total) * 100) : 0;

  return (
    <div className="px-4 py-3 flex flex-col gap-1.5 group">
      <div className="flex items-center gap-2">
        {/* Status icon */}
        <div className="shrink-0">
          {item.status === 'uploading' && (
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
          )}
          {item.status === 'pending' && (
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          {item.status === 'done' && (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          )}
          {item.status === 'error' && (
            <XCircle className="w-3.5 h-3.5 text-destructive" />
          )}
          {item.status === 'cancelled' && (
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>

        {/* Filename */}
        <span className="flex-1 text-xs font-medium truncate text-foreground/90">{item.name}</span>

        {/* Action buttons */}
        <div className="shrink-0 flex items-center">
          {(item.status === 'uploading' || item.status === 'pending') && (
            <button
              className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded"
              onClick={onCancel}
              title="Cancel"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          {item.status === 'error' && (
            <button
              className="text-muted-foreground hover:text-primary transition-colors p-0.5 rounded flex items-center gap-1"
              onClick={onRetry}
              title="Retry"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar (uploading) */}
      {item.status === 'uploading' && (
        <div className="flex items-center gap-2">
          <Progress value={pct} className="h-1 flex-1" />
          <span className="text-[10px] font-mono text-muted-foreground w-8 text-right shrink-0">{pct}%</span>
        </div>
      )}

      {/* Bytes info */}
      {item.status === 'uploading' && item.total > 0 && (
        <p className="text-[10px] font-mono text-muted-foreground">
          {formatBytes(item.loaded)} / {formatBytes(item.total)}
        </p>
      )}

      {/* Error message */}
      {item.status === 'error' && item.error && (
        <p className="text-[10px] text-destructive">{item.error}</p>
      )}

      {/* Pending label */}
      {item.status === 'pending' && (
        <p className="text-[10px] text-muted-foreground font-mono">{formatBytes(item.total)} · queued</p>
      )}

      {/* Done info */}
      {item.status === 'done' && (
        <p className="text-[10px] font-mono text-muted-foreground">{formatBytes(item.total)}</p>
      )}
    </div>
  );
}
