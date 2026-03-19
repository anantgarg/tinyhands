import { useState } from 'react';
import { Link as LinkIcon, Trash2, ExternalLink, AlertCircle, Shield, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useTeamConnections,
  usePersonalConnections,
  useDeleteConnection,
  useOAuthIntegrations,
  useAgentToolModes,
  useSetAgentToolMode,
} from '@/api/connections';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';

export function Connections() {
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

  return <ConnectionsContent />;
}

function ConnectionsContent() {
  const { data: teamConns, isLoading: teamLoading, isError: teamError } = useTeamConnections();
  const { data: personalConns, isLoading: personalLoading, isError: personalError } = usePersonalConnections();
  const { data: oauthIntegrations } = useOAuthIntegrations();
  const { data: agentToolModes, isLoading: modesLoading } = useAgentToolModes();
  const deleteConnection = useDeleteConnection();
  const setToolMode = useSetAgentToolMode();
  const [tab, setTab] = useState('personal');

  const handleDelete = (id: string) => {
    if (confirm('Delete this connection?')) {
      deleteConnection.mutate(id, {
        onSuccess: () => toast({ title: 'Connection deleted', variant: 'success' }),
        onError: (err) => toast({ title: 'Failed to delete', description: err.message, variant: 'error' }),
      });
    }
  };

  const handleOAuth = (integration: string) => {
    window.open(`/api/v1/connections/oauth/${integration}/start`, '_blank');
  };

  const hasToolModes = (agentToolModes ?? []).length > 0;

  const renderOAuthCards = () => {
    const oauthList = (oauthIntegrations ?? []).filter((i) => i.oauthSupported);
    if (oauthList.length === 0) return null;

    return (
      <div className="mb-6">
        <h3 className="text-sm font-medium text-warm-text-secondary mb-3">Connect via OAuth</h3>
        <div className="flex flex-wrap gap-3">
          {oauthList.map((integration) => (
            <Card key={integration.id} className="w-[200px]">
              <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                <ExternalLink className="h-6 w-6 text-brand" />
                <p className="text-sm font-medium">{integration.displayName ?? integration.name}</p>
                <p className="text-xs text-warm-text-secondary line-clamp-2">{integration.description}</p>
                <Button size="sm" variant="outline" onClick={() => handleOAuth(integration.name)} className="mt-1 w-full">
                  Connect
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const renderConnectionsTable = (connections: typeof teamConns, loading: boolean, hasError: boolean, showUser: boolean) => {
    if (loading) return <Skeleton className="h-[200px]" />;
    if (hasError) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-red-500">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            Failed to load connections
          </CardContent>
        </Card>
      );
    }
    if (!connections?.length) {
      return (
        <EmptyState
          icon={LinkIcon}
          title="No connections"
          description="Connect integrations to allow agents to authenticate with external services"
        />
      );
    }
    return (
      <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Integration</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              {showUser && <TableHead>User</TableHead>}
              <TableHead>Created</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((conn) => (
              <TableRow key={conn.id}>
                <TableCell className="font-medium">{conn.integrationName ?? '\u2014'}</TableCell>
                <TableCell>{conn.displayName ?? '\u2014'}</TableCell>
                <TableCell>
                  <Badge variant={conn.status === 'active' ? 'success' : conn.status === 'expired' ? 'warning' : 'danger'}>
                    {conn.status ?? 'unknown'}
                  </Badge>
                </TableCell>
                {showUser && (
                  <TableCell className="text-warm-text-secondary">{conn.userDisplayName ?? '\u2014'}</TableCell>
                )}
                <TableCell className="text-warm-text-secondary text-xs">
                  {conn.createdAt
                    ? formatDistanceToNow(new Date(conn.createdAt), { addSuffix: true })
                    : '\u2014'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500"
                    onClick={() => handleDelete(conn.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="Connections" description="Manage tool connections and credentials" />

      {/* Info section */}
      <Card className="mb-6 border-blue-200 bg-blue-50/50">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-900">
              <p className="font-medium mb-1">Credential Resolution Order</p>
              <p>
                When an agent runs a tool, credentials are resolved in this order:
                1) <strong>Personal</strong> connection for the invoking user,
                2) <strong>Team</strong> connection for the workspace.
                Hybrid mode tries personal first, then falls back to team.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="personal">Personal Connections</TabsTrigger>
          <TabsTrigger value="team">Team Connections</TabsTrigger>
          {hasToolModes && <TabsTrigger value="modes">Agent Tool Modes</TabsTrigger>}
        </TabsList>

        <TabsContent value="personal">
          {renderOAuthCards()}
          {renderConnectionsTable(personalConns, personalLoading, personalError, true)}
        </TabsContent>

        <TabsContent value="team">
          {renderOAuthCards()}
          {renderConnectionsTable(teamConns, teamLoading, teamError, false)}
        </TabsContent>

        {hasToolModes && (
          <TabsContent value="modes">
            <Card className="mb-4">
              <CardContent className="py-4">
                <p className="text-sm text-warm-text-secondary">
                  Agent tool modes control how credentials are resolved for each tool. <strong>Team</strong> uses shared workspace credentials, <strong>Personal</strong> uses the individual user's credentials, and <strong>Hybrid</strong> falls back to team credentials when personal ones are not available.
                </p>
              </CardContent>
            </Card>
            {modesLoading ? (
              <Skeleton className="h-[200px]" />
            ) : (
              <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>Mode</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(agentToolModes ?? []).map((mode) => (
                      <TableRow key={`${mode.agentId}-${mode.toolName}`}>
                        <TableCell className="font-medium">{mode.agentName ?? '\u2014'}</TableCell>
                        <TableCell>{mode.toolName ?? '\u2014'}</TableCell>
                        <TableCell>
                          <Select
                            value={mode.mode ?? 'team'}
                            onValueChange={(newMode) =>
                              setToolMode.mutate(
                                { agentId: mode.agentId, toolName: mode.toolName, mode: newMode },
                                { onSuccess: () => toast({ title: 'Mode updated', variant: 'success' }) },
                              )
                            }
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="team">Team</SelectItem>
                              <SelectItem value="personal">Personal</SelectItem>
                              <SelectItem value="hybrid">Hybrid</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
