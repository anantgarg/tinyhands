import { useState } from 'react';
import { Check, Trash2, MoreVertical, AlertCircle, Shield, Pencil, Unplug, Plus, Wand2, Loader2, Play } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useIntegrations,
  useRegisterIntegration,
  useDisconnectIntegration,
  useCustomTools,
  useApproveCustomTool,
  useDeleteCustomTool,
  useCreateCustomTool,
  useGenerateTool,
  useTestTool,
} from '@/api/tools';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';

function fmtUserId(createdBy: unknown): string {
  if (!createdBy || typeof createdBy !== 'string') return '\u2014';
  if (createdBy.startsWith('U')) return '\u2014';
  return createdBy;
}

interface ToolGroup {
  name: string;
  displayName: string;
  tools: any[];
  accessLevels: string[];
}

function groupToolsByIntegration(tools: any[]): ToolGroup[] {
  const groups: Record<string, { name: string; tools: any[]; accessLevels: string[] }> = {};
  for (const tool of tools) {
    const baseName = tool.name.replace(/-(read|write|search)$/, '');
    if (!groups[baseName]) {
      groups[baseName] = { name: baseName, tools: [], accessLevels: [] };
    }
    groups[baseName].tools.push(tool);
    if (tool.accessLevel) {
      const level = tool.accessLevel.replace('read-only', 'read').replace('read-write', 'write');
      if (!groups[baseName].accessLevels.includes(level)) {
        groups[baseName].accessLevels.push(level);
      }
    }
  }
  return Object.values(groups).map(g => ({
    ...g,
    displayName: g.name.charAt(0).toUpperCase() + g.name.slice(1).replace(/[-_]/g, ' '),
  }));
}

export function Tools() {
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
  return <ToolsContent />;
}

