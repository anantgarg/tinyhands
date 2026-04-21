import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Copy, Loader2, Shield, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/store/auth';
import {
  useOAuthAppStatus,
  useSaveOAuthApp,
  useDeleteOAuthApp,
  useTestOAuthApp,
  type OAuthPublishingStatus,
} from '@/api/workspace-oauth-apps';

const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
const CLIENT_SECRET_PATTERN = /^GOCSPX-[A-Za-z0-9_-]{20,}$/;

/**
 * Standalone page at /settings/integrations/google. Kept as a compatibility
 * alias — the primary surface now lives inside Apps → Team tab. Bookmarks
 * and docs that point here keep working.
 */
export function GoogleOAuthAppSettings() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Shield className="h-12 w-12 text-warm-text-secondary mb-4" />
        <h2 className="text-lg font-bold">Admin Access Required</h2>
        <p className="text-warm-text-secondary mt-2">You need admin permissions to manage integrations.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-4">
        <Link
          to="/tools"
          className="inline-flex items-center gap-1.5 text-sm text-warm-text-secondary hover:text-warm-text"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Tools
        </Link>
      </div>
      <PageHeader
        title="Google connection app"
        description="Your workspace's own Google app powers every Google Drive, Gmail, Sheets, and Docs connection here. Setting this up once lets everyone connect their own Google account without TinyHands ever touching your tokens."
      />
      <GoogleOAuthAppContent />
    </div>
  );
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast({ title: 'Copied', variant: 'success' }),
    () => toast({ title: 'Copy failed', variant: 'error' }),
  );
}

