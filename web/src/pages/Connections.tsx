import { useState } from 'react';
import { Link as LinkIcon, Trash2, ExternalLink, AlertCircle } from 'lucide-react';
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
import { toast } from '@/components/ui/use-toast';

export function Connections() {
  const { data: teamConns, isLoading: teamLoading, isError: teamError } = useTeamConnections();
  const { data: personalConns, isLoading: personalLoading, isError: personalError } = usePersonalConnections();
  const { data: oauthIntegrations } = useOAuthIntegrations();
  const { data: agentToolModes, isLoading: modesLoading } = useAgentToolModes();
  const deleteConnection = useDeleteConnection();
  const setToolMode = useSetAgentToolMode();
  const [tab, setTab] = useState('team');

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

  const renderConnectionsTable = (connections: typeof teamConns, loading: boolean, hasError: boolean) => {
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
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Integration</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                {tab === 'personal' && <TableHead>User</TableHead>}
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
                  {tab === 'personal' && (
                    <TableCell className="text-warm-text-secondary">{conn.userDisplayName ?? (conn.userId ? `@${conn.userId}` : '\u2014')}</TableCell>
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
        </CardContent>
      </Card>
    );
  };

  return (
    <div>
      <PageHeader title="Connections" description="Manage tool connections and credentials" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="team">Team Connections</TabsTrigger>
          <TabsTrigger value="personal">Personal Connections</TabsTrigger>
          {hasToolModes && <TabsTrigger value="modes">Agent Tool Modes</TabsTrigger>}
        </TabsList>

        <TabsContent value="team">
          {/* OAuth Connect Buttons */}
          {(oauthIntegrations ?? []).filter((i) => i.oauthSupported).length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-warm-text-secondary mb-3">Connect via OAuth</h3>
              <div className="flex flex-wrap gap-2">
                {(oauthIntegrations ?? [])
                  .filter((i) => i.oauthSupported)
                  .map((integration) => (
                    <Button
                      key={integration.id}
                      variant="outline"
                      size="sm"
                      onClick={() => handleOAuth(integration.name)}
                    >
                      <ExternalLink className="mr-2 h-3 w-3" />
                      Connect {integration.displayName ?? integration.name ?? 'Integration'}
                    </Button>
                  ))}
              </div>
            </div>
          )}
          {renderConnectionsTable(teamConns, teamLoading, teamError)}
        </TabsContent>

        <TabsContent value="personal">
          {renderConnectionsTable(personalConns, personalLoading, personalError)}
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
              <Card>
                <CardContent className="pt-6">
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
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
