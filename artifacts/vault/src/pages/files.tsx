import React, { useState, useRef, useCallback } from 'react';
import { 
  useListFiles, 
  getListFilesQueryKey,
  useCreateFolder,
  useDeleteFile,
  useGetRecentFiles,
  getGetRecentFilesQueryKey,
  getGetStorageStatsQueryKey,
  useGetFileMeta,
  useCreateShareToken,
  useListShareTokens,
  getListShareTokensQueryKey,
  useRevokeShareToken,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Folder, File as FileIcon, FileImage, FileVideo, FileAudio, FileText,
  Upload, Plus, Grid, List, Download, Trash2, Eye, ChevronRight, Home,
  FolderUp, RefreshCcw, X, Share2, Copy, Check, Link, Clock, FolderSymlink
} from 'lucide-react';
import { formatBytes, formatDate, cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { 
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator 
} from '@/components/ui/context-menu';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useUploadQueue } from '@/hooks/use-upload-queue';
import { UploadQueuePanel } from '@/components/upload-queue-panel';

// Guess MIME type from filename extension when the server didn't detect one
// (common for files uploaded from iOS or generic binary uploads)
function guessMimeFromName(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
    pdf: 'application/pdf',
    txt: 'text/plain', md: 'text/plain', json: 'application/json',
    ts: 'text/plain', tsx: 'text/plain', js: 'text/plain',
    jsx: 'text/plain', css: 'text/plain', html: 'text/html',
    csv: 'text/plain', xml: 'text/plain',
  };
  return ext ? map[ext] : undefined;
}

// Helper for file icons
function getFileIcon(mimeType: string | null | undefined, isFolder: boolean) {
  if (isFolder) return <Folder className="w-5 h-5 text-primary" fill="currentColor" fillOpacity={0.2} />;
  if (!mimeType) return <FileIcon className="w-5 h-5 text-muted-foreground" />;
  if (mimeType.startsWith('image/')) return <FileImage className="w-5 h-5 text-blue-400" />;
  if (mimeType.startsWith('video/')) return <FileVideo className="w-5 h-5 text-purple-400" />;
  if (mimeType.startsWith('audio/')) return <FileAudio className="w-5 h-5 text-yellow-400" />;
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf') return <FileText className="w-5 h-5 text-green-400" />;
  return <FileIcon className="w-5 h-5 text-muted-foreground" />;
}

