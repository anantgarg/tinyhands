import { Shield, Trash2, AlertCircle, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { usePlatformRoles, useSetPlatformRole, useRemovePlatformRole } from '@/api/access';
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
  const { data: roles, isLoading, isError } = usePlatformRoles();
  const setRole = useSetPlatformRole();
  const removeRole = useRemovePlatformRole();

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
          <div className="grid grid-cols-3 gap-6">
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
                <Badge variant="secondary">Member</Badge>
              </div>
              <p className="text-sm text-warm-text-secondary">
                Create and use agents they have access to. Can request upgrades for restricted agents and manage their own personal connections.
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
        <EmptyState
          icon={Shield}
          title="No platform roles"
          description="Platform roles will appear here once users are assigned"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform Admins</CardTitle>
            <CardDescription>Users with elevated platform-level access</CardDescription>
          </CardHeader>
          <CardContent>
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
                          {role.displayName || (role.userId ? `@${role.userId}` : 'Unknown')}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
