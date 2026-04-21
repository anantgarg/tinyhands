import { useState, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, Plus, Key, Folder, Settings2, Trash2, Info, AlertCircle, AlertTriangle, BookOpen, FileText, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { DriveFolderPicker } from '@/components/DriveFolderPicker';
import {
  usePersonalConnections,
  useTeamConnections,
  useCreatePersonalConnection,
  useCreateTeamConnection,
  useDeleteConnection,
  useOAuthIntegrations,
  useUpdateConnectionSettings,
  useExpiredConnectionCount,
} from '@/api/connections';
import { useIntegrations } from '@/api/tools';
import { useOAuthAppStatus } from '@/api/workspace-oauth-apps';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';
import { Link } from 'react-router-dom';

// ── Always-on built-ins ──
//
// Knowledge Base and Documents don't require credentials — they're workspace-
// native, always available to any agent. The Apps page surfaces them as an
// informational strip so users see them in the same mental model ("things my
// agent can use") without being invited to "connect" something that's already
// connected.

function BuiltInsRow() {
  return (
    <div className="flex items-center gap-2 text-xs text-warm-text-secondary">
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span>Always available to every agent — no setup needed:</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-warm-border px-2 py-0.5">
        <BookOpen className="h-3 w-3" /> Knowledge Base
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-warm-border px-2 py-0.5">
        <FileText className="h-3 w-3" /> Documents
      </span>
    </div>
  );
}

// ── Page entry ──

export function Apps() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [tab, setTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('tab');
    if (initial === 'team' || initial === 'personal') return initial;
    return 'personal';
  });

  return (
    <div>
      <PageHeader
        title="Tools"
        description="Everything your agents can use. Personal tools use your own account; team tools are shared workspace-wide."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="personal">Personal</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="personal">
          <PersonalTab />
        </TabsContent>

        <TabsContent value="team">
          {isAdmin ? <TeamTab /> : <TeamTabReadOnly />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Team tab (admin) ──

function TeamTab() {
  const { data: googleOAuthStatus } = useOAuthAppStatus('google');
  const { data: teamConns, isLoading, isError } = useTeamConnections();
  const { data: allIntegrations } = useIntegrations();
  const createTeam = useCreateTeamConnection();
  const deleteConn = useDeleteConnection();

  const [showAdd, setShowAdd] = useState(false);
  const [pickerView, setPickerView] = useState<'list' | 'form'>('list');
  const [activeApiKeyForm, setActiveApiKeyForm] = useState<ApiKeyFormSpec | null>(null);
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});

  const googleReady = googleOAuthStatus?.configured === true;

  const closePicker = () => {
    setShowAdd(false);
    setPickerView('list');
    setActiveApiKeyForm(null);
    setApiKeyValues({});
  };

  const startApiKeyForm = (integration: any) => {
    setActiveApiKeyForm({
      id: integration.id,
      name: integration.displayName ?? integration.name ?? '',
      configKeys: (integration.configKeys ?? []).map((k: any) =>
        typeof k === 'string'
          ? {
              key: k,
              label: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              placeholder: '',
              secret: k.includes('key') || k.includes('token') || k.includes('secret'),
            }
          : {
              key: k.key,
              label: k.label ?? k.key,
              placeholder: k.placeholder ?? '',
              secret: k.secret ?? false,
            },
      ),
    });
    setApiKeyValues({});
    setPickerView('form');
  };

  const connectedTeamIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of (teamConns ?? []) as any[]) {
      if (c.status === 'active') set.add(c.integrationId);
    }
    return set;
  }, [teamConns]);

  // Team connections are API-key-based (Chargebee, HubSpot, Linear, etc.) —
  // OAuth integrations don't make sense as team-shared identities (see the
  // plan-015 discussion). Google sub-integrations (gmail, drive, sheets, docs)
  // declare an `access_token` configKey but the only real way to obtain one is
  // OAuth — so they're not usable as a team API-key entry. Filter them out.
  const availableApiKeyIntegrations = ((allIntegrations ?? []) as any[]).filter(
    (i: any) =>
      (i.configKeys ?? []).length > 0 &&
      i.status !== 'active' &&
      !GOOGLE_IDS.has(i.id),
  );

  const handleDelete = (id: string) => {
    if (confirm('Remove this team connection? Agents using it will lose access.')) {
      deleteConn.mutate(id, {
        onSuccess: () => toast({ title: 'Removed', variant: 'success' }),
        onError: (err) => toast({ title: 'Failed', description: err.message, variant: 'error' }),
      });
    }
  };

  const handleApiKeySubmit = () => {
    if (!activeApiKeyForm) return;
    const hasAllRequired = activeApiKeyForm.configKeys.every((k) => apiKeyValues[k.key]?.trim());
    if (!hasAllRequired) {
      toast({ title: 'Missing fields', description: 'Fill all required fields.', variant: 'error' });
      return;
    }
    createTeam.mutate(
      { integrationId: activeApiKeyForm.id, credentials: apiKeyValues, displayName: activeApiKeyForm.name },
      {
        onSuccess: () => {
          toast({ title: 'Connected', variant: 'success' });
          closePicker();
        },
        onError: (err) => toast({ title: 'Failed to connect', description: err.message, variant: 'error' }),
      },
    );
  };

  if (isLoading) return <Skeleton className="h-[300px]" />;
  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-red-500">
          <AlertCircle className="h-5 w-5 mx-auto mb-2" />
          Failed to load team connections
        </CardContent>
      </Card>
    );
  }

  const teamList = (teamConns ?? []) as any[];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Google connection app</p>
            <p className="text-xs text-warm-text-secondary mt-0.5">
              Required before anyone can connect Drive, Sheets, Docs, or Gmail.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Badge variant={googleReady ? 'success' : 'warning'}>
              {googleReady ? 'Ready' : 'Not configured'}
            </Badge>
            <Link to="/settings/integrations/google" className="text-sm text-brand underline">
              {googleReady ? 'Manage' : 'Set up'}
            </Link>
          </div>
        </CardContent>
      </Card>

      <BuiltInsRow />

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add team connection
        </Button>
      </div>

      {teamList.length === 0 ? (
        <EmptyState
          icon={Key}
          title="No team connections"
          description="Add a team connection to share credentials across every agent in this workspace."
        />
      ) : (
        <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Integration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connected since</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamList.map((conn) => (
                <TableRow key={conn.id}>
                  <TableCell>
                    <p className="font-medium">{conn.integrationName ?? conn.displayName ?? '—'}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={conn.status === 'active' ? 'success' : conn.status === 'expired' ? 'warning' : 'danger'}>
                      {titleCaseStatus(conn.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-xs">
                    {conn.createdAt ? formatDistanceToNow(new Date(conn.createdAt), { addSuffix: true }) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDelete(conn.id)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Single-dialog picker with swap-in api-key form view */}
      <Dialog open={showAdd} onOpenChange={(open) => { if (!open) closePicker(); else setShowAdd(true); }}>
        <DialogContent>
          {pickerView === 'list' ? (
            <>
              <DialogHeader>
                <DialogTitle>Add team connection</DialogTitle>
                <DialogDescription>
                  Team connections share one set of credentials across every agent. For Google (Drive, Gmail, Sheets, Docs), use the Personal tab — Google connections are tied to individual accounts.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {availableApiKeyIntegrations.length === 0 ? (
                  <p className="text-sm text-warm-text-secondary text-center py-4">Everything's already connected.</p>
                ) : (
                  availableApiKeyIntegrations.map((integration: any) => {
                    const isConnected = connectedTeamIds.has(integration.id);
                    return (
                      <div key={integration.id} className="flex items-center justify-between rounded-lg border border-warm-border p-3">
                        <div className="flex items-center gap-3">
                          <Key className="h-5 w-5 text-warm-text-secondary shrink-0" />
                          <div>
                            <p className="text-sm font-medium">{integration.displayName ?? integration.name}</p>
                            <p className="text-xs text-warm-text-secondary">{integration.description || 'API key'}</p>
                          </div>
                        </div>
                        {isConnected ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                            <CheckCircle2 className="h-4 w-4" /> Connected
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => startApiKeyForm(integration)}>
                            Connect
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : activeApiKeyForm ? (
            <>
              <DialogHeader>
                <DialogTitle>Connect {activeApiKeyForm.name}</DialogTitle>
                <DialogDescription>Enter team credentials for {activeApiKeyForm.name}.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {activeApiKeyForm.configKeys.map((k) => (
                  <div key={k.key}>
                    <Label className="text-sm">{k.label}</Label>
                    <Input
                      type={k.secret ? 'password' : 'text'}
                      placeholder={k.placeholder}
                      value={apiKeyValues[k.key] ?? ''}
                      onChange={(e) => setApiKeyValues((prev) => ({ ...prev, [k.key]: e.target.value }))}
                      className="mt-1 font-mono text-sm"
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setPickerView('list'); setActiveApiKeyForm(null); setApiKeyValues({}); }}>
                  Back
                </Button>
                <Button onClick={handleApiKeySubmit} disabled={createTeam.isPending}>Connect</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Team tab (read-only for non-admins) ──

function TeamTabReadOnly() {
  const { data: integrations, isLoading } = useIntegrations();
  const { data: googleOAuthStatus } = useOAuthAppStatus('google');

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const connected = (integrations ?? []).filter((i: any) => i.status === 'active');
  const available = (integrations ?? []).filter((i: any) => i.status !== 'active');
  const googleReady = googleOAuthStatus?.configured === true;

  return (
    <div className="space-y-6">
      <Card className="border-warm-border">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-warm-text-secondary mt-0.5 shrink-0" />
            <p className="text-sm text-warm-text-secondary">
              Team apps are configured by admins. You can see what's set up but can't change anything here. Need something connected? Ask an admin — or use <strong>Personal</strong> to connect your own account.
            </p>
          </div>
        </CardContent>
      </Card>

      <section>
        <h2 className="text-lg font-semibold mb-3">Google</h2>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="font-medium">Google connection app</p>
              <p className="text-xs text-warm-text-secondary mt-0.5">
                {googleReady ? 'Configured and ready.' : 'Not yet configured — ask an admin to set it up.'}
              </p>
            </div>
            <Badge variant={googleReady ? 'success' : 'warning'}>
              {googleReady ? 'Ready' : 'Not configured'}
            </Badge>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Connected</h2>
        {connected.length === 0 ? (
          <p className="text-sm text-warm-text-secondary">No integrations connected yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {connected.map((i: any) => (
              <Card key={i.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-semibold">{i.displayName ?? i.name}</h3>
                    <Badge variant="success">Connected</Badge>
                  </div>
                  <p className="text-xs text-warm-text-secondary">{i.description || ''}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Available</h2>
        {available.length === 0 ? (
          <p className="text-sm text-warm-text-secondary">Everything's connected.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map((i: any) => (
              <Card key={i.id}>
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-1">{i.displayName ?? i.name}</h3>
                  <p className="text-xs text-warm-text-secondary">{i.description || ''}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Personal tab ──

const GOOGLE_SUB_IDS = new Set(['google-drive', 'google_drive', 'google-sheets', 'google-docs', 'gmail']);
const GOOGLE_IDS = new Set(['google', ...GOOGLE_SUB_IDS]);

function titleCaseStatus(status: string | null): string {
  const labels: Record<string, string> = { active: 'Active', expired: 'Expired', revoked: 'Revoked', unknown: 'Unknown' };
  return status ? labels[status] ?? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
}

interface ApiKeyFormSpec {
  id: string;
  name: string;
  configKeys: { key: string; label: string; placeholder: string; secret: boolean }[];
}

function PersonalTab() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data: personalConns, isLoading, isError } = usePersonalConnections();
  const { data: oauthIntegrations } = useOAuthIntegrations();
  const { data: allIntegrations } = useIntegrations();
  const { data: googleOAuthStatus } = useOAuthAppStatus('google');
  const { data: expiredData } = useExpiredConnectionCount();
  const createPersonal = useCreatePersonalConnection();
  const deleteConn = useDeleteConnection();
  const updateSettings = useUpdateConnectionSettings();

  const [showAdd, setShowAdd] = useState(false);
  // Single dialog, two views: "list" shows the integration picker, "form"
  // shows the api-key entry form. Swapping views in the same Dialog keeps
  // Radix from juggling two focus traps.
  const [pickerView, setPickerView] = useState<'list' | 'form'>('list');
  const [activeApiKeyForm, setActiveApiKeyForm] = useState<ApiKeyFormSpec | null>(null);
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
  const [folderDialog, setFolderDialog] = useState<{ connId: string; name: string; folderId: string; folderName: string } | null>(null);

  const handleOAuth = (integration: string) => {
    window.open(`/api/v1/connections/oauth/${integration}/start`, '_blank');
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this connection?')) {
      deleteConn.mutate(id, {
        onSuccess: () => toast({ title: 'Connection removed', variant: 'success' }),
        onError: (err) => toast({ title: 'Failed to delete', description: err.message, variant: 'error' }),
      });
    }
  };

  // Collapse 4 Google sibling rows into one "Google" row per user (see
  // plan-015 handleOAuthCallback fan-out). The Drive sub-row carries folder
  // restriction state; we surface that on the grouped row.
  const groupedConnections = useMemo(() => {
    if (!personalConns?.length) return [];
    const seen = new Set<string>();
    const result: any[] = [];
    for (const conn of personalConns as any[]) {
      if (GOOGLE_SUB_IDS.has(conn.integrationId)) {
        const key = `google::${conn.userId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const siblings = (personalConns as any[]).filter(
          (c: any) => GOOGLE_SUB_IDS.has(c.integrationId) && c.userId === conn.userId,
        );
        const driveRow = siblings.find((s: any) => s.integrationId === 'google-drive') ?? conn;
        const earliest = siblings
          .map((s: any) => s.createdAt ? new Date(s.createdAt).getTime() : Infinity)
          .reduce((a: number, b: number) => Math.min(a, b), Infinity);
        const anyExpired = siblings.some((s: any) => s.status === 'expired');
        const allActive = siblings.every((s: any) => s.status === 'active');
        result.push({
          ...driveRow,
          integrationName: 'Google',
          integrationId: 'google',
          status: anyExpired ? 'expired' : allActive ? 'active' : driveRow.status,
          createdAt: earliest === Infinity ? driveRow.createdAt : new Date(earliest).toISOString(),
        });
      } else {
        result.push(conn);
      }
    }
    return result;
  }, [personalConns]);

  const oauthList = useMemo(() => {
    const base = [
      {
        id: 'google',
        name: 'google',
        displayName: 'Google',
        description: 'One sign-in covers Gmail, Drive, Sheets, and Docs.',
        oauthSupported: googleOAuthStatus?.configured === true,
      },
      ...((oauthIntegrations ?? []) as any[]).filter(
        (i: any) => !GOOGLE_SUB_IDS.has(i.id) && i.id !== 'google' && i.oauthSupported,
      ),
    ];
    return base;
  }, [oauthIntegrations, googleOAuthStatus]);

  // Exclude Google sub-integrations (gmail, google-drive, etc.) — they carry
  // legacy configKeys in their manifests but the real flow is OAuth through
  // the consolidated "Google" row above. Letting them appear as API-key rows
  // prompts users for an access_token and gets you nowhere.
  const apiKeyIntegrations = ((allIntegrations ?? []) as any[]).filter(
    (i: any) =>
      (i.configKeys ?? []).length > 0 &&
      !oauthList.some((o: any) => o.id === i.id) &&
      !GOOGLE_IDS.has(i.id),
  );

  const handleApiKeySubmit = () => {
    if (!activeApiKeyForm) return;
    const hasAllRequired = activeApiKeyForm.configKeys.every((k) => apiKeyValues[k.key]?.trim());
    if (!hasAllRequired) {
      toast({ title: 'Missing fields', description: 'Fill all required fields.', variant: 'error' });
      return;
    }
    createPersonal.mutate(
      { integrationId: activeApiKeyForm.id, credentials: apiKeyValues, displayName: activeApiKeyForm.name },
      {
        onSuccess: () => {
          toast({ title: 'Connected', variant: 'success' });
          closePicker();
        },
        onError: (err) => toast({ title: 'Failed to connect', description: err.message, variant: 'error' }),
      },
    );
  };

  const closePicker = () => {
    setShowAdd(false);
    setPickerView('list');
    setActiveApiKeyForm(null);
    setApiKeyValues({});
  };

  const startApiKeyForm = (integration: any) => {
    setActiveApiKeyForm({
      id: integration.id,
      name: integration.displayName ?? integration.name ?? '',
      configKeys: (integration.configKeys ?? []).map((k: any) =>
        typeof k === 'string'
          ? {
              key: k,
              label: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              placeholder: '',
              secret: k.includes('key') || k.includes('token') || k.includes('secret'),
            }
          : {
              key: k.key,
              label: k.label ?? k.key,
              placeholder: k.placeholder ?? '',
              secret: k.secret ?? false,
            },
      ),
    });
    setApiKeyValues({});
    setPickerView('form');
  };

  // Build a set of integration ids the user already has active personal
  // connections for (used to show "Connected" state in the picker).
  const connectedIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of (personalConns ?? []) as any[]) {
      if (c.status === 'active') {
        set.add(c.integrationId);
        if (GOOGLE_SUB_IDS.has(c.integrationId)) set.add('google');
      }
    }
    return set;
  }, [personalConns]);

  if (isLoading) return <Skeleton className="h-[300px]" />;
  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-red-500">
          <AlertCircle className="h-5 w-5 mx-auto mb-2" />
          Failed to load your connections
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {expiredData && expiredData.count > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            {expiredData.count} connection{expiredData.count > 1 ? 's have' : ' has'} expired. Reconnect to restore access.
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add connection
        </Button>
      </div>

      {groupedConnections.length === 0 ? (
        <EmptyState
          icon={ExternalLink}
          title="No personal connections"
          description="Add a personal connection to use your own account with agents."
        />
      ) : (
        <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Integration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connected since</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedConnections.map((conn) => {
                const isGoogleGroup = conn.integrationId === 'google';
                const isGoogleDrive = conn.integrationId === 'google-drive' || isGoogleGroup;
                return (
                  <TableRow key={conn.id}>
                    <TableCell>
                      <p className="font-medium">{conn.integrationName ?? '—'}</p>
                      {conn.rootFolderName && (
                        <p className="text-xs text-warm-text-secondary flex items-center gap-1 mt-0.5">
                          <Folder className="h-3 w-3" /> {conn.rootFolderName}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={conn.status === 'active' ? 'success' : conn.status === 'expired' ? 'warning' : 'danger'}>
                        {titleCaseStatus(conn.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-warm-text-secondary text-xs">
                      {conn.createdAt ? formatDistanceToNow(new Date(conn.createdAt), { addSuffix: true }) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {conn.status === 'expired' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const target = isGoogleGroup ? 'google' : conn.integrationId;
                              window.open(`/api/v1/connections/oauth/${target}/start`, '_blank');
                            }}
                          >
                            Reconnect
                          </Button>
                        )}
                        {isGoogleDrive && conn.status !== 'expired' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setFolderDialog({
                              connId: conn.id,
                              name: conn.integrationName ?? 'Google Drive',
                              folderId: conn.rootFolderId ?? '',
                              folderName: conn.rootFolderName ?? '',
                            })}
                          >
                            <Settings2 className="mr-1 h-3.5 w-3.5" />
                            {conn.rootFolderId ? 'Change Drive folder' : 'Restrict Drive access'}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleDelete(conn.id)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add connection picker */}
      <Dialog open={showAdd} onOpenChange={(open) => { if (!open) closePicker(); else setShowAdd(true); }}>
        <DialogContent>
          {pickerView === 'list' ? (
            <>
              <DialogHeader>
                <DialogTitle>Add personal connection</DialogTitle>
                <DialogDescription>Connect your personal account to an integration.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {oauthList.length === 0 && apiKeyIntegrations.length === 0 ? (
                  <p className="text-sm text-warm-text-secondary text-center py-4">No integrations available.</p>
                ) : (
                  <>
                    {oauthList.map((integration: any) => {
                      const isGoogle = GOOGLE_IDS.has(integration.id);
                      const googleAppNotReady = isGoogle && googleOAuthStatus && !googleOAuthStatus.configured;
                      const isConnected = connectedIds.has(integration.id);
                      return (
                        <div key={integration.id} className={`flex items-center justify-between rounded-lg border border-warm-border p-3 ${googleAppNotReady ? 'opacity-60' : ''}`}>
                          <div className="flex items-center gap-3">
                            <ExternalLink className="h-5 w-5 text-brand shrink-0" />
                            <div>
                              <p className="text-sm font-medium">{integration.displayName ?? integration.name}</p>
                              {googleAppNotReady ? (
                                <p className="text-xs text-warm-text-secondary">
                                  {isAdmin
                                    ? 'Set up the Google connection app on the Team tab first.'
                                    : 'Ask an admin to set up the Google connection app first.'}
                                </p>
                              ) : integration.description ? (
                                <p className="text-xs text-warm-text-secondary line-clamp-1">{integration.description}</p>
                              ) : null}
                            </div>
                          </div>
                          {isConnected ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                              <CheckCircle2 className="h-4 w-4" /> Connected
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!!googleAppNotReady}
                              onClick={() => { handleOAuth(integration.name); closePicker(); }}
                            >
                              Connect
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {apiKeyIntegrations.map((integration: any) => {
                      const isConnected = connectedIds.has(integration.id);
                      return (
                        <div key={integration.id} className="flex items-center justify-between rounded-lg border border-warm-border p-3">
                          <div className="flex items-center gap-3">
                            <Key className="h-5 w-5 text-warm-text-secondary shrink-0" />
                            <div>
                              <p className="text-sm font-medium">{integration.displayName ?? integration.name}</p>
                              <p className="text-xs text-warm-text-secondary">API key</p>
                            </div>
                          </div>
                          {isConnected ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                              <CheckCircle2 className="h-4 w-4" /> Connected
                            </span>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => startApiKeyForm(integration)}>
                              Connect
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          ) : activeApiKeyForm ? (
            <>
              <DialogHeader>
                <DialogTitle>Connect {activeApiKeyForm.name}</DialogTitle>
                <DialogDescription>Enter your credentials for {activeApiKeyForm.name}.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {activeApiKeyForm.configKeys.map((k) => (
                  <div key={k.key}>
                    <Label className="text-sm">{k.label}</Label>
                    <Input
                      type={k.secret ? 'password' : 'text'}
                      placeholder={k.placeholder}
                      value={apiKeyValues[k.key] ?? ''}
                      onChange={(e) => setApiKeyValues((prev) => ({ ...prev, [k.key]: e.target.value }))}
                      className="mt-1 font-mono text-sm"
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setPickerView('list'); setActiveApiKeyForm(null); setApiKeyValues({}); }}>
                  Back
                </Button>
                <Button onClick={handleApiKeySubmit} disabled={createPersonal.isPending}>Connect</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Folder restriction dialog */}
      <Dialog open={!!folderDialog} onOpenChange={() => setFolderDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restrict to folder</DialogTitle>
            <DialogDescription>
              Choose a folder to restrict {folderDialog?.name} access. By default, all folders are accessible.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-sm mb-2 block">Root folder</Label>
            <DriveFolderPicker
              value={folderDialog?.folderId ?? ''}
              valueName={folderDialog?.folderName ?? ''}
              onChange={(id, name) => setFolderDialog((prev) => prev ? { ...prev, folderId: id, folderName: name } : null)}
              placeholder="All folders (no restriction)"
              helpText="By default agents can access any folder. Pick one to restrict access to that folder and its contents."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialog(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!folderDialog) return;
                updateSettings.mutate(
                  { id: folderDialog.connId, rootFolderId: folderDialog.folderId || '', rootFolderName: folderDialog.folderName || '' },
                  {
                    onSuccess: () => { toast({ title: 'Folder updated', variant: 'success' }); setFolderDialog(null); },
                    onError: (err) => toast({ title: 'Failed', description: err.message, variant: 'error' }),
                  },
                );
              }}
              disabled={updateSettings.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

