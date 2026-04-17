import { useState } from 'react';
import { Sparkles, Plus, Pencil, Trash2, Cpu, FileText, Wand2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useBuiltinSkills,
  useWorkspaceSkills,
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
  useGenerateSkill,
  type Skill,
} from '@/api/skills';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';

export function Skills() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data: builtin, isLoading: builtinLoading } = useBuiltinSkills();
  const { data: workspace, isLoading: workspaceLoading } = useWorkspaceSkills();
  const createSkill = useCreateSkill();
  const updateSkill = useUpdateSkill();
  const deleteSkillMut = useDeleteSkill();
  const generateSkill = useGenerateSkill();

  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<'manual' | 'ai'>('ai');
  const [editSkill, setEditSkill] = useState<Skill | null>(null);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'prompt_template' | 'mcp'>('prompt_template');
  const [newDescription, setNewDescription] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [newCapabilities, setNewCapabilities] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  const resetForm = () => {
    setNewName('');
    setNewType('prompt_template');
    setNewDescription('');
    setNewTemplate('');
    setNewCapabilities('');
    setAiPrompt('');
    setGenerating(false);
  };

  const handleCreate = () => {
    const data: any = { name: newName, type: newType, description: newDescription };
    if (newType === 'prompt_template') data.template = newTemplate;
    if (newType === 'mcp') data.capabilities = newCapabilities.split('\n').map(s => s.trim()).filter(Boolean);

    createSkill.mutate(data, {
      onSuccess: () => {
        toast({ title: 'Skill created', variant: 'success' });
        setShowCreate(false);
        resetForm();
      },
      onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
    });
  };

  const handleGenerate = () => {
    setGenerating(true);
    generateSkill.mutate(aiPrompt, {
      onSuccess: (data) => {
        setNewName(data.name);
        setNewDescription(data.description);
        setNewTemplate(data.template);
        setNewType('prompt_template');
        setCreateMode('manual');
        setGenerating(false);
        toast({ title: 'Skill generated', description: 'Review and create below', variant: 'success' });
      },
      onError: (err: any) => {
        setGenerating(false);
        toast({ title: 'Generation failed', description: err.message, variant: 'error' });
      },
    });
  };

  const handleUpdate = () => {
    if (!editSkill) return;
    const config: any = {};
    try {
      const parsed = JSON.parse(editSkill.configJson);
      if (parsed.description !== undefined) config.description = parsed.description;
      if (parsed.template !== undefined) config.template = parsed.template;
      if (parsed.capabilities !== undefined) config.capabilities = parsed.capabilities;
    } catch { /* ignore */ }

    updateSkill.mutate({ id: editSkill.id, ...config }, {
      onSuccess: () => {
        toast({ title: 'Skill updated', variant: 'success' });
        setEditSkill(null);
      },
      onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this skill? It will be detached from all agents.')) return;
    deleteSkillMut.mutate(id, {
      onSuccess: () => toast({ title: 'Skill deleted', variant: 'success' }),
      onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
    });
  };

  const parseConfig = (configJson: string): Record<string, any> => {
    try { return JSON.parse(configJson); } catch { return {}; }
  };

  const isLoading = builtinLoading || workspaceLoading;

  return (
    <div className="space-y-6">
      <PageHeader title="Skills" description="Manage built-in and custom skills for your agents">
        {isAdmin && (
          <Button onClick={() => { resetForm(); setShowCreate(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Create Skill
          </Button>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Built-in Skills */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-warm-text-secondary/60">Built-in Skills</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {builtin?.mcp.map((s) => (
                <Card key={s.name} className="border-warm-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-blue-500" />
                        <span className="font-medium text-sm">{s.name}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">MCP</Badge>
                    </div>
                    {s.capabilities.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.capabilities.slice(0, 4).map((c) => (
                          <Badge key={c} variant="secondary" className="text-[10px] font-normal">{c}</Badge>
                        ))}
                        {s.capabilities.length > 4 && (
                          <Badge variant="secondary" className="text-[10px] font-normal">+{s.capabilities.length - 4}</Badge>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {builtin?.prompt.map((s) => (
                <Card key={s.name} className="border-warm-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-amber-500" />
                        <span className="font-medium text-sm">{s.name}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">Prompt</Badge>
                    </div>
                    <p className="mt-1.5 text-xs text-warm-text-secondary line-clamp-2">{s.description}</p>
                  </CardContent>
                </Card>
              ))}
              {(!builtin?.mcp.length && !builtin?.prompt.length) && (
                <p className="text-sm text-warm-text-secondary col-span-full">No built-in skills available.</p>
              )}
            </div>
          </div>

          {/* Custom Skills */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-warm-text-secondary/60">Custom Skills</h2>
            {workspace && workspace.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {workspace.map((s) => {
                  const cfg = parseConfig(s.configJson);
                  return (
                    <Card key={s.id} className="border-warm-border group">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            {s.skillType === 'mcp' ? (
                              <Cpu className="h-4 w-4 text-blue-500" />
                            ) : (
                              <FileText className="h-4 w-4 text-amber-500" />
                            )}
                            <span className="font-medium text-sm">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="secondary" className="text-[10px]">
                              {s.skillType === 'mcp' ? 'MCP' : 'Prompt'}
                            </Badge>
                            {isAdmin && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 ml-1">
                                <button
                                  onClick={() => setEditSkill(s)}
                                  className="p-1 rounded hover:bg-warm-bg text-warm-text-secondary hover:text-warm-text"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDelete(s.id)}
                                  className="p-1 rounded hover:bg-red-50 text-warm-text-secondary hover:text-red-600"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        {cfg.description && (
                          <p className="mt-1.5 text-xs text-warm-text-secondary line-clamp-2">{cfg.description}</p>
                        )}
                        {cfg.capabilities && cfg.capabilities.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {cfg.capabilities.slice(0, 3).map((c: string) => (
                              <Badge key={c} variant="secondary" className="text-[10px] font-normal">{c}</Badge>
                            ))}
                          </div>
                        )}
                        <p className="mt-2 text-[10px] text-warm-text-secondary/50">v{s.version}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="border-warm-border border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-10">
                  <Sparkles className="h-8 w-8 text-warm-text-secondary/30 mb-2" />
                  <p className="text-sm text-warm-text-secondary">No custom skills yet</p>
                  {isAdmin && (
                    <Button variant="secondary" size="sm" className="mt-3" onClick={() => { resetForm(); setShowCreate(true); }}>
                      Create your first skill
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Create Skill Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Skill</DialogTitle>
          </DialogHeader>

          <Tabs value={createMode} onValueChange={(v) => setCreateMode(v as any)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="ai"><Wand2 className="mr-1.5 h-3.5 w-3.5" /> AI Generate</TabsTrigger>
              <TabsTrigger value="manual"><Pencil className="mr-1.5 h-3.5 w-3.5" /> Manual</TabsTrigger>
            </TabsList>

            <TabsContent value="ai" className="space-y-4 mt-4">
              <div>
                <Label>Describe what the skill should do</Label>
                <Textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g., A skill that summarizes customer feedback into actionable items with severity ratings"
                  rows={4}
                />
              </div>
              <Button onClick={handleGenerate} disabled={!aiPrompt.trim() || generating} className="w-full">
                {generating ? (
                  <><div className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Generating...</>
                ) : (
                  <><Wand2 className="mr-1.5 h-4 w-4" /> Generate Skill</>
                )}
              </Button>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4 mt-4">
              <div>
                <Label>Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-custom-skill" />
              </div>
              <div>
                <Label>Type</Label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as any)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="prompt_template">Prompt Template</option>
                  <option value="mcp">MCP</option>
                </select>
              </div>
              <div>
                <Label>Description</Label>
                <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="What does this skill do?" />
              </div>
              {newType === 'prompt_template' && (
                <div>
                  <Label>Template</Label>
                  <Textarea
                    value={newTemplate}
                    onChange={(e) => setNewTemplate(e.target.value)}
                    placeholder="Use {{variable}} for placeholders"
                    rows={6}
                    className="font-mono text-xs"
                  />
                </div>
              )}
              {newType === 'mcp' && (
                <div>
                  <Label>Capabilities (one per line)</Label>
                  <Textarea
                    value={newCapabilities}
                    onChange={(e) => setNewCapabilities(e.target.value)}
                    placeholder="read_files&#10;search_code&#10;run_tests"
                    rows={4}
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            {createMode === 'manual' && (
              <Button onClick={handleCreate} disabled={!newName.trim() || createSkill.isPending}>
                {createSkill.isPending ? 'Creating...' : 'Create'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Skill Dialog */}
      <Dialog open={!!editSkill} onOpenChange={(open) => !open && setEditSkill(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Skill: {editSkill?.name}</DialogTitle>
          </DialogHeader>
          {editSkill && (() => {
            const cfg = parseConfig(editSkill.configJson);
            return (
              <div className="space-y-4">
                <div>
                  <Label>Description</Label>
                  <Input
                    value={cfg.description || ''}
                    onChange={(e) => setEditSkill({
                      ...editSkill,
                      configJson: JSON.stringify({ ...cfg, description: e.target.value }),
                    })}
                  />
                </div>
                {editSkill.skillType === 'prompt_template' && (
                  <div>
                    <Label>Template</Label>
                    <Textarea
                      value={cfg.template || ''}
                      onChange={(e) => setEditSkill({
                        ...editSkill,
                        configJson: JSON.stringify({ ...cfg, template: e.target.value }),
                      })}
                      rows={8}
                      className="font-mono text-xs"
                    />
                  </div>
                )}
                {editSkill.skillType === 'mcp' && (
                  <div>
                    <Label>Capabilities (one per line)</Label>
                    <Textarea
                      value={(cfg.capabilities || []).join('\n')}
                      onChange={(e) => setEditSkill({
                        ...editSkill,
                        configJson: JSON.stringify({ ...cfg, capabilities: e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean) }),
                      })}
                      rows={4}
                    />
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditSkill(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateSkill.isPending}>
              {updateSkill.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
