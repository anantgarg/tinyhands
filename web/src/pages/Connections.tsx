import { useState } from 'react';
import { Link as LinkIcon, Trash2, ExternalLink, AlertCircle, Info, Plus, Key } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  useTeamConnections,
  usePersonalConnections,
  useCreatePersonalConnection,
  useDeleteConnection,
  useOAuthIntegrations,
  useAgentToolModes,
  useSetAgentToolMode,
} from '@/api/connections';
import { useIntegrations } from '@/api/tools';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';

function titleCaseStatus(status: string | null): string {
  const labels: Record<string, string> = {
    active: 'Active',
    expired: 'Expired',
    revoked: 'Revoked',
    unknown: 'Unknown',
  };
  return status ? labels[status] ?? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
}

export function Connections() {
  return <ConnectionsContent />;
}

function ConnectionsContent() {
  const isAdmin = useAuthStore((s) => s.user?.platformRole === 'superadmin' || s.user?.platformRole === 'admin');
  const { data: teamConns, isLoading: teamLoading, isError: teamError } = useTeamConnections();
  const { data: personalConns, isLoading: personalLoading, isError: personalError } = usePersonalConnections();
  const { data: oauthIntegrations } = useOAuthIntegrations();
  const { data: allIntegrations } = useIntegrations();
  const { data: agentToolModes, isLoading: modesLoading } = useAgentToolModes();
  const deleteConnection = useDeleteConnection();
  const createPersonalConn = useCreatePersonalConnection();
  const setToolMode = useSetAgentToolMode();
  const [tab, setTab] = useState('personal');
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [apiKeyDialog, setApiKeyDialog] = useState<{ id: string; name: string; configKeys: { key: string; label: string; placeholder: string; secret: boolean }[] } | null>(null);
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});

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

  const renderPersonalConnectionsTable = (connections: typeof personalConns, loading: boolean, hasError: boolean) => {
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
          title="No personal connections"
          description="Add a personal connection to use your own credentials with agents"
        />
      );
    }
    return (
      <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Integration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Connected since</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((conn) => (
              <TableRow key={conn.id}>
                <TableCell className="font-medium">{conn.integrationName ?? '\u2014'}</TableCell>
                <TableCell>
                  <Badge variant={conn.status === 'active' ? 'success' : conn.status === 'expired' ? 'warning' : 'danger'}>
                    {titleCaseStatus(conn.status)}
                  </Badge>
                </TableCell>
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

  const renderTeamConnectionsTable = (connections: typeof teamConns, loading: boolean, hasError: boolean) => {
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
          title="No team connections"
          description="Team connections are managed by admins in Tools & Integrations."
        />
      );
    }
    return (
        <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Integration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connected since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((conn) => (
                <TableRow key={conn.id}>
                  <TableCell className="font-medium">{conn.integrationName ?? '\u2014'}</TableCell>
                  <TableCell>
                    <Badge variant={conn.status === 'active' ? 'success' : conn.status === 'expired' ? 'warning' : 'danger'}>
                      {titleCaseStatus(conn.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-xs">
                    {conn.createdAt
                      ? formatDistanceToNow(new Date(conn.createdAt), { addSuffix: true })
                      : '\u2014'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
    );
  };

  const oauthList = (oauthIntegrations ?? []).filter((i) => i.oauthSupported);

  return (
    <div>
      <PageHeader title="Connections" description="Manage tool connections and credentials" />

      {/* Info note */}
      <Card className="mb-6 border-blue-200 bg-blue-50/50">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-900">
              Each agent's tools are configured to use either team credentials, a specific user's credentials, or a combination. You can manage which credentials an agent uses in the agent's Tools tab.
            </p>
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
          <div className="flex justify-end mb-4">
            <Button size="sm" onClick={() => setShowAddConnection(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Connection
            </Button>
          </div>
          {renderPersonalConnectionsTable(personalConns, personalLoading, personalError)}
        </TabsContent>

        <TabsContent value="team">
          {renderTeamConnectionsTable(teamConns, teamLoading, teamError)}
          {!teamLoading && !teamError && (teamConns ?? []).length > 0 && (
            <p className="text-xs text-warm-text-secondary mt-3">
              {isAdmin
                ? <>Manage team connections in <a href="/tools" className="text-brand hover:underline">Tools & Integrations</a>.</>
                : 'Team connections are managed by workspace admins.'}
            </p>
          )}
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

      {/* Add Connection Dialog */}
      <Dialog open={showAddConnection} onOpenChange={setShowAddConnection}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Personal Connection</DialogTitle>
            <DialogDescription>Connect your personal account to an integration.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {(allIntegrations ?? []).length === 0 && oauthList.length === 0 ? (
              <p className="text-sm text-warm-text-secondary text-center py-4">No integrations available.</p>
            ) : (
              <>
                {oauthList.map((integration) => (
                  <div key={integration.id} className="flex items-center justify-between rounded-lg border border-warm-border p-3">
                    <div className="flex items-center gap-3">
                      <ExternalLink className="h-5 w-5 text-brand shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{integration.displayName ?? integration.name}</p>
                        {integration.description && (
                          <p className="text-xs text-warm-text-secondary line-clamp-1">{integration.description}</p>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { handleOAuth(integration.name); setShowAddConnection(false); }}>
                      Connect
                    </Button>
                  </div>
                ))}
                {(allIntegrations ?? [])
                  .filter(i => (i.configKeys ?? []).length > 0 && !oauthList.some(o => o.id === i.id))
                  .map((integration) => (
                  <div key={integration.id} className="flex items-center justify-between rounded-lg border border-warm-border p-3">
                    <div className="flex items-center gap-3">
                      <Key className="h-5 w-5 text-warm-text-secondary shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{integration.displayName ?? integration.name}</p>
                        <p className="text-xs text-warm-text-secondary">API key</p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => {
                      setApiKeyDialog({
                        id: integration.id,
                        name: integration.displayName ?? integration.name ?? '',
                        configKeys: integration.configKeys ?? [],
                      });
                      setApiKeyValues({});
                      setShowAddConnection(false);
                    }}>
                      Connect
                    </Button>
                  </div>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* API Key Connection Dialog */}
      <Dialog open={!!apiKeyDialog} onOpenChange={() => setApiKeyDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {apiKeyDialog?.name}</DialogTitle>
            <DialogDescription>Enter your personal credentials for this integration.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(apiKeyDialog?.configKeys ?? []).map((key) => (
              <div key={key.key}>
                <Label>{key.label}</Label>
                <Input
                  type={key.secret ? 'password' : 'text'}
                  value={apiKeyValues[key.key] ?? ''}
                  onChange={(e) => setApiKeyValues((prev) => ({ ...prev, [key.key]: e.target.value }))}
                  placeholder={key.placeholder || ''}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApiKeyDialog(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!apiKeyDialog) return;
              createPersonalConn.mutate(
                { integrationId: apiKeyDialog.id, displayName: apiKeyDialog.name, credentials: apiKeyValues },
                {
                  onSuccess: () => {
                    toast({ title: 'Connection added', variant: 'success' });
                    setApiKeyDialog(null);
                    setApiKeyValues({});
                  },
                  onError: (err) => toast({ title: 'Failed', description: err.message, variant: 'error' }),
                },
              );
            }} disabled={createPersonalConn.isPending}>
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
