import React, { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { Server, Download, FileText, AlertCircle, Loader2, FileIcon, Clock, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SharedFileMeta {
  name: string;
  size: number;
  mimeType: string | null;
  expiresAt: string | null;
  isFolder: boolean;
}

interface FolderFile {
  id: number;
  name: string;
  size: number;
  mimeType: string | null;
  path: string;
  parentPath: string;
}

interface ApiError {
  error: string;
  status: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getPreviewCategory(mimeType: string | null): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none' {
  if (!mimeType) return 'none';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'text';
  return 'none';
}

function formatExpiry(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `Expires in ${days}d ${hours % 24}h`;
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `Expires in ${hours}h ${mins}m`;
  return `Expires in ${mins}m`;
}

function ErrorPage({ status, message }: { status: number; message: string }) {
  const isExpired = status === 410;
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Minimal header */}
      <header className="border-b border-border px-6 py-3 flex items-center gap-2">
        <Server className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Vault</span>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {isExpired ? 'Link Expired' : 'Link Not Found'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isExpired
              ? 'This share link has expired and is no longer available.'
              : message || 'This share link is invalid or has been revoked.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function TextPreview({ downloadUrl }: { downloadUrl: string }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const MAX = 32 * 1024; // 32 KB
    fetch(downloadUrl)
      .then(async (r) => {
        const reader = r.body?.getReader();
        if (!reader) { setText(''); return; }
        const chunks: BlobPart[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
          total += value.length;
          if (total >= MAX) { setTruncated(true); reader.cancel(); break; }
        }
        const blob = new Blob(chunks);
        setText(await blob.text());
      })
      .catch(() => setText(null))
      .finally(() => setLoading(false));
  }, [downloadUrl]);

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading preview…
    </div>
  );
  if (text === null) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
      Could not load text preview.
    </div>
  );

  return (
    <div className="relative">
      <pre className="text-xs font-mono bg-muted/50 rounded-lg p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-words text-foreground">
        {text}
      </pre>
      {truncated && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Preview truncated to 32 KB — download the file for the full content.
        </p>
      )}
    </div>
  );
}

export default function SharePreviewPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [meta, setMeta] = useState<SharedFileMeta | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFile[] | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const downloadUrl = `/api/share/${token}`;
  const inlineUrl = `/api/share/${token}/inline`;

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${token}/meta`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) {
          setApiError({ error: body.error ?? 'Unknown error', status: r.status });
        } else {
          const fileMeta = body as SharedFileMeta;
          setMeta(fileMeta);
          if (fileMeta.isFolder) {
            // Load folder contents separately
            fetch(`/api/share/${token}/folder-files`)
              .then(async (fr) => fr.ok ? fr.json() : [])
              .then((files) => setFolderFiles(files as FolderFile[]))
              .catch(() => setFolderFiles([]));
          }
        }
      })
      .catch(() => setApiError({ error: 'Network error', status: 0 }))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (apiError) {
    return <ErrorPage status={apiError.status} message={apiError.error} />;
  }

  if (!meta) return null;

  const expiry = formatExpiry(meta.expiresAt);

  // ── Folder share view ───────────────────────────────────────────────────────
  if (meta.isFolder) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border px-6 py-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Vault</span>
          <span className="text-muted-foreground text-sm ml-1">· Shared folder</span>
        </header>
        <div className="flex-1 flex flex-col items-center justify-start p-6 gap-6 max-w-3xl mx-auto w-full pt-10">
          <div className="w-full border border-border rounded-xl bg-card p-5 space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Folder className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-base font-semibold truncate" title={meta.name}>{meta.name}</h1>
                <div className="flex gap-4 mt-0.5">
                  {folderFiles !== null && (
                    <span className="text-xs text-muted-foreground">{folderFiles.length} file{folderFiles.length !== 1 ? 's' : ''}</span>
                  )}
                  {expiry && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {expiry}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {folderFiles === null ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading folder contents…</span>
            </div>
          ) : folderFiles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Folder className="w-10 h-10 opacity-30 mx-auto mb-3" />
              <p className="text-sm">This folder is empty.</p>
            </div>
          ) : (
            <div className="w-full border border-border rounded-xl bg-card overflow-hidden divide-y divide-border">
              {folderFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                  <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                  </div>
                  <a
                    href={`/api/share/${token}/folder-file/${f.id}`}
                    download={f.name}
                  >
                    <Button size="sm" variant="outline" className="shrink-0">
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Download
                    </Button>
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── File share view ─────────────────────────────────────────────────────────
  const category = getPreviewCategory(meta.mimeType);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Minimal header */}
      <header className="border-b border-border px-6 py-3 flex items-center gap-2">
        <Server className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Vault</span>
        <span className="text-muted-foreground text-sm ml-1">· Shared file</span>
      </header>

      <div className="flex-1 flex flex-col items-center justify-start p-6 gap-6 max-w-3xl mx-auto w-full pt-10">
        {/* File info card */}
        <div className="w-full border border-border rounded-xl bg-card p-5 space-y-3">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <FileIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-foreground truncate" title={meta.name}>
                {meta.name}
              </h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                <span className="text-xs text-muted-foreground">{formatBytes(meta.size)}</span>
                {meta.mimeType && (
                  <span className="text-xs text-muted-foreground font-mono">{meta.mimeType}</span>
                )}
                {expiry && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {expiry}
                  </span>
                )}
              </div>
            </div>
          </div>

          <a href={downloadUrl} download={meta.name}>
            <Button className="w-full mt-1" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </a>
        </div>

        {/* Preview area */}
        <div className="w-full">
          {category === 'image' && (
            <div className="flex items-center justify-center bg-muted/30 rounded-xl border border-border p-4 max-h-[70vh] overflow-hidden">
              <img
                src={inlineUrl}
                alt={meta.name}
                className="max-w-full max-h-[65vh] object-contain rounded-lg"
              />
            </div>
          )}

          {category === 'video' && (
            <div className="rounded-xl border border-border overflow-hidden bg-black">
              <video
                src={inlineUrl}
                controls
                className="w-full max-h-[70vh]"
              />
            </div>
          )}

          {category === 'audio' && (
            <div className="rounded-xl border border-border bg-card p-6">
              <audio src={inlineUrl} controls className="w-full" />
            </div>
          )}

          {category === 'pdf' && (
            <div className="rounded-xl border border-border overflow-hidden" style={{ height: '70vh' }}>
              <iframe
                src={inlineUrl}
                title={meta.name}
                className="w-full h-full"
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          {category === 'text' && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-mono">{meta.name}</span>
              </div>
              <div className="p-4">
                <TextPreview downloadUrl={inlineUrl} />
              </div>
            </div>
          )}

          {category === 'none' && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <FileIcon className="w-10 h-10 opacity-40" />
              <p className="text-sm">No preview available for this file type.</p>
              <p className="text-xs">Use the Download button above to save the file.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
