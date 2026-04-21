import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen, FileText, Folder, Settings as SettingsIcon, RefreshCw, Maximize2, X, Loader2, AlertCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import {
  useWikiPages, useWikiPage, useUpdateWikiSchema, useWikiMode, useSetWikiMode,
  useIngestJobs, useRetryIngestJob, useParserKeys, useSetParserKeys,
  useBackfills, useStartBackfill, useControlBackfill,
  type WikiNamespace,
} from '@/api/kb';
import { useAuthStore } from '@/store/auth';

export default function Wiki() {
  const [searchParams, setSearchParams] = useSearchParams();
  const namespace: WikiNamespace = (searchParams.get('ns') === 'docs' ? 'docs' : 'kb');
  const setNamespace = (ns: WikiNamespace) => setSearchParams({ ns });

  const surface = namespace === 'kb' ? 'Knowledge Base' : 'Documents';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wiki"
        description="LLM-curated pages built from your knowledge base and documents. Agents read these directly — no embeddings."
      />

      <Tabs value={namespace} onValueChange={(v) => setNamespace(v as WikiNamespace)}>
        <TabsList>
          <TabsTrigger value="kb"><BookOpen className="w-4 h-4 mr-2" />KB wiki</TabsTrigger>
          <TabsTrigger value="docs"><FileText className="w-4 h-4 mr-2" />Documents wiki</TabsTrigger>
        </TabsList>
        <TabsContent value="kb" className="mt-6">
          <WikiSurface namespace="kb" surfaceName={surface} />
        </TabsContent>
        <TabsContent value="docs" className="mt-6">
          <WikiSurface namespace="docs" surfaceName={surface} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WikiSurface({ namespace, surfaceName }: { namespace: WikiNamespace; surfaceName: string }) {
  const { data: pagesData, isLoading } = useWikiPages(namespace);
  const [selectedPath, setSelectedPath] = useState<string>('index.md');
  const [fullScreen, setFullScreen] = useState(false);
  const { data: page } = useWikiPage(namespace, selectedPath);
  const { user } = useAuthStore();
  const isAdmin = user?.platformAdmin;

  const grouped = useMemo(() => groupPages(pagesData?.pages || []), [pagesData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {pagesData?.pages.length ?? 0} pages in the {surfaceName.toLowerCase()} wiki.
        </div>
        <Button variant="outline" onClick={() => setFullScreen(true)}>
          <Maximize2 className="w-4 h-4 mr-2" /> Open wiki
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3 space-y-2 max-h-[70vh] overflow-y-auto">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <PageTree groups={grouped} selectedPath={selectedPath} onSelect={setSelectedPath} />
          )}
        </div>
        <div className="col-span-9">
          <Card>
            <CardContent className="prose dark:prose-invert max-w-none p-6">
              {page ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content}</ReactMarkdown>
              ) : (
                <div className="text-sm text-muted-foreground">Pick a page on the left.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <IngestJobsPanel namespace={namespace} />

      {isAdmin && namespace === 'kb' && <ParserKeysPanel />}

      {isAdmin && (
        <>
          <SchemaEditor namespace={namespace} />
          <ModePanel namespace={namespace} />
          <BackfillPanel namespace={namespace} />
        </>
      )}

      <Dialog open={fullScreen} onOpenChange={setFullScreen}>
        <DialogContent className="max-w-[95vw] h-[90vh] p-0">
          <DialogHeader className="border-b px-6 py-3 flex flex-row items-center justify-between">
            <DialogTitle>{surfaceName} wiki</DialogTitle>
            <Button variant="ghost" size="icon" onClick={() => setFullScreen(false)}><X className="w-4 h-4" /></Button>
          </DialogHeader>
          <div className="grid grid-cols-12 gap-0 h-[calc(90vh-60px)]">
            <div className="col-span-3 border-r overflow-y-auto p-3">
              <PageTree groups={grouped} selectedPath={selectedPath} onSelect={setSelectedPath} />
            </div>
            <div className="col-span-9 overflow-y-auto p-6 prose dark:prose-invert max-w-none">
              {page && <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content}</ReactMarkdown>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function groupPages(pages: { path: string; title: string; kind: string }[]) {
  const groups: Record<string, { path: string; title: string }[]> = {
    Top: [], Sources: [], Entities: [], Concepts: [], Other: [],
  };
  for (const p of pages) {
    if (p.path.startsWith('sources/')) groups.Sources.push(p);
    else if (p.path.startsWith('entities/')) groups.Entities.push(p);
    else if (p.path.startsWith('concepts/')) groups.Concepts.push(p);
    else if (['index.md', 'log.md', 'schema.md'].includes(p.path)) groups.Top.push(p);
    else groups.Other.push(p);
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.path.localeCompare(b.path));
  return groups;
}

function PageTree({
  groups, selectedPath, onSelect,
}: { groups: Record<string, { path: string; title: string }[]>; selectedPath: string; onSelect: (p: string) => void }) {
  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([heading, items]) => (
        items.length === 0 ? null : (
          <div key={heading}>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">{heading}</div>
            <ul className="space-y-1">
              {items.map(p => (
                <li key={p.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.path)}
                    className={`w-full text-left text-sm px-2 py-1 rounded hover:bg-muted ${selectedPath === p.path ? 'bg-muted font-semibold' : ''}`}
                  >
                    <Folder className="inline w-3 h-3 mr-1 opacity-50" />
                    {p.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ))}
    </div>
  );
}

function IngestJobsPanel({ namespace }: { namespace: WikiNamespace }) {
  const { data, isLoading } = useIngestJobs(namespace);
  const retry = useRetryIngestJob();
  const failed = (data?.jobs || []).filter(j => j.status === 'failed');
  const running = (data?.jobs || []).filter(j => j.status !== 'done' && j.status !== 'failed');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Recent ingest jobs</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> :
          (data?.jobs.length === 0 ? <div className="text-sm text-muted-foreground">No recent jobs.</div> :
            <div className="space-y-2">
              {[...running, ...failed].slice(0, 10).map(j => (
                <div key={j.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {j.status === 'failed' ? <AlertCircle className="w-4 h-4 text-red-500" /> :
                      j.status === 'done' ? null : <Loader2 className="w-4 h-4 animate-spin" />}
                    <span className="font-mono text-xs">{j.source_kind}/{j.source_id.slice(0, 12)}</span>
                    <Badge variant={j.status === 'failed' ? 'danger' : 'secondary'}>{j.status}</Badge>
                    {j.parser && <span className="text-xs text-muted-foreground">parser: {j.parser}</span>}
                  </div>
                  {j.status === 'failed' && (
                    <Button size="sm" variant="outline" onClick={() => retry.mutate(j.id, { onSuccess: () => toast({ title: 'Retry queued' }) })}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Retry
                    </Button>
                  )}
                </div>
              ))}
            </div>)}
      </CardContent>
    </Card>
  );
}

function ParserKeysPanel() {
  const { data } = useParserKeys();
  const setKeys = useSetParserKeys();
  const [reducto, setReducto] = useState('');
  const [llama, setLlama] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><SettingsIcon className="w-4 h-4" /> Parser keys (workspace-wide; shared with Documents)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Optional. Without a key the wiki uses local parsers — text, native PDFs, Word, Excel, CSV, email all work locally.
          For OCR (scanned PDFs, images, legacy Office, eBooks) configure one of these.
        </div>
        <div className="space-y-2">
          <Label>Reducto API key {data?.reducto && <Badge variant="secondary">configured</Badge>}</Label>
          <Input type="password" value={reducto} onChange={(e) => setReducto(e.target.value)} placeholder={data?.reducto ? '••••••••' : 'sk-...'} />
        </div>
        <div className="space-y-2">
          <Label>LlamaParse API key {data?.llamaparse && <Badge variant="secondary">configured</Badge>}</Label>
          <Input type="password" value={llama} onChange={(e) => setLlama(e.target.value)} placeholder={data?.llamaparse ? '••••••••' : 'llx-...'} />
        </div>
        <div>
          <Button
            disabled={!reducto && !llama}
            onClick={() =>
              setKeys.mutate(
                { reductoApiKey: reducto || undefined, llamaParseApiKey: llama || undefined },
                {
                  onSuccess: () => { toast({ title: 'Parser keys saved' }); setReducto(''); setLlama(''); },
                  onError: (err: any) => toast({ title: 'Save failed', description: err.message }),
                },
              )}
          >Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SchemaEditor({ namespace }: { namespace: WikiNamespace }) {
  const { data: schema } = useWikiPage(namespace, 'schema.md');
  const update = useUpdateWikiSchema();
  const [content, setContent] = useState<string | null>(null);
  const value = content ?? schema?.content ?? '';
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Schema (governs page kinds & ingest workflow)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={12} value={value} onChange={(e) => setContent(e.target.value)} />
        <Button
          disabled={content == null || content === schema?.content}
          onClick={() => content && update.mutate({ namespace, content }, { onSuccess: () => { toast({ title: 'Schema updated' }); setContent(null); } })}
        >Save schema</Button>
      </CardContent>
    </Card>
  );
}

function ModePanel({ namespace }: { namespace: WikiNamespace }) {
  const { data: mode } = useWikiMode();
  const setMode = useSetWikiMode();
  const current = (mode?.[namespace] || 'wiki') as 'wiki' | 'search' | 'both';
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{namespace === 'kb' ? 'KB' : 'Documents'} mode</CardTitle></CardHeader>
      <CardContent className="flex gap-2">
        {(['wiki', 'search', 'both'] as const).map(m => (
          <Button
            key={m}
            variant={current === m ? 'default' : 'outline'}
            onClick={() => setMode.mutate({ namespace, mode: m }, { onSuccess: () => toast({ title: `Mode set to ${m}` }) })}
          >{m}</Button>
        ))}
      </CardContent>
    </Card>
  );
}

function BackfillPanel({ namespace }: { namespace: WikiNamespace }) {
  const { data } = useBackfills();
  const start = useStartBackfill();
  const control = useControlBackfill();
  const active = (data?.backfills || []).find(b => b.namespace === namespace && ['pending', 'running', 'paused'].includes(b.status));
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Migrate to wiki</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {active ? (
          <div className="space-y-2 text-sm">
            <div>Status: <Badge>{active.status}</Badge> — {active.enqueued}/{active.total} enqueued ({active.failed} failed)</div>
            <div className="flex gap-2">
              {active.status === 'running' && <Button size="sm" variant="outline" onClick={() => control.mutate({ id: active.id, action: 'pause' })}>Pause</Button>}
              {active.status === 'paused' && <Button size="sm" variant="outline" onClick={() => control.mutate({ id: active.id, action: 'resume' })}>Resume</Button>}
              <Button size="sm" variant="danger" onClick={() => control.mutate({ id: active.id, action: 'cancel' })}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => start.mutate({ namespace, ratePerMinute: 60 }, { onSuccess: () => toast({ title: 'Backfill started' }) })}>
            Start backfill ({namespace} → wiki, 60/min)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
