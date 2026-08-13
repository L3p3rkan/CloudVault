import React from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Server, HardDrive, Users, LogOut, Loader2, Settings } from 'lucide-react';
import { useGetStorageStats, getGetStorageStatsQueryKey } from '@workspace/api-client-react';
import { Progress } from '@/components/ui/progress';

export function Sidebar() {
  const { user } = useAuth();
  const logoutMutation = useLogout();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();

  const { data: stats } = useGetStorageStats({
    query: {
      queryKey: getGetStorageStatsQueryKey(),
      enabled: !!user
    }
  });

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation('/login');
      }
    });
  };

  if (!user) return null;

  return (
    <div className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col flex-shrink-0 h-screen overflow-hidden">
      <div className="h-14 flex items-center px-4 border-b border-sidebar-border gap-2 font-semibold text-sidebar-foreground">
        <Server className="w-5 h-5 text-primary" />
        Vault
      </div>

      <div className="flex-1 py-4 px-2 space-y-6 overflow-y-auto">
        {stats && (
          <div className="px-2 space-y-3">
            <div className="flex items-center justify-between text-xs font-medium text-sidebar-foreground/70 uppercase tracking-wider">
              <span>Storage</span>
              <span>{stats.usedFormatted}</span>
            </div>
            <Progress value={Math.min(100, (stats.totalSize / (100 * 1024 * 1024 * 1024)) * 100)} className="h-1.5" />
            <div className="text-xs text-sidebar-foreground/50 font-mono">
              {stats.totalFiles} files, {stats.totalFolders} folders
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Link href="/files" className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${location === '/files' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}>
            <HardDrive className="w-4 h-4" />
            Files
          </Link>
          {user.isAdmin && (
            <Link href="/admin" className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${location === '/admin' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}>
              <Users className="w-4 h-4" />
              Admin
            </Link>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-sidebar-border space-y-2">
        <Link href="/settings" className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${location === '/settings' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}>
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex flex-col truncate">
            <span className="text-sm font-medium text-sidebar-foreground truncate">{user.username}</span>
            <span className="text-xs text-sidebar-foreground/50 truncate font-mono">{user.isAdmin ? 'Administrator' : 'User'}</span>
          </div>
          <button 
            onClick={handleLogout} 
            disabled={logoutMutation.isPending}
            className="p-2 rounded-md text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Log out"
          >
            {logoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { isLoading, user } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  // If not authenticated, we don't render the sidebar
  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}