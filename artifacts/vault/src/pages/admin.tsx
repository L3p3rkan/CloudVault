import React, { useState } from 'react';
import { 
  useListUsers, 
  getListUsersQueryKey, 
  useCreateUser, 
  useDeleteUser, 
  useChangeUserPassword 
} from '@workspace/api-client-react';
import { useAuth } from '@/hooks/use-auth';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatBytes, formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { MoreHorizontal, Plus, Trash2, Key, Loader2 } from 'lucide-react';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator 
} from '@/components/ui/dropdown-menu';

export default function AdminPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: users, isLoading } = useListUsers({
    query: {
      queryKey: getListUsersQueryKey(),
      enabled: !!currentUser?.isAdmin
    }
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', email: '', password: '', isAdmin: false });
  const createUser = useCreateUser();

  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const changePassword = useChangeUserPassword();

  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);
  const deleteUser = useDeleteUser();

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    createUser.mutate({ data: { ...createForm, email: createForm.email || undefined } }, {
      onSuccess: () => {
        toast({ title: 'User created successfully' });
        setIsCreateModalOpen(false);
        setCreateForm({ username: '', email: '', password: '', isAdmin: false });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => {
        toast({ title: 'Failed to create user', variant: 'destructive' });
      }
    });
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUserId) return;
    changePassword.mutate({ id: resetUserId, data: { newPassword } }, {
      onSuccess: () => {
        toast({ title: 'Password reset successfully' });
        setResetUserId(null);
        setNewPassword('');
      },
      onError: () => {
        toast({ title: 'Failed to reset password', variant: 'destructive' });
      }
    });
  };

  const handleDeleteUser = () => {
    if (!deleteUserId) return;
    deleteUser.mutate({ id: deleteUserId }, {
      onSuccess: () => {
        toast({ title: 'User deleted successfully' });
        setDeleteUserId(null);
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => {
        toast({ title: 'Failed to delete user', variant: 'destructive' });
      }
    });
  };

  if (currentUser && !currentUser.isAdmin) {
    return <div className="p-8 text-center text-muted-foreground">Access denied. Administrators only.</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="h-14 flex items-center justify-between px-6 border-b border-border bg-background/95 backdrop-blur z-10 flex-shrink-0">
        <h1 className="font-semibold tracking-tight">Access Control</h1>
        <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create User
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="rounded-md border border-border bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Storage Used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium font-mono">
                      <div className="flex flex-col">
                        <span>{user.username}</span>
                        {user.email && <span className="text-xs text-muted-foreground font-sans">{user.email}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isAdmin ? 'default' : 'secondary'} className="font-mono text-[10px] tracking-wider uppercase">
                        {user.isAdmin ? 'Admin' : 'User'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {formatBytes(user.storageUsed)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setResetUserId(user.id)}>
                            <Key className="w-4 h-4 mr-2" />
                            Reset Password
                          </DropdownMenuItem>
                          {currentUser?.id !== user.id && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => setDeleteUserId(user.id)}>
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete User
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {users?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create User Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent>
          <form onSubmit={handleCreateUser}>
            <DialogHeader>
              <DialogTitle>Provision New User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Username</label>
                <Input required minLength={3} value={createForm.username} onChange={e => setCreateForm({...createForm, username: e.target.value})} className="font-mono" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email (optional)</label>
                <Input type="email" value={createForm.email} onChange={e => setCreateForm({...createForm, email: e.target.value})} className="font-mono" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Initial Password</label>
                <Input required minLength={6} type="password" value={createForm.password} onChange={e => setCreateForm({...createForm, password: e.target.value})} className="font-mono" />
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Checkbox id="isAdmin" checked={createForm.isAdmin} onCheckedChange={(checked) => setCreateForm({...createForm, isAdmin: checked as boolean})} />
                <label htmlFor="isAdmin" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Grant administrator privileges
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? 'Provisioning...' : 'Provision User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Modal */}
      <Dialog open={resetUserId !== null} onOpenChange={(open) => !open && setResetUserId(null)}>
        <DialogContent>
          <form onSubmit={handleResetPassword}>
            <DialogHeader>
              <DialogTitle>Reset Credentials</DialogTitle>
              <DialogDescription>
                Assign a new password to this user. They will need it to authenticate.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">New Password</label>
                <Input required minLength={6} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="font-mono" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setResetUserId(null)}>Cancel</Button>
              <Button type="submit" disabled={changePassword.isPending}>
                {changePassword.isPending ? 'Resetting...' : 'Reset Password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete User Modal */}
      <Dialog open={deleteUserId !== null} onOpenChange={(open) => !open && setDeleteUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Revoke Access</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this user? All their files and data will be permanently destroyed. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleteUserId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={deleteUser.isPending}>
              {deleteUser.isPending ? 'Revoking...' : 'Revoke Access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}