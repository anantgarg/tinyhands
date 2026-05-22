import { useState } from 'react';
import {
  MessageSquare,
  Phone,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  MoreVertical,
  Trash2,
  Pencil,
  AlertCircle,
  ExternalLink,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWebChats, useCreateWebChat, useUpdateWebChat, useDeleteWebChat, type WebChat } from '@/api/web-chat';
import {
  useWhatsAppChannels,
  useCreateWhatsAppChannel,
  useUpdateWhatsAppChannel,
  useDeleteWhatsAppChannel,
  type WhatsAppChannel,
} from '@/api/whatsapp';
import { useAgents } from '@/api/agents';
import { toast } from '@/components/ui/use-toast';

function chatUrl(token: string): string {
  return `${window.location.origin}/chat/${token}`;
}

function whatsappWebhookUrl(): string {
  return `${window.location.origin}/webhooks/twilio/whatsapp`;
}

function modelLabel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('haiku')) return 'Haiku';
  if (m.includes('sonnet')) return 'Sonnet';
  return model;
}

/** A phone number is valid once it carries a country code: '+' then 8–15 digits. */
function isValidPhone(raw: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(raw.replace(/[\s\-().]/g, ''));
}

// ── Web Chat form ──

interface WebChatFormState {
  name: string;
  agentId: string;
  username: string;
  password: string;
}

const emptyWebChatForm: WebChatFormState = { name: '', agentId: '', username: '', password: '' };

// ── WhatsApp form ──

interface AllowedRow {
  number: string;
  label: string;
}

interface WhatsAppFormState {
  name: string;
  agentId: string;
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
  allowed: AllowedRow[];
}

const emptyWhatsAppForm: WhatsAppFormState = {
  name: '',
  agentId: '',
  accountSid: '',
  authToken: '',
  whatsappNumber: '',
  allowed: [{ number: '', label: '' }],
};