export function GoogleOAuthAppContent() {
  const { data: status, isLoading } = useOAuthAppStatus('google');
  const save = useSaveOAuthApp('google');
  const remove = useDeleteOAuthApp('google');
  const test = useTestOAuthApp('google');

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [publishingStatus, setPublishingStatus] = useState<OAuthPublishingStatus>('internal');
  const [isReplacing, setIsReplacing] = useState(false);

  const clientIdInvalid = clientId !== '' && !CLIENT_ID_PATTERN.test(clientId);
  const clientSecretInvalid = clientSecret !== '' && !CLIENT_SECRET_PATTERN.test(clientSecret);
  const formReady = CLIENT_ID_PATTERN.test(clientId) && CLIENT_SECRET_PATTERN.test(clientSecret);

  const handleSave = async () => {
    try {
      await save.mutateAsync({ clientId, clientSecret, publishingStatus });
      setClientId('');
      setClientSecret('');
      setIsReplacing(false);
      toast({ title: 'Google connection app saved', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'error' });
    }
  };

  const handleTestSaved = async () => {
    try {
      const result = await test.mutateAsync();
      if (result.ok) {
        toast({ title: 'Looks good', description: 'Google accepted the connection app.', variant: 'success' });
      } else {
        toast({
          title: 'Test failed',
          description: result.reason || 'Google rejected the request.',
          variant: 'error',
        });
      }
    } catch (err: any) {
      toast({ title: 'Test failed', description: err.message, variant: 'error' });
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove the Google connection app? Everyone\'s Google connections will stop working until a new one is set up.')) return;
    try {
      await remove.mutateAsync();
      toast({ title: 'Removed', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Remove failed', description: err.message, variant: 'error' });
    }
  };

  if (isLoading || !status) {
    return (
      <div>
        <PageHeader title="Google connection app" />
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  const showForm = !status.configured || isReplacing;

  return (
    <div>
      <SetupWizard redirectUri={status.redirectUri} />

      {status.configured && !isReplacing && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Current configuration</CardTitle>
                <CardDescription>
                  Saved {new Date(status.updatedAt || status.configuredAt || Date.now()).toLocaleString()}
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Active
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Client ID</Label>
              <div className="mt-1 font-mono text-sm">{status.clientIdMasked}</div>
            </div>
            {status.publishingStatus && (
              <div>
                <Label>Publishing mode</Label>
                <div className="mt-1 text-sm">{labelForPublishingStatus(status.publishingStatus)}</div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={handleTestSaved} disabled={test.isPending}>
                {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Test connection
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsReplacing(true)}>
                Replace credentials
              </Button>
              <Button size="sm" variant="outline" onClick={handleRemove} disabled={remove.isPending}>
                {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                Remove
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              {status.configured ? 'Replace credentials' : 'Paste your Google app credentials'}
            </CardTitle>
            <CardDescription>
              From your Google Cloud OAuth client.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Client ID</Label>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="123456789-abc123.apps.googleusercontent.com"
                className="mt-1 font-mono text-sm"
                autoComplete="off"
              />
              {clientIdInvalid && (
                <p className="text-xs mt-1 text-red-600 dark:text-red-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Expected format: <span className="font-mono">NNN-xxx.apps.googleusercontent.com</span>
                </p>
              )}
            </div>
            <div>
              <Label>Client Secret</Label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-..."
                className="mt-1 font-mono text-sm"
                autoComplete="off"
              />
              {clientSecretInvalid && (
                <p className="text-xs mt-1 text-red-600 dark:text-red-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Expected format: starts with <span className="font-mono">GOCSPX-</span>
                </p>
              )}
            </div>
            <div>
              <Label>Publishing mode</Label>
              <Select
                value={publishingStatus}
                onValueChange={(v) => setPublishingStatus(v as OAuthPublishingStatus)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal — only your Google Workspace (recommended)</SelectItem>
                  <SelectItem value="external_testing">External, Testing — up to 100 users, no audit</SelectItem>
                  <SelectItem value="external_production">External, Production — requires Google verification</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-warm-text-secondary mt-1">
                Internal skips Google verification entirely and has no user cap — strongly recommended if everyone using TinyHands is on your Google Workspace.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={!formReady || save.isPending}>
                {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Save
              </Button>
              {isReplacing && (
                <Button variant="outline" onClick={() => { setIsReplacing(false); setClientId(''); setClientSecret(''); }}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

function labelForPublishingStatus(s: OAuthPublishingStatus): string {
  switch (s) {
    case 'internal': return 'Internal (Workspace-scoped)';
    case 'external_testing': return 'External — Testing';
    case 'external_production': return 'External — Production';
  }
}

interface WizardStep {
  title: string;
  render: (ctx: { redirectUri: string }) => JSX.Element;
  link?: { label: string; href: string };
}

const WIZARD_STEPS: WizardStep[] = [
  {
    title: '1. Create a Google Cloud project',
    render: () => (
      <p className="text-warm-text-secondary">
        Open Google Cloud Console and create a new project (or reuse one). This is where your OAuth client will live.
      </p>
    ),
    link: { label: 'Open Google Cloud Console', href: 'https://console.cloud.google.com/projectcreate' },
  },
  {
    title: '2. Enable the APIs you need',
    render: () => (
      <p className="text-warm-text-secondary">
        Enable Google Drive, Google Sheets, Google Docs, and Gmail APIs (any you plan to use). You enable APIs from the APIs &amp; Services library.
      </p>
    ),
    link: { label: 'Open API Library', href: 'https://console.cloud.google.com/apis/library' },
  },
  {
    title: '3. Set up the OAuth consent screen',
    render: () => (
      <p className="text-warm-text-secondary">
        Choose <strong>Internal</strong> if everyone using TinyHands is on your Google Workspace — this skips Google verification and has no user cap. Add your workspace email as the support contact.
      </p>
    ),
    link: { label: 'OAuth consent screen', href: 'https://console.cloud.google.com/apis/credentials/consent' },
  },
  {
    title: '4. Create an OAuth 2.0 Client ID',
    render: ({ redirectUri }) => (
      <div className="space-y-3">
        <p className="text-warm-text-secondary">
          Application type: <strong>Web application</strong>. Under <em>Authorized redirect URIs</em>, add the URI below exactly as shown.
        </p>
        <div className="flex items-center gap-2">
          <code className="font-mono text-xs flex-1 bg-warm-bg-elevated px-3 py-2 rounded border border-warm-border break-all">
            {redirectUri}
          </code>
          <Button size="sm" variant="outline" onClick={() => copyText(redirectUri)}>
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copy
          </Button>
        </div>
        <p className="text-warm-text-secondary">
          Save the OAuth client, then copy the generated <strong>Client ID</strong> and <strong>Client Secret</strong> — you'll paste them below.
        </p>
      </div>
    ),
    link: { label: 'Credentials page', href: 'https://console.cloud.google.com/apis/credentials' },
  },
  {
    title: '5. Paste credentials below',
    render: () => (
      <p className="text-warm-text-secondary">
        Paste the Client ID and Client Secret into the form below, click <strong>Save</strong>, then <strong>Test connection</strong> to verify.
      </p>
    ),
  },
];

const WIZARD_COLLAPSED_KEY = 'tinyhands.setupWizard.google.collapsed';

function SetupWizard({ redirectUri }: { redirectUri: string }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(WIZARD_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(WIZARD_COLLAPSED_KEY, '1');
        else localStorage.removeItem(WIZARD_COLLAPSED_KEY);
      } catch {}
      return next;
    });
  };

  return (
    <Card className="mb-6">
      <CardHeader className={collapsed ? 'pb-6' : undefined}>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">Setup walkthrough</CardTitle>
            <CardDescription>
              First time setting this up? Follow these steps. ~20–40 minutes.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            aria-label={collapsed ? 'Expand setup walkthrough' : 'Collapse setup walkthrough'}
            aria-expanded={!collapsed}
            className="h-8 w-8 p-0"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent>
          <div className="space-y-2">
            {WIZARD_STEPS.map((step, i) => {
              const isOpen = openIdx === i;
              return (
                <div
                  key={step.title}
                  className="border border-warm-border rounded overflow-hidden"
                >
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-warm-bg-elevated flex items-center justify-between text-sm font-medium"
                    onClick={() => setOpenIdx(isOpen ? null : i)}
                  >
                    {step.title}
                    <span className="text-xs text-warm-text-secondary">{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 py-3 border-t border-warm-border bg-warm-bg-elevated/50 text-sm">
                      {step.render({ redirectUri })}
                      {step.link && (
                        <a
                          href={step.link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-2 text-brand underline text-xs"
                        >
                          {step.link.label} →
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