function ToolsContent() {
  const { data: integrations, isLoading: intLoading, isError: intError } = useIntegrations();
  const { data: customTools, isLoading: ctLoading } = useCustomTools();
  const registerIntegration = useRegisterIntegration();
  const disconnectIntegration = useDisconnectIntegration();
  const approveCustomTool = useApproveCustomTool();
  const deleteCustomTool = useDeleteCustomTool();
  const createCustomTool = useCreateCustomTool();
  const generateTool = useGenerateTool();
  const testTool = useTestTool();

  // Create tool dialog state
  const [showCreateTool, setShowCreateTool] = useState(false);
  const [createToolMode, setCreateToolMode] = useState<'ai' | 'manual'>('ai');
  const [toolAiDesc, setToolAiDesc] = useState('');
  const [toolName, setToolName] = useState('');
  const [toolDesc, setToolDesc] = useState('');
  const [toolLang, setToolLang] = useState('javascript');
  const [toolCode, setToolCode] = useState('');
  const [toolSchema, setToolSchema] = useState('{"type":"object","properties":{}}');
  const [testResult, setTestResult] = useState<{ passed: boolean; output: string; error: string | null } | null>(null);

  const resetToolForm = () => {
    setToolAiDesc('');
    setToolName('');
    setToolDesc('');
    setToolLang('javascript');
    setToolCode('');
    setToolSchema('{"type":"object","properties":{}}');
    setTestResult(null);
  };

  const handleGenerateTool = () => {
    generateTool.mutate(
      { description: toolAiDesc, language: toolLang },
      {
        onSuccess: (data) => {
          setToolName(data.name);
          setToolDesc(data.description);
          setToolCode(data.code);
          setToolSchema(JSON.stringify(data.inputSchema, null, 2));
          setToolLang(data.language);
          setCreateToolMode('manual');
          toast({ title: 'Tool generated', description: 'Review the code and test it', variant: 'success' });
        },
        onError: (err: any) => toast({ title: 'Generation failed', description: err.message, variant: 'error' }),
      },
    );
  };

  const handleTestTool = () => {
    if (!toolName) { toast({ title: 'Name required', variant: 'error' }); return; }
    testTool.mutate(
      { name: toolName, code: toolCode, inputSchema: JSON.parse(toolSchema) },
      {
        onSuccess: (data) => {
          setTestResult(data);
          if (data.passed) {
            toast({ title: 'Test passed', variant: 'success' });
          } else {
            toast({ title: 'Test failed', description: data.error || 'Unknown error', variant: 'error' });
          }
        },
        onError: (err: any) => toast({ title: 'Test error', description: err.message, variant: 'error' }),
      },
    );
  };

  const handleCreateTool = () => {
    createCustomTool.mutate(
      { name: toolName, displayName: toolName, description: toolDesc, schema: JSON.parse(toolSchema), code: toolCode },
      {
        onSuccess: () => {
          toast({ title: 'Tool created', variant: 'success' });
          setShowCreateTool(false);
          resetToolForm();
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
      },
    );
  };

  const [registerDialog, setRegisterDialog] = useState<{
    id: string;
    name: string;
    isEdit: boolean;
    configKeys: { key: string; label: string; placeholder: string; required: boolean; secret: boolean }[];
    setupGuide: string | null;
  } | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  const connected = (integrations ?? []).filter((i) => i.status === 'active');
  const available = (integrations ?? []).filter((i) => i.status !== 'active');

  // Group custom tools by integration base name
  const toolGroups = groupToolsByIntegration(customTools ?? []);

  // Map integration IDs to their tool groups
  const integrationToolMap = new Map<string, ToolGroup>();
  for (const group of toolGroups) {
    integrationToolMap.set(group.name, group);
  }

  // Determine which custom tools are NOT associated with a known integration
  const knownIntegrationIds = new Set((integrations ?? []).map(i => i.id));
  const standaloneTools = toolGroups.filter(g => !knownIntegrationIds.has(g.name));

  const handleRegister = () => {
    if (!registerDialog) return;
    registerIntegration.mutate(
      { integrationId: registerDialog.id, config: configValues },
      {
        onSuccess: () => {
          toast({ title: 'Integration connected', variant: 'success' });
          setRegisterDialog(null);
          setConfigValues({});
        },
        onError: (err) => {
          toast({ title: 'Connection failed', description: err.message, variant: 'error' });
        },
      },
    );
  };

  const handleApprove = (id: string) => {
    approveCustomTool.mutate(id, {
      onSuccess: () => toast({ title: 'Tool approved', variant: 'success' }),
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Delete tool "${name}"?`)) {
      deleteCustomTool.mutate(id, {
        onSuccess: () => toast({ title: 'Tool deleted', variant: 'success' }),
      });
    }
  };

  return (
    <div>
      <PageHeader title="Tools & Integrations" description="Connect external services for your agents to use">
        <Button onClick={() => setShowCreateTool(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Create Tool
        </Button>
      </PageHeader>

      {/* Connected Integrations */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Connected</h2>
        {intLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px]" />
            ))}
          </div>
        ) : intError ? (
          <Card>
            <CardContent className="py-8 text-center text-red-500">
              <AlertCircle className="h-5 w-5 mx-auto mb-2" />
              Failed to load integrations
            </CardContent>
          </Card>
        ) : connected.length === 0 ? (
          <p className="text-sm text-warm-text-secondary">No integrations connected yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {connected.map((integration) => {
              const tools = integrationToolMap.get(integration.id);
              return (
                <Card key={integration.id} className="flex flex-col">
                  <CardContent className="p-5 flex flex-col flex-1">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold">{integration.displayName ?? integration.name ?? 'Unknown'}</h3>
                      <Badge variant="success">Connected</Badge>
                    </div>
                    <p className="text-xs text-warm-text-secondary mb-3 flex-1">{integration.description || ''}</p>
                    <div className="flex items-center justify-between">
                      {tools ? (
                        <div className="flex gap-1">
                          {tools.accessLevels.includes('read') && <Badge variant="default" className="text-xs">Can view data</Badge>}
                          {tools.accessLevels.includes('write') && <Badge variant="warning" className="text-xs">Can make changes</Badge>}
                        </div>
                      ) : (
                        <span className="text-xs text-warm-text-secondary">{integration.toolsCount ?? 0} tools</span>
                      )}
                      <div className="flex gap-1">
                        {integration.connectionModel !== 'personal' && (integration.configKeys ?? []).length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setRegisterDialog({
                                id: integration.id,
                                name: integration.displayName ?? integration.name ?? 'Integration',
                                isEdit: true,
                                configKeys: integration.configKeys ?? [],
                                setupGuide: integration.setupGuide ?? null,
                              });
                              setConfigValues({});
                            }}
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-500 hover:text-red-600"
                          onClick={() => {
                            if (confirm(`Disconnect ${integration.displayName}? Agents using this integration will lose access.`)) {
                              disconnectIntegration.mutate(integration.id, {
                                onSuccess: () => toast({ title: 'Disconnected', variant: 'success' }),
                                onError: (err) => toast({ title: 'Failed', description: err.message, variant: 'error' }),
                              });
                            }
                          }}
                        >
                          <Unplug className="mr-1 h-3 w-3" />
                          Disconnect
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Available Integrations */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Available</h2>
        {intLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px]" />
            ))}
          </div>
        ) : available.length === 0 ? (
          <p className="text-sm text-warm-text-secondary">All integrations are connected.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map((integration) => (
              <Card key={integration.id} className="transition-colors hover:bg-warm-bg/30">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-1">{integration.displayName ?? integration.name ?? 'Unknown'}</h3>
                  <p className="text-xs text-warm-text-secondary mb-3">{integration.description || 'Available for connection'}</p>
                  {integration.connectionModel === 'personal' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/api/v1/connections/oauth/${integration.id}/start`, '_blank')}
                    >
                      Connect with Google
                      <Check className="ml-1 h-3 w-3" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRegisterDialog({
                          id: integration.id,
                          name: integration.displayName ?? integration.name ?? 'Integration',
                          isEdit: false,
                          configKeys: integration.configKeys ?? [],
                          setupGuide: integration.setupGuide ?? null,
                        });
                        setConfigValues({});
                      }}
                    >
                      Connect
                      <Check className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Agent-Created Tools (only standalone tools not linked to integrations) */}
      {!ctLoading && standaloneTools.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">Agent-Created Tools</h2>
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Creator</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {standaloneTools.map((group) => {
                      const firstTool = group.tools[0];
                      const allApproved = group.tools.every((t: any) => t.approved);
                      const earliestDate = group.tools
                        .filter((t: any) => t.createdAt)
                        .map((t: any) => new Date(t.createdAt).getTime())
                        .sort((a: number, b: number) => a - b)[0];
                      return (
                        <TableRow key={group.name}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{group.displayName}</p>
                              <p className="text-xs text-warm-text-secondary line-clamp-1">
                                {firstTool?.description || 'No description'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {group.accessLevels.includes('read') && (
                                <Badge variant="default">Can view data</Badge>
                              )}
                              {group.accessLevels.includes('write') && (
                                <Badge variant="warning">Can make changes</Badge>
                              )}
                              {group.accessLevels.length === 0 && (
                                <Badge variant="secondary">{firstTool?.accessLevel || 'read-only'}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={allApproved ? 'success' : 'warning'}>
                              {allApproved ? 'Approved' : 'Pending'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-warm-text-secondary text-xs">
                            {fmtUserId(firstTool?.createdBy)}
                          </TableCell>
                          <TableCell className="text-warm-text-secondary text-xs">
                            {earliestDate
                              ? formatDistanceToNow(new Date(earliestDate), { addSuffix: true })
                              : '\u2014'}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {!allApproved && group.tools.filter((t: any) => !t.approved).map((t: any) => (
                                  <DropdownMenuItem key={t.id} onClick={() => handleApprove(t.id)}>
                                    <Check className="mr-2 h-4 w-4" />
                                    Approve {group.tools.length > 1 ? t.name : ''}
                                  </DropdownMenuItem>
                                ))}
                                {group.tools.map((t: any) => (
                                  <DropdownMenuItem
                                    key={`del-${t.id}`}
                                    className="text-red-600"
                                    onClick={() => handleDelete(t.id, t.displayName || t.name || 'tool')}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete {group.tools.length > 1 ? t.name : ''}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Register / Edit Dialog */}
      <Dialog open={!!registerDialog} onOpenChange={() => setRegisterDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{registerDialog?.isEdit ? 'Edit' : 'Connect'} {registerDialog?.name}</DialogTitle>
            <DialogDescription>
              {registerDialog?.isEdit
                ? 'Update the credentials for this integration. Leave fields blank to keep the current values.'
                : 'Enter the configuration values for this integration'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {registerDialog?.setupGuide && !registerDialog.isEdit && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <p className="text-xs font-semibold text-blue-800 mb-1.5">Where to find your credentials</p>
                <div className="text-xs text-blue-900 whitespace-pre-line leading-relaxed">
                  {registerDialog.setupGuide.replace(/\*/g, '')}
                </div>
              </div>
            )}
            {(registerDialog?.configKeys ?? []).map((key) => (
              <div key={key.key}>
                <Label>
                  {key.label}
                  {key.required && !registerDialog?.isEdit && <span className="text-red-500 ml-1">*</span>}
                </Label>
                <Input
                  type={key.secret ? 'password' : 'text'}
                  value={configValues[key.key] ?? ''}
                  onChange={(e) => setConfigValues((prev) => ({ ...prev, [key.key]: e.target.value }))}
                  placeholder={registerDialog?.isEdit && key.secret ? 'Leave blank to keep current' : (key.placeholder || '')}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterDialog(null)}>Cancel</Button>
            <Button onClick={handleRegister} disabled={registerIntegration.isPending}>
              {registerDialog?.isEdit ? 'Save Changes' : 'Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Tool Dialog */}
      <Dialog open={showCreateTool} onOpenChange={(v) => { setShowCreateTool(v); if (!v) resetToolForm(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Custom Tool</DialogTitle>
            <DialogDescription>Build a new tool using AI or write code manually.</DialogDescription>
          </DialogHeader>

          <Tabs value={createToolMode} onValueChange={(v) => setCreateToolMode(v as any)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="ai"><Wand2 className="mr-1.5 h-3.5 w-3.5" /> AI Generate</TabsTrigger>
              <TabsTrigger value="manual"><Pencil className="mr-1.5 h-3.5 w-3.5" /> Manual</TabsTrigger>
            </TabsList>

            <TabsContent value="ai" className="space-y-4 mt-4">
              <div>
                <Label>Describe what the tool should do</Label>
                <Textarea
                  value={toolAiDesc}
                  onChange={(e) => setToolAiDesc(e.target.value)}
                  placeholder="e.g., A tool that fetches weather data for a given city and returns temperature, humidity, and conditions"
                  rows={4}
                />
              </div>
              <div>
                <Label>Language</Label>
                <select
                  value={toolLang}
                  onChange={(e) => setToolLang(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="bash">Bash</option>
                </select>
              </div>
              <Button onClick={handleGenerateTool} disabled={!toolAiDesc.trim() || generateTool.isPending} className="w-full">
                {generateTool.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</>
                ) : (
                  <><Wand2 className="mr-1.5 h-4 w-4" /> Generate Tool</>
                )}
              </Button>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Name</Label>
                  <Input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="my-custom-tool" />
                </div>
                <div>
                  <Label>Language</Label>
                  <select
                    value={toolLang}
                    onChange={(e) => setToolLang(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="bash">Bash</option>
                  </select>
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Input value={toolDesc} onChange={(e) => setToolDesc(e.target.value)} placeholder="What does this tool do?" />
              </div>
              <div>
                <Label>Input Schema (JSON)</Label>
                <Textarea
                  value={toolSchema}
                  onChange={(e) => setToolSchema(e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label>Code</Label>
                <Textarea
                  value={toolCode}
                  onChange={(e) => setToolCode(e.target.value)}
                  placeholder="// Tool code here..."
                  rows={10}
                  className="font-mono text-xs"
                />
              </div>

              {testResult && (
                <div className={`rounded-lg border p-3 text-sm ${testResult.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                  <p className="font-medium mb-1">{testResult.passed ? 'Test Passed' : 'Test Failed'}</p>
                  {testResult.output && <pre className="text-xs font-mono whitespace-pre-wrap">{testResult.output}</pre>}
                  {testResult.error && <pre className="text-xs font-mono text-red-700 whitespace-pre-wrap">{testResult.error}</pre>}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={handleTestTool} disabled={!toolName || !toolCode || testTool.isPending}>
                  {testTool.isPending ? (
                    <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Testing...</>
                  ) : (
                    <><Play className="mr-1.5 h-3.5 w-3.5" /> Test in Sandbox</>
                  )}
                </Button>
                <Button onClick={handleCreateTool} disabled={!toolName || createCustomTool.isPending}>
                  {createCustomTool.isPending ? 'Creating...' : 'Create Tool'}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
