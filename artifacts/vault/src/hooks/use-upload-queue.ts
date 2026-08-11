import { useState, useRef, useCallback } from 'react';

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  id: string;
  name: string;
  status: UploadStatus;
  /** Bytes transferred so far */
  loaded: number;
  /** Total file size in bytes */
  total: number;
  error?: string;
}

interface UploadJob {
  file: File;
  parentPath: string;
  /** Relative path within a folder upload, e.g. "photos/2024/beach.jpg" */
  relativePath?: string;
}

interface UseUploadQueueOptions {
  /** Called once per successfully uploaded file, use to invalidate queries */
  onFileComplete?: () => void;
  maxConcurrent?: number;
}

export interface UploadQueueHandle {
  items: UploadItem[];
  /** Add files to the upload queue and start uploading */
  addFiles: (files: File[], parentPath: string) => void;
  /** Abort an in-progress upload or cancel a pending one */
  cancel: (id: string) => void;
  /** Re-queue a failed item */
  retry: (id: string) => void;
  /** Remove all completed, failed, and cancelled entries from the list */
  dismiss: () => void;
  /** Whether the queue panel should be visible (any non-cancelled items exist) */
  hasActivity: boolean;
}

export function useUploadQueue({
  onFileComplete,
  maxConcurrent = 3,
}: UseUploadQueueOptions = {}): UploadQueueHandle {
  const [items, setItems] = useState<UploadItem[]>([]);

  // Refs: these hold stable references across renders without triggering re-renders
  const jobsRef = useRef<Map<string, UploadJob>>(new Map());
  const xhrRef = useRef<Map<string, XMLHttpRequest>>(new Map());
  const activeCountRef = useRef(0);
  const pendingIdsRef = useRef<string[]>([]);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  // Upload a single file via XHR, reporting progress events
  const uploadOne = useCallback(
    (id: string, job: UploadJob): Promise<void> => {
      updateItem(id, { status: 'uploading', loaded: 0 });

      const formData = new FormData();
      formData.append('files', job.file);
      formData.append('parentPath', job.parentPath);
      if (job.relativePath) {
        formData.append('relativePaths', JSON.stringify([job.relativePath]));
      }

      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current.set(id, xhr);

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            updateItem(id, { loaded: e.loaded, total: e.total });
          }
        });

        xhr.addEventListener('load', () => {
          xhrRef.current.delete(id);
          if (xhr.status >= 200 && xhr.status < 300) {
            updateItem(id, { status: 'done', loaded: job.file.size, total: job.file.size });
            onFileComplete?.();
            resolve();
          } else {
            let msg = `Server error ${xhr.status}`;
            try {
              const body = JSON.parse(xhr.responseText);
              if (body?.error) msg = body.error;
            } catch { /* ignore */ }
            updateItem(id, { status: 'error', error: msg });
            reject(new Error(msg));
          }
        });

        xhr.addEventListener('error', () => {
          xhrRef.current.delete(id);
          updateItem(id, { status: 'error', error: 'Network error' });
          reject(new Error('Network error'));
        });

        xhr.addEventListener('abort', () => {
          xhrRef.current.delete(id);
          updateItem(id, { status: 'cancelled' });
          reject(new Error('Cancelled'));
        });

        xhr.open('POST', '/api/files/upload');
        xhr.send(formData);
      });
    },
    [updateItem, onFileComplete],
  );

  // Drain the pending queue up to maxConcurrent active uploads
  const processNext = useCallback(() => {
    while (
      activeCountRef.current < maxConcurrent &&
      pendingIdsRef.current.length > 0
    ) {
      const id = pendingIdsRef.current.shift()!;
      const job = jobsRef.current.get(id);
      if (!job) continue; // was removed (e.g. cancelled before starting)

      activeCountRef.current++;
      uploadOne(id, job).finally(() => {
        activeCountRef.current--;
        processNext();
      });
    }
  }, [uploadOne, maxConcurrent]);

  const addFiles = useCallback(
    (files: File[], parentPath: string) => {
      if (files.length === 0) return;

      const newItems: UploadItem[] = files.map(file => {
        const id = crypto.randomUUID();
        const relativePath: string | undefined =
          (file as any)._customRelativePath ||
          (file.webkitRelativePath ? file.webkitRelativePath : undefined);

        jobsRef.current.set(id, { file, parentPath, relativePath });
        pendingIdsRef.current.push(id);

        return {
          id,
          name: file.name,
          status: 'pending',
          loaded: 0,
          total: file.size,
        };
      });

      setItems(prev => [...prev, ...newItems]);
      // Kick off processing after state update
      setTimeout(processNext, 0);
    },
    [processNext],
  );

  const cancel = useCallback(
    (id: string) => {
      const xhr = xhrRef.current.get(id);
      if (xhr) {
        // Currently uploading — abort
        xhr.abort();
      } else {
        // Still pending — remove from queue and mark cancelled
        pendingIdsRef.current = pendingIdsRef.current.filter(i => i !== id);
        jobsRef.current.delete(id);
        updateItem(id, { status: 'cancelled' });
      }
    },
    [updateItem],
  );

  const retry = useCallback(
    (id: string) => {
      // Find the item in state to rebuild the job (we still have the job in jobsRef if it failed)
      const job = jobsRef.current.get(id);
      if (!job) return;

      updateItem(id, { status: 'pending', loaded: 0, error: undefined });
      pendingIdsRef.current.push(id);
      setTimeout(processNext, 0);
    },
    [updateItem, processNext],
  );

  const dismiss = useCallback(() => {
    const terminal: UploadStatus[] = ['done', 'error', 'cancelled'];
    setItems(prev => {
      const removed = prev.filter(i => terminal.includes(i.status));
      removed.forEach(i => jobsRef.current.delete(i.id));
      return prev.filter(i => !terminal.includes(i.status));
    });
  }, []);

  const hasActivity = items.length > 0;

  return { items, addFiles, cancel, retry, dismiss, hasActivity };
}