export function Channels() {
  const { data: webChats, isLoading, isError } = useWebChats();
  const { data: whatsappChannels, isLoading: waLoading, isError: waError } = useWhatsAppChannels();
  const { data: agents } = useAgents();
  const createWebChat = useCreateWebChat();
  const updateWebChat = useUpdateWebChat();
  const deleteWebChat = useDeleteWebChat();
  const createWhatsApp = useCreateWhatsAppChannel();
  const updateWhatsApp = useUpdateWhatsAppChannel();
  const deleteWhatsApp = useDeleteWhatsAppChannel();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WebChat | null>(null);
  const [form, setForm] = useState<WebChatFormState>(emptyWebChatForm);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const [waDialogOpen, setWaDialogOpen] = useState(false);
  const [waEditing, setWaEditing] = useState<WhatsAppChannel | null>(null);
  const [waForm, setWaForm] = useState<WhatsAppFormState>(emptyWhatsAppForm);
  const [webhookCopied, setWebhookCopied] = useState(false);

  // ── Web Chat handlers ──

  const openCreate = () => {
    setEditing(null);
    setForm(emptyWebChatForm);
    setDialogOpen(true);
  };

  const openEdit = (chat: WebChat) => {
    setEditing(chat);
    setForm({ name: chat.name, agentId: chat.agentId, username: chat.username, password: '' });
    setDialogOpen(true);
  };

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(chatUrl(token));
    setCopied(token);
    setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.agentId || !form.username.trim()) {
      toast({ title: 'Please fill in the name, agent and username.', variant: 'error' });
      return;
    }
    try {
      if (editing) {
        await updateWebChat.mutateAsync({
          id: editing.id,
          name: form.name.trim(),
          agentId: form.agentId,
          username: form.username.trim(),
          password: form.password ? form.password : undefined,
        });
        toast({ title: 'Web chat updated' });
      } else {
        if (!form.password.trim()) {
          toast({ title: 'Please set a password.', variant: 'error' });
          return;
        }
        await createWebChat.mutateAsync({
          name: form.name.trim(),
          agentId: form.agentId,
          username: form.username.trim(),
          password: form.password,
        });
        toast({ title: 'Web chat created' });
      }
      setDialogOpen(false);
    } catch (err: any) {
      toast({ title: err?.message ?? 'Could not save web chat', variant: 'error' });
    }
  };

  const handleToggle = async (chat: WebChat, enabled: boolean) => {
    try {
      await updateWebChat.mutateAsync({ id: chat.id, enabled });
    } catch (err: any) {
      toast({ title: err?.message ?? 'Could not update web chat', variant: 'error' });
    }
  };

  const handleDelete = async (chat: WebChat) => {
    if (!window.confirm(`Delete the web chat "${chat.name}"? Its link will stop working immediately.`)) return;
    try {
      await deleteWebChat.mutateAsync(chat.id);
      toast({ title: 'Web chat deleted' });
    } catch (err: any) {
      toast({ title: err?.message ?? 'Could not delete web chat', variant: 'error' });
    }
  };

  // ── WhatsApp handlers ──

  const openWaCreate = () => {
    setWaEditing(null);
    setWaForm({ ...emptyWhatsAppForm, allowed: [{ number: '', label: '' }] });
    setWaDialogOpen(true);
  };

  const openWaEdit = (channel: WhatsAppChannel) => {
    setWaEditing(channel);
    setWaForm({
      name: channel.name,
      agentId: channel.agentId,
      accountSid: '',
      authToken: '',
      whatsappNumber: channel.whatsappNumber,
      allowed:
        channel.allowedNumbers.length > 0
          ? channel.allowedNumbers.map((a) => ({ number: a.number, label: a.label ?? '' }))
          : [{ number: '', label: '' }],
    });
    setWaDialogOpen(true);
  };

  const setAllowedRow = (idx: number, patch: Partial<AllowedRow>) => {
    setWaForm((f) => ({
      ...f,
      allowed: f.allowed.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  };

  const addAllowedRow = () => {
    setWaForm((f) => ({ ...f, allowed: [...f.allowed, { number: '', label: '' }] }));
  };

  const removeAllowedRow = (idx: number) => {
    setWaForm((f) => ({
      ...f,
      allowed: f.allowed.length > 1 ? f.allowed.filter((_, i) => i !== idx) : f.allowed,
    }));
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(whatsappWebhookUrl());
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  };

  const handleWaSave = async () => {
    if (!waForm.name.trim() || !waForm.agentId || !waForm.whatsappNumber.trim()) {
      toast({ title: 'Please fill in the name, agent and WhatsApp number.', variant: 'error' });
      return;
    }
    if (!isValidPhone(waForm.whatsappNumber)) {
      toast({ title: 'Enter the WhatsApp number with its country code, e.g. +14155550123.', variant: 'error' });
      return;
    }
    const allowed = waForm.allowed.filter((r) => r.number.trim() !== '');
    for (const row of allowed) {
      if (!isValidPhone(row.number)) {
        toast({ title: `"${row.number}" needs a country code, e.g. +14155550123.`, variant: 'error' });
        return;
      }
    }
    const allowedNumbers = allowed.map((r) => ({ number: r.number.trim(), label: r.label.trim() || null }));
    try {
      if (waEditing) {
        await updateWhatsApp.mutateAsync({
          id: waEditing.id,
          name: waForm.name.trim(),
          agentId: waForm.agentId,
          accountSid: waForm.accountSid.trim() || undefined,
          authToken: waForm.authToken.trim() || undefined,
          whatsappNumber: waForm.whatsappNumber.trim(),
          allowedNumbers,
        });
        toast({ title: 'WhatsApp number updated' });
      } else {
        if (!waForm.accountSid.trim() || !waForm.authToken.trim()) {
          toast({ title: 'Enter the Twilio Account SID and auth token.', variant: 'error' });
          return;
        }
        await createWhatsApp.mutateAsync({
          name: waForm.name.trim(),
          agentId: waForm.agentId,
          accountSid: waForm.accountSid.trim(),
          authToken: waForm.authToken.trim(),
          whatsappNumber: waForm.whatsappNumber.trim(),
          allowedNumbers,
        });
        toast({ title: 'WhatsApp number added' });
      }
      setWaDialogOpen(false);
    } catch (err: any) {
      toast({ title: err?.message ?? 'Could not save WhatsApp number', variant: 'error' });
    }
  };

  const handleWaToggle = async (channel: WhatsAppChannel, enabled: boolean) => {
    try {
      await updateWhatsApp.mutateAsync({ id: channel.id, enabled });
    } catch (err: any) {
      toast({ title: err?.message ?? 'Could not update WhatsApp number', variant: 'error' });
    }
  };

  const handleWaDelete = async (channel: WhatsAppChannel) => {
    if (!window.confirm(`Delete the WhatsApp number "${channel.name}"? It will stop responding immediately.`))
      return;
    try {
      await deleteWhatsApp.mutateAsync(channel.id);
      toast({ title: 'WhatsApp number deleted' });
    } catch (err: any) {
      toast({ title: err?.message ?? 'Could not delete WhatsApp number', variant: 'error' });
    }
  };

  return (
    <div>
      <PageHeader title="Channels" description="Ways people can reach your agents outside Slack" />

      {/* ── Web Chat ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-brand" />
              <div>
                <CardTitle className="text-base">Web Chat</CardTitle>
                <CardDescription>
                  Share a link to chat with an agent in a browser — protected by a username and password,
                  no Slack sign-in needed.
                </CardDescription>
              </div>
            </div>
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              New web chat
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[200px]" />
          ) : isError ? (
            <div className="py-8 text-center text-red-500">
              <AlertCircle className="h-5 w-5 mx-auto mb-2" />
              Could not load web chats.
            </div>
          ) : !webChats || webChats.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No web chats yet"
              description="Create a web chat to share an agent as a password-protected link."
              action={{ label: 'New web chat', onClick: openCreate }}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Link</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Password</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webChats.map((chat) => (
                    <TableRow key={chat.id}>
                      <TableCell className="font-medium">{chat.name}</TableCell>
                      <TableCell>
                        <span>{chat.agentName}</span>
                        {chat.agentModel && (
                          <span className="ml-1.5 text-xs text-warm-text-secondary">
                            ({modelLabel(chat.agentModel)})
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <a
                            href={chatUrl(chat.publicToken)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                          <button
                            type="button"
                            onClick={() => handleCopy(chat.publicToken)}
                            className="text-warm-text-secondary hover:text-warm-text"
                            title="Copy link"
                          >
                            {copied === chat.publicToken ? (
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{chat.username}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-mono">
                            {revealed[chat.id] ? chat.password : '••••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setRevealed((r) => ({ ...r, [chat.id]: !r[chat.id] }))}
                            className="text-warm-text-secondary hover:text-warm-text"
                            title={revealed[chat.id] ? 'Hide password' : 'Show password'}
                          >
                            {revealed[chat.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={chat.enabled}
                            onCheckedChange={(v) => handleToggle(chat, v)}
                          />
                          <Badge variant={chat.enabled ? 'success' : 'secondary'}>
                            {chat.enabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(chat)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => handleDelete(chat)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── WhatsApp ── */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-brand" />
              <div>
                <CardTitle className="text-base">WhatsApp</CardTitle>
                <CardDescription>
                  Let people message an agent on WhatsApp through Twilio. Only the phone numbers you
                  add to the allow list can reach it.
                </CardDescription>
              </div>
            </div>
            <Button onClick={openWaCreate} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              New WhatsApp number
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {waLoading ? (
            <Skeleton className="h-[200px]" />
          ) : waError ? (
            <div className="py-8 text-center text-red-500">
              <AlertCircle className="h-5 w-5 mx-auto mb-2" />
              Could not load WhatsApp numbers.
            </div>
          ) : !whatsappChannels || whatsappChannels.length === 0 ? (
            <EmptyState
              icon={Phone}
              title="No WhatsApp numbers yet"
              description="Connect a Twilio WhatsApp number to let people message an agent."
              action={{ label: 'New WhatsApp number', onClick: openWaCreate }}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>WhatsApp number</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Allowed numbers</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {whatsappChannels.map((channel) => (
                    <TableRow key={channel.id}>
                      <TableCell className="font-medium">{channel.name}</TableCell>
                      <TableCell className="text-sm font-mono">{channel.whatsappNumber}</TableCell>
                      <TableCell>
                        <span>{channel.agentName}</span>
                        {channel.agentModel && (
                          <span className="ml-1.5 text-xs text-warm-text-secondary">
                            ({modelLabel(channel.agentModel)})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {channel.allowedCount} {channel.allowedCount === 1 ? 'number' : 'numbers'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={channel.enabled}
                            onCheckedChange={(v) => handleWaToggle(channel, v)}
                          />
                          <Badge variant={channel.enabled ? 'success' : 'secondary'}>
                            {channel.enabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openWaEdit(channel)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => handleWaDelete(channel)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Web Chat dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit web chat' : 'New web chat'}</DialogTitle>
            <DialogDescription>
              Pick an agent and set the username and password people will use to open the chat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Customer Support Chat"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Agent</Label>
              <Select value={form.agentId} onValueChange={(v) => setForm((f) => ({ ...f, agentId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.avatarEmoji ?? ''} {a.name ?? 'Unnamed'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Username</Label>
              <Input
                className="mt-1"
                placeholder="Username visitors will enter"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                className="mt-1"
                type="text"
                placeholder={editing ? 'Leave blank to keep the current password' : 'Password visitors will enter'}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createWebChat.isPending || updateWebChat.isPending}>
              {editing ? 'Save changes' : 'Create web chat'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── WhatsApp dialog ── */}
      <Dialog open={waDialogOpen} onOpenChange={setWaDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{waEditing ? 'Edit WhatsApp number' : 'New WhatsApp number'}</DialogTitle>
            <DialogDescription>
              Connect a Twilio WhatsApp number to an agent, and list the phone numbers allowed to message it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Customer Support WhatsApp"
                value={waForm.name}
                onChange={(e) => setWaForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Agent</Label>
              <Select value={waForm.agentId} onValueChange={(v) => setWaForm((f) => ({ ...f, agentId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.avatarEmoji ?? ''} {a.name ?? 'Unnamed'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border border-warm-border p-3 space-y-3">
              <p className="text-sm font-medium">Connection details</p>
              <div>
                <Label>Twilio Account SID</Label>
                <Input
                  className="mt-1"
                  placeholder={waEditing ? waEditing.accountSidMasked || 'Leave blank to keep current' : 'AC…'}
                  value={waForm.accountSid}
                  onChange={(e) => setWaForm((f) => ({ ...f, accountSid: e.target.value }))}
                />
              </div>
              <div>
                <Label>Twilio auth token</Label>
                <Input
                  className="mt-1"
                  type="password"
                  placeholder={
                    waEditing && waEditing.authTokenConfigured
                      ? 'Leave blank to keep current token'
                      : 'Your Twilio auth token'
                  }
                  value={waForm.authToken}
                  onChange={(e) => setWaForm((f) => ({ ...f, authToken: e.target.value }))}
                />
              </div>
              <div>
                <Label>WhatsApp number</Label>
                <Input
                  className="mt-1"
                  placeholder="+14155550123"
                  value={waForm.whatsappNumber}
                  onChange={(e) => setWaForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
                />
                <p className="mt-1 text-xs text-warm-text-secondary">
                  Include the country code, e.g. +1 for the US, +44 for the UK, +91 for India.
                </p>
              </div>
            </div>

            <div className="rounded-md border border-warm-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Allowed phone numbers</p>
                <Button type="button" variant="outline" size="sm" onClick={addAllowedRow}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add number
                </Button>
              </div>
              <p className="text-xs text-warm-text-secondary">
                Only these numbers can message the agent. Add as many as you need — always include the
                country code.
              </p>
              {waForm.allowed.map((row, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <Input
                    placeholder="+14155550123"
                    value={row.number}
                    onChange={(e) => setAllowedRow(idx, { number: e.target.value })}
                  />
                  <Input
                    placeholder="Name (optional)"
                    value={row.label}
                    onChange={(e) => setAllowedRow(idx, { label: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => removeAllowedRow(idx)}
                    title="Remove"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="rounded-md bg-warm-bg-subtle p-3">
              <p className="text-xs text-warm-text-secondary">
                In Twilio, paste this address into your WhatsApp number's incoming-message webhook:
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <code className="text-xs break-all">{whatsappWebhookUrl()}</code>
                <button
                  type="button"
                  onClick={copyWebhookUrl}
                  className="shrink-0 text-warm-text-secondary hover:text-warm-text"
                  title="Copy webhook address"
                >
                  {webhookCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleWaSave} disabled={createWhatsApp.isPending || updateWhatsApp.isPending}>
              {waEditing ? 'Save changes' : 'Add WhatsApp number'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
