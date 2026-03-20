import { useState } from 'react';
import { Shield, Trash2, AlertCircle, Info, Plus, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { usePlatformRoles, useSetPlatformRole, useRemovePlatformRole } from '@/api/access';
import { useSlackUsers } from '@/api/slack';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';

function safeInitial(name: unknown): string {
  if (!name || typeof name !== 'string' || name.length === 0) return '?';
  return name.charAt(0).toUpperCase();
}

function fmtRelative(v: unknown): string {
  if (!v) return '\u2014';
  try {
    return formatDistanceToNow(new Date(v as string), { addSuffix: true });
  } catch {
    return '\u2014';
  }
}

export function AccessRoles() {
  const isAdmin = useAuthStore((s) => s.user?.platformRole === 'superadmin' || s.user?.platformRole === 'admin');
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Shield className="h-12 w-12 text-warm-text-secondary mb-4" />
        <h2 className="text-lg font-bold">Admin Access Required</h2>
        <p className="text-warm-text-secondary mt-2">You need admin permissions to access this page.</p>
      </div>
    );
  }
  return <AccessRolesContent />;
}

function AccessRolesContent() {
  const { data: roles, isLoading, isError } = usePlatformRoles();
  const setRole = useSetPlatformRole();
  const removeRole = useRemovePlatformRole();
  const { data: slackUsersData } = useSlackUsers();
  const slackUsers = slackUsersData?.users ?? [];

  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [selectedAdmin, setSelectedAdmin] = useState<{ id: string; name: string; avatarUrl: string } | null>(null);
  const [newAdminRole, setNewAdminRole] = useState('admin');

  const filteredAdminUsers = adminSearch.length > 0
    ? slackUsers.filter(u => {
        const search = adminSearch.toLowerCase();
        return (u.realName?.toLowerCase().includes(search) || u.displayName?.toLowerCase().includes(search))
          && !(roles ?? []).some(r => r.userId === u.id);
      }).slice(0, 8)
    : [];

  const handleRoleChange = (userId: string, role: string) => {
    setRole.mutate(
      { userId, role },
      { onSuccess: () => toast({ title: 'Role updated', variant: 'success' }) },
    );
  };

  const handleRemove = (userId: string, name: string) => {
    if (confirm(`Remove platform role for "${name || 'this user'}"?`)) {
      removeRole.mutate(userId, {
        onSuccess: () => toast({ title: 'Role removed', variant: 'success' }),
      });
    }
  };

  const handleAddAdmin = () => {
    if (!selectedAdmin) return;
    setRole.mutate(
      { userId: selectedAdmin.id, role: newAdminRole },
      {
        onSuccess: () => {
          toast({ title: 'Admin added', variant: 'success' });
          setShowAddAdmin(false);
          setSelectedAdmin(null);
          setAdminSearch('');
        },
      },
    );
  };

  return (
    <div>
      <PageHeader title="Access & Roles" description="Manage platform-level roles and permissions" />

      {/* Info banner */}
      <Card className="mb-6 border-blue-200 bg-blue-50/50">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-900">
              Platform roles control who can manage workspace-wide settings. Agent-level access is configured per agent in the agent's Access tab.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Role descriptions */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Role Descriptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="danger">Superadmin</Badge>
              </div>
              <p className="text-sm text-warm-text-secondary">
                Full control over workspace and all agents. Can manage platform settings, tools, integrations, and assign roles to other users.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="warning">Admin</Badge>
              </div>
              <p className="text-sm text-warm-text-secondary">
                Manage tools, integrations, KB, and connections. Can approve custom tools and KB entries, view audit logs, and manage connections.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="default">Member</Badge>
              </div>
              <p className="text-sm text-warm-text-secondary">
                Full agent access. Agents can perform all actions including write operations. Can create agents and manage personal connections.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">Viewer</Badge>
              </div>
              <p className="text-sm text-warm-text-secondary">
                Can interact with agents but agent actions are limited (read-only tools only). Good for team members who need to ask questions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform roles table */}
      {isLoading ? (
        <Skeleton className="h-[300px]" />
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-red-500">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            Failed to load platform roles
          </CardContent>
        </Card>
      ) : (roles ?? []).length === 0 ? (
        <Card className="mb-6">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Platform Admins</CardTitle>
              <CardDescription>Users with elevated platform-level access</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowAddAdmin(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Admin
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-warm-text-secondary text-center py-4">
              No platform admins assigned yet. Add an admin to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Platform Admins</CardTitle>
              <CardDescription>Users with elevated platform-level access</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowAddAdmin(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Admin
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(roles ?? []).map((role) => (
                  <TableRow key={role.userId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={role.avatarUrl ?? undefined} />
                          <AvatarFallback>{safeInitial(role.displayName)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                          {role.displayName || 'Unknown'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={role.role ?? 'member'}
                        onValueChange={(newRole) => handleRoleChange(role.userId, newRole)}
                        disabled={role.role === 'superadmin'}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="superadmin">Superadmin</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-warm-text-secondary text-xs">
                      {fmtRelative(role.assignedAt)}
                    </TableCell>
                    <TableCell>
                      {role.role !== 'superadmin' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500"
                          onClick={() => handleRemove(role.userId, role.displayName ?? '')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Members section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Team Members</CardTitle>
          <p className="text-xs text-warm-text-secondary mt-1">
            All Slack workspace members automatically have basic access. Only users with elevated roles are shown above.
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-warm-text-secondary">
            {slackUsers.length} team members in your workspace
          </p>
        </CardContent>
      </Card>

      {/* Add Admin Dialog */}
      <Dialog open={showAddAdmin} onOpenChange={setShowAddAdmin}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Admin</DialogTitle>
            <DialogDescription>Search for a workspace member to assign an admin role.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Search User</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-text-secondary" />
                <Input
                  value={adminSearch}
                  onChange={(e) => { setAdminSearch(e.target.value); setSelectedAdmin(null); }}
                  placeholder="Type a name..."
                  className="pl-9"
                />
              </div>
              {filteredAdminUsers.length > 0 && !selectedAdmin && (
                <div className="mt-1 rounded-lg border border-warm-border bg-white shadow-sm max-h-[200px] overflow-y-auto">
                  {filteredAdminUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        setSelectedAdmin({ id: u.id, name: u.realName || u.displayName || u.name, avatarUrl: u.avatarUrl });
                        setAdminSearch(u.realName || u.displayName || u.name);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-warm-bg transition-colors text-left"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={u.avatarUrl} />
                        <AvatarFallback>{safeInitial(u.realName || u.displayName)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{u.realName || u.displayName || u.name}</p>
                        {u.displayName && u.realName && u.displayName !== u.realName && (
                          <p className="text-xs text-warm-text-secondary">@{u.displayName}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedAdmin && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-light/10 p-2">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={selectedAdmin.avatarUrl} />
                    <AvatarFallback>{safeInitial(selectedAdmin.name)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium flex-1">{selectedAdmin.name}</span>
                  <button
                    onClick={() => { setSelectedAdmin(null); setAdminSearch(''); }}
                    className="text-warm-text-secondary hover:text-warm-text"
                  >
                    &times;
                  </button>
                </div>
              )}
            </div>
            <div>
              <Label>Role</Label>
              <Select value={newAdminRole} onValueChange={setNewAdminRole}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="superadmin">Superadmin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAdmin(false)}>Cancel</Button>
            <Button onClick={handleAddAdmin} disabled={!selectedAdmin || setRole.isPending}>
              Add Admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
