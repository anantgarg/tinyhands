import { useState } from 'react';
import { Link as LinkIcon, Trash2, ExternalLink } from 'lucide-react';
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
  const { data: teamConns, isLoading: teamLoading } = useTeamConnections();
  const { data: personalConns, isLoading: personalLoading } = usePersonalConnections();
  const { data: oauthIntegrations } = useOAuthIntegrations();
  const { data: agentToolModes, isLoading: modesLoading } = useAgentToolModes();
  const deleteConnection = useDeleteConnection();
  const setToolMode = useSetAgentToolMode();
  const [tab, setTab] = useState('team');

  const handleDelete = (id: string) => {
    if (confirm('Delete this connection?')) {
      deleteConnection.mutate(id, {
        onSuccess: () => toast({ title: 'Connection deleted', variant: 'success' }),
      });
    }
  };

  const handleOAuth = (integration: string) => {
    window.open(`/api/v1/connections/oauth/${integration}/start`, '_blank');
  };

  const renderConnectionsTable = (connections: typeof teamConns, loading: boolean) => {
    if (loading) return <Skeleton className="h-[200px]" />;
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
                  <TableCell className="font-medium">{conn.integrationName}</TableCell>
                  <TableCell>{conn.displayName}</TableCell>
                  <TableCell>
                    <Badge variant={conn.status === 'active' ? 'success' : conn.status === 'expired' ? 'warning' : 'danger'}>
                      {conn.status}
                    </Badge>
                  </TableCell>
                  {tab === 'personal' && (
                    <TableCell className="text-warm-text-secondary">{conn.userDisplayName}</TableCell>
                  )}
                  <TableCell className="text-warm-text-secondary text-xs">
                    {formatDistanceToNow(new Date(conn.createdAt), { addSuffix: true })}
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
          <TabsTrigger value="modes">Agent Tool Modes</TabsTrigger>
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
                      Connect {integration.displayName}
                    </Button>
                  ))}
              </div>
            </div>
          )}
          {renderConnectionsTable(teamConns, teamLoading)}
        </TabsContent>

        <TabsContent value="personal">
          {renderConnectionsTable(personalConns, personalLoading)}
        </TabsContent>

        <TabsContent value="modes">
          {modesLoading ? (
            <Skeleton className="h-[200px]" />
          ) : (agentToolModes ?? []).length === 0 ? (
            <EmptyState
              icon={LinkIcon}
              title="No agent tool modes configured"
              description="Tool connection modes are configured per-agent to control credential resolution"
            />
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
                        <TableCell className="font-medium">{mode.agentName}</TableCell>
                        <TableCell>{mode.toolName}</TableCell>
                        <TableCell>
                          <Select
                            value={mode.mode}
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
      </Tabs>
    </div>
  );
}
