import React, { useState } from 'react';
import { useChangeMyPassword } from '@workspace/api-client-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const changePassword = useChangeMyPassword();

  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (form.newPassword !== form.confirmPassword) {
      toast({ title: 'New passwords do not match', variant: 'destructive' });
      return;
    }

    if (form.newPassword.length < 6) {
      toast({ title: 'New password must be at least 6 characters', variant: 'destructive' });
      return;
    }

    changePassword.mutate(
      { data: { currentPassword: form.currentPassword, newPassword: form.newPassword } },
      {
        onSuccess: () => {
          toast({ title: 'Password changed successfully' });
          setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        },
        onError: (err: any) => {
          const message = err?.payload?.error ?? 'Failed to change password';
          toast({ title: message, variant: 'destructive' });
        },
      },
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="h-14 flex items-center px-6 border-b border-border bg-background/95 backdrop-blur z-10 flex-shrink-0">
        <h1 className="font-semibold tracking-tight">Account Settings</h1>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-md space-y-8">
          {/* User info */}
          <div className="rounded-lg border border-border bg-card p-5 space-y-1 shadow-sm">
            <p className="text-sm text-muted-foreground">Signed in as</p>
            <p className="font-mono font-medium">{user?.username}</p>
            <p className="text-xs text-muted-foreground font-mono">{user?.isAdmin ? 'Administrator' : 'User'}</p>
          </div>

          {/* Change password form */}
          <div className="rounded-lg border border-border bg-card shadow-sm">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold text-sm">Change Password</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                You must confirm your current password before setting a new one.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Current Password</label>
                <Input
                  type="password"
                  required
                  autoComplete="current-password"
                  className="font-mono"
                  value={form.currentPassword}
                  onChange={e => setForm({ ...form, currentPassword: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">New Password</label>
                <Input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="font-mono"
                  value={form.newPassword}
                  onChange={e => setForm({ ...form, newPassword: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Confirm New Password</label>
                <Input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="font-mono"
                  value={form.confirmPassword}
                  onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
                />
              </div>
              <div className="pt-1">
                <Button type="submit" disabled={changePassword.isPending}>
                  {changePassword.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating…
                    </>
                  ) : (
                    'Update Password'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