export default function FilesPage() {
  const [currentPath, setCurrentPath] = useState('/');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);

  const { data: files, isLoading, refetch: refetchFiles } = useListFiles(
    { path: currentPath },
    { query: { queryKey: getListFilesQueryKey({ path: currentPath }) } }
  );

  const { data: recentFiles } = useGetRecentFiles({ limit: 5 });

  const createFolder = useCreateFolder();
  const deleteFile = useDeleteFile();

  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [previewFileId, setPreviewFileId] = useState<number | null>(null);
  const [shareFileId, setShareFileId] = useState<number | null>(null);
  const [moveItem, setMoveItem] = useState<{ id: number; name: string; parentPath: string } | null>(null);

  const invalidateData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListFilesQueryKey({ path: currentPath }) });
    queryClient.invalidateQueries({ queryKey: getGetStorageStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentFilesQueryKey() });
  }, [queryClient, currentPath]);

  // Upload queue: XHR-based, per-file progress, cancel & retry support
  const uploadQueue = useUploadQueue({ onFileComplete: invalidateData });

  const startUpload = useCallback((uploadFiles: File[], parentPath: string) => {
    if (uploadFiles.length === 0) return;
    uploadQueue.addFiles(uploadFiles, parentPath);
    // Reset input values so the same file(s) can be re-selected later
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }, [uploadQueue]);

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.items) {
      // Handle folders via FileSystem API
      const items = Array.from(e.dataTransfer.items).filter(i => i.kind === 'file');
      const filesToUpload: File[] = [];

      const processEntry = async (entry: FileSystemEntry): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          return new Promise<void>((resolve) => {
            fileEntry.file((file) => {
              (file as any)._customRelativePath = entry.fullPath.substring(1);
              filesToUpload.push(file);
              resolve();
            });
          });
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry;
          const reader = dirEntry.createReader();
          return new Promise<void>((resolve) => {
            reader.readEntries(async (entries) => {
              for (const child of entries) await processEntry(child);
              resolve();
            });
          });
        }
      };

      await Promise.all(
        items.map(item => {
          const entry = item.webkitGetAsEntry();
          return entry ? processEntry(entry) : Promise.resolve();
        })
      );
      startUpload(filesToUpload, currentPath);
    } else {
      startUpload(Array.from(e.dataTransfer.files), currentPath);
    }
  };

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    createFolder.mutate({ data: { name: newFolderName, parentPath: currentPath } }, {
      onSuccess: () => {
        setNewFolderModalOpen(false);
        setNewFolderName('');
        invalidateData();
      },
      onError: () => toast({ title: 'Failed to create folder', variant: 'destructive' })
    });
  };

  const handleMove = async (id: number, newParentPath: string) => {
    const resp = await fetch(`/api/files/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newParentPath }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      toast({ title: (err as any).error || 'Move failed', variant: 'destructive' });
      return;
    }
    toast({ title: 'Moved successfully' });
    invalidateData();
    setMoveItem(null);
  };

  const handleDelete = (id: number) => {
    deleteFile.mutate({ id }, {
      onSuccess: () => {
        toast({ title: 'Item deleted' });
        invalidateData();
      },
      onError: () => toast({ title: 'Failed to delete item', variant: 'destructive' })
    });
  };

  // Navigation
  const parts = currentPath.split('/').filter(Boolean);
  const breadcrumbs = [
    { name: 'Home', path: '/' },
    ...parts.map((part, i) => ({
      name: part,
      path: '/' + parts.slice(0, i + 1).join('/')
    }))
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-background relative"
         onDragOver={handleDragOver}
         onDragLeave={handleDragLeave}
         onDrop={handleDrop}>
      
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm border-2 border-primary border-dashed m-4 rounded-xl flex items-center justify-center">
          <div className="bg-background/80 p-8 rounded-2xl shadow-xl flex flex-col items-center pointer-events-none">
            <Upload className="w-12 h-12 text-primary mb-4 animate-bounce" />
            <h2 className="text-2xl font-bold tracking-tight">Drop securely into Vault</h2>
            <p className="text-muted-foreground mt-2">Uploading to {currentPath}</p>
          </div>
        </div>
      )}

      <UploadQueuePanel handle={uploadQueue} />

      {/* Toolbar */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-border bg-card/50 flex-shrink-0 z-10">
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar py-2 text-sm font-medium">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              <button 
                className={cn("hover:text-primary transition-colors flex items-center", i === breadcrumbs.length - 1 ? "text-foreground" : "text-muted-foreground")}
                onClick={() => setCurrentPath(crumb.path)}
              >
                {i === 0 ? <Home className="w-4 h-4 mr-1" /> : null}
                {crumb.name}
              </button>
              {i < breadcrumbs.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground/50" />}
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            multiple 
            onChange={(e) => startUpload(Array.from(e.target.files || []), currentPath)} 
          />
          <input 
            type="file" 
            ref={folderInputRef} 
            className="hidden" 
            {...{ webkitdirectory: "", directory: "" } as any} 
            onChange={(e) => startUpload(Array.from(e.target.files || []), currentPath)} 
          />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="default" className="shadow-none">
                <Plus className="w-4 h-4 mr-2" />
                New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Upload File
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
                <FolderUp className="w-4 h-4 mr-2" /> Upload Folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setNewFolderModalOpen(true)}>
                <Folder className="w-4 h-4 mr-2" /> New Folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-4 w-px bg-border mx-2" />
          
          <div className="flex items-center bg-secondary rounded-md p-0.5">
            <button onClick={() => setViewMode('list')} className={cn("p-1.5 rounded-sm transition-colors", viewMode === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('grid')} className={cn("p-1.5 rounded-sm transition-colors", viewMode === 'grid' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              <Grid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
            <RefreshCcw className="w-8 h-8 animate-spin opacity-50" />
            <p className="text-sm font-mono tracking-widest uppercase">Decyphering directory...</p>
          </div>
        ) : files?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4 border-2 border-dashed border-border/50 rounded-xl m-4 bg-muted/20">
            <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mb-2">
              <Folder className="w-8 h-8 opacity-50" />
            </div>
            <h3 className="text-lg font-medium text-foreground">Empty directory</h3>
            <p className="text-sm">Drag and drop files here to upload</p>
          </div>
        ) : (
          <div className={cn(
            "grid gap-4",
            viewMode === 'grid' ? "grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" : "grid-cols-1"
          )}>
            {files?.map(file => (
              <ContextMenu key={file.id}>
                <ContextMenuTrigger asChild>
                  <div 
                    className={cn(
                      "group relative flex items-center rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-all cursor-pointer select-none",
                      viewMode === 'grid' ? "flex-col p-4 text-center items-center justify-center gap-3 aspect-square" : "p-3 px-4 gap-4"
                    )}
                    onClick={() => {
                      if (file.isFolder) setCurrentPath(file.path);
                      else setPreviewFileId(file.id);
                    }}
                  >
                    <div className={cn(
                      "flex items-center justify-center shrink-0 transition-transform group-hover:scale-110",
                      viewMode === 'grid' ? "w-16 h-16" : "w-10 h-10"
                    )}>
                      {getFileIcon(file.mimeType, file.isFolder)}
                    </div>
                    
                    <div className={cn("flex-1 min-w-0 flex", viewMode === 'grid' ? "flex-col w-full" : "items-center justify-between")}>
                      <div className={cn("truncate font-medium text-sm text-foreground", viewMode === 'grid' && "w-full")}>
                        {file.name}
                      </div>
                      
                      {viewMode === 'list' && (
                        <div className="flex items-center gap-8 text-xs text-muted-foreground font-mono">
                          {!file.isFolder && <span className="w-20 text-right">{formatBytes(file.size)}</span>}
                          <span className="w-32 text-right">{formatDate(file.updatedAt || file.createdAt)}</span>
                        </div>
                      )}
                    </div>

                    {/* Quick actions on hover (list mode only for cleaner UI) */}
                    {viewMode === 'list' && (
                      <div className="absolute right-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-background/90 backdrop-blur-sm p-1 rounded-md border border-border shadow-sm">
                        {!file.isFolder && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setPreviewFileId(file.id); }}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild onClick={e => e.stopPropagation()}>
                              <a href={`/api/files/${file.id}/download`} download={file.name}>
                                <Download className="w-4 h-4" />
                              </a>
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(file.id); }}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem onClick={() => file.isFolder ? setCurrentPath(file.path) : setPreviewFileId(file.id)}>
                    {file.isFolder ? <Folder className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                    {file.isFolder ? 'Open Folder' : 'Preview'}
                  </ContextMenuItem>
                  {!file.isFolder && (
                    <ContextMenuItem asChild>
                      <a href={`/api/files/${file.id}/download`} download={file.name} className="flex items-center w-full cursor-pointer">
                        <Download className="w-4 h-4 mr-2" /> Download
                      </a>
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onClick={() => setShareFileId(file.id)}>
                    <Share2 className="w-4 h-4 mr-2" /> Share
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setMoveItem({ id: file.id, name: file.name, parentPath: file.parentPath ?? '/' })}>
                    <FolderSymlink className="w-4 h-4 mr-2" /> Move to…
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => handleDelete(file.id)}>
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <Dialog open={newFolderModalOpen} onOpenChange={setNewFolderModalOpen}>
        <DialogContent>
          <form onSubmit={handleCreateFolder}>
            <DialogHeader>
              <DialogTitle>Create Folder</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input 
                autoFocus
                placeholder="Folder name" 
                value={newFolderName} 
                onChange={(e) => setNewFolderName(e.target.value)} 
                className="font-mono"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewFolderModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createFolder.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {previewFileId && (
        <FilePreviewModal
          fileId={previewFileId}
          onClose={() => setPreviewFileId(null)}
          onShare={(id) => { setPreviewFileId(null); setShareFileId(id); }}
        />
      )}

      {shareFileId && (
        <ShareDialog fileId={shareFileId} onClose={() => setShareFileId(null)} />
      )}

      {moveItem && (
        <MoveDialog
          item={moveItem}
          onClose={() => setMoveItem(null)}
          onMove={handleMove}
        />
      )}
    </div>
  );
}

function FilePreviewModal({ fileId, onClose, onShare }: { fileId: number; onClose: () => void; onShare: (id: number) => void }) {
  const { data: file, isLoading } = useGetFileMeta(fileId);

  if (isLoading) return null; // Or a minimal skeleton
  if (!file) return null;

  const url = `/api/files/${file.id}/preview`;
  
  const renderPreview = () => {
    // Use the server-provided mimeType, fall back to guessing from the filename extension.
    // This covers files uploaded from iOS and other clients that don't send Content-Type.
    const mime = file.mimeType ?? guessMimeFromName(file.name);
    if (!mime) return <NoPreview file={file} />;
    if (mime.startsWith('image/')) return <img src={url} alt={file.name} className="max-w-full max-h-full object-contain bg-background/50 rounded-md" />;
    if (mime.startsWith('video/')) return <video src={url} controls autoPlay className="max-w-full max-h-full rounded-md" />;
    if (mime.startsWith('audio/')) return <audio src={url} controls className="w-full max-w-md" />;
    if (mime === 'application/pdf') return <iframe src={url} className="w-full h-full rounded-md bg-white" title={file.name} />;
    if (mime.startsWith('text/') || mime === 'application/json') {
      return <iframe src={url} className="w-full h-full rounded-md bg-background text-foreground font-mono" title={file.name} />;
    }
    return <NoPreview file={file} />;
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl w-[90vw] h-[85vh] p-0 flex flex-col overflow-hidden bg-card/95 backdrop-blur-xl border-border/50">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/50 flex-shrink-0">
          <div className="flex items-center space-x-3 overflow-hidden">
            {getFileIcon(file.mimeType, false)}
            <div className="flex flex-col truncate">
              <span className="font-semibold text-sm truncate">{file.name}</span>
              <span className="text-xs text-muted-foreground font-mono">{formatBytes(file.size)} • {file.mimeType || 'Unknown type'}</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button size="sm" variant="secondary" onClick={() => onShare(file.id)}>
              <Share2 className="w-4 h-4 mr-2" /> Share
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a href={`/api/files/${file.id}/download`} download={file.name}>
                <Download className="w-4 h-4 mr-2" /> Download
              </a>
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4 bg-muted/10 overflow-hidden relative">
           {renderPreview()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoPreview({ file }: { file: any }) {
  return (
    <div className="flex flex-col items-center justify-center text-center space-y-4">
      <FileIcon className="w-16 h-16 text-muted-foreground opacity-20" />
      <div>
        <p className="font-medium">No preview available</p>
        <p className="text-sm text-muted-foreground">This file type cannot be previewed in the browser.</p>
      </div>
      <Button asChild>
        <a href={`/api/files/${file.id}/download`} download={file.name}>
          Download {formatBytes(file.size)}
        </a>
      </Button>
    </div>
  );
}

type ExpiryOption = '1h' | '24h' | '7d' | 'never';

const EXPIRY_LABELS: Record<ExpiryOption, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  'never': 'Never',
};

function ShareDialog({ fileId, onClose }: { fileId: number; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expiry, setExpiry] = useState<ExpiryOption>('7d');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { data: tokens, isLoading } = useListShareTokens(fileId);

  const createShare = useCreateShareToken();
  const revokeShare = useRevokeShareToken();

  const handleCreate = async () => {
    try {
      await createShare.mutateAsync({ id: fileId, data: { expiry } });
      queryClient.invalidateQueries({ queryKey: getListShareTokensQueryKey(fileId) });
      toast({ title: 'Share link created' });
    } catch {
      toast({ title: 'Failed to create share link', variant: 'destructive' });
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await revokeShare.mutateAsync({ token });
      queryClient.invalidateQueries({ queryKey: getListShareTokensQueryKey(fileId) });
      toast({ title: 'Share link revoked' });
    } catch {
      toast({ title: 'Failed to revoke share link', variant: 'destructive' });
    }
  };

  const getShareUrl = (token: string) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    return `${window.location.origin}${base}/share/${token}`;
  };

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(getShareUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const isExpired = (expiresAt: string | null | undefined) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const formatExpiry = (expiresAt: string | null | undefined) => {
    if (!expiresAt) return 'Never expires';
    const d = new Date(expiresAt);
    if (d < new Date()) return 'Expired';
    return `Expires ${formatDate(expiresAt)}`;
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-4 h-4" /> Share File
          </DialogTitle>
        </DialogHeader>

        {/* Create new share link */}
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Generate a public link anyone can use to download this file — no login required.</p>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as ExpiryOption)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {(Object.entries(EXPIRY_LABELS) as [ExpiryOption, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <Button size="sm" onClick={handleCreate} disabled={createShare.isPending}>
              <Link className="w-3.5 h-3.5 mr-1.5" />
              {createShare.isPending ? 'Creating…' : 'Create Link'}
            </Button>
          </div>
        </div>

        {/* Existing share links */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-2">Loading links…</p>
        ) : tokens && tokens.length > 0 ? (
          <div className="space-y-2 mt-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Links</p>
            {tokens.map((t) => {
              const expired = isExpired(t.expiresAt);
              return (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-2.5",
                    expired ? "border-border/50 opacity-60" : "border-border"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-muted-foreground truncate">{getShareUrl(t.token)}</p>
                    <p className={cn("text-xs mt-0.5", expired ? "text-destructive" : "text-muted-foreground")}>
                      {formatExpiry(t.expiresAt)}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleCopy(t.token)}
                    disabled={expired}
                    title="Copy link"
                  >
                    {copiedToken === t.token ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                  {!expired && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleRevoke(t.token)}
                      disabled={revokeShare.isPending}
                      title="Revoke link"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-2">No active share links.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── MoveDialog ────────────────────────────────────────────────────────────────
// Folder-picker for moving a file or folder to a new location.
function MoveDialog({
  item,
  onClose,
  onMove,
}: {
  item: { id: number; name: string; parentPath: string };
  onClose: () => void;
  onMove: (id: number, newParentPath: string) => Promise<void>;
}) {
  const [browsePath, setBrowsePath] = useState('/');
  const [moving, setMoving] = useState(false);

  const { data: items } = useListFiles(
    { path: browsePath },
    { query: { queryKey: getListFilesQueryKey({ path: browsePath }) } },
  );

  const folders = (items ?? []).filter((f) => f.isFolder);

  // Breadcrumb navigation
  const parts = browsePath.split('/').filter(Boolean);
  const breadcrumbs = [
    { name: 'Home', path: '/' },
    ...parts.map((part, i) => ({
      name: part,
      path: '/' + parts.slice(0, i + 1).join('/'),
    })),
  ];

  const handleMoveHere = async () => {
    setMoving(true);
    await onMove(item.id, browsePath);
    setMoving(false);
  };

  const isSameLocation = browsePath === item.parentPath;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSymlink className="w-4 h-4" />
            Move "{item.name}"
          </DialogTitle>
        </DialogHeader>

        {/* Breadcrumb trail */}
        <div className="flex items-center gap-1 flex-wrap text-sm py-1 px-2 bg-muted/40 rounded-md">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              <button
                className="hover:text-foreground text-muted-foreground transition-colors"
                onClick={() => setBrowsePath(crumb.path)}
              >
                {i === 0 ? <Home className="w-3.5 h-3.5" /> : crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="min-h-[160px] max-h-[300px] overflow-y-auto border border-border rounded-lg divide-y divide-border">
          {folders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No subfolders here
            </p>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
                onClick={() => setBrowsePath(f.path)}
              >
                <Folder className="w-4 h-4 text-primary shrink-0" fill="currentColor" fillOpacity={0.2} />
                <span className="text-sm font-medium truncate">{f.name}</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={moving}>
            Cancel
          </Button>
          <Button onClick={handleMoveHere} disabled={isSameLocation || moving}>
            {moving ? 'Moving…' : 'Move Here'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}