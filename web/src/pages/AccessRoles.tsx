import { Shield, Trash2 } from 'lucide-react';
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

export function AccessRoles() {
  const { data: roles, isLoading } = usePlatformRoles();
  const setRole = useSetPlatformRole();
  const removeRole = useRemovePlatformRole();

  const handleRoleChange = (userId: string, role: string) => {
    setRole.mutate(
      { userId, role },
      { onSuccess: () => toast({ title: 'Role updated', variant: 'success' }) },
    );
  };

  const handleRemove = (userId: string, name: string) => {
    if (confirm(`Remove platform role for "${name}"?`)) {
      removeRole.mutate(userId, {
        onSuccess: () => toast({ title: 'Role removed', variant: 'success' }),
      });
    }
  };

  return (
    <div>
      <PageHeader title="Access & Roles" description="Manage platform-level roles and permissions" />

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
                Full platform control. Can manage all agents, tools, settings, and assign roles. Cannot be removed.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="warning">Admin</Badge>
              </div>
              <p className="text-sm text-warm-text-secondary">
                Can create and manage agents, approve tools and KB entries, manage connections, and view audit logs.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">Member</Badge>
              </div>
              <p className="text-sm text-warm-text-secondary">
                Can interact with agents they have access to. Can request upgrades for restricted agents.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform roles table */}
      {isLoading ? (
        <Skeleton className="h-[300px]" />
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
                          <AvatarImage src={role.avatarUrl} />
                          <AvatarFallback>{role.displayName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{role.displayName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={role.role}
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
                      {formatDistanceToNow(new Date(role.assignedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      {role.role !== 'superadmin' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500"
                          onClick={() => handleRemove(role.userId, role.displayName)}
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
