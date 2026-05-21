import { useState } from 'react';
import { MessageSquare, Plus, Copy, Check, Eye, EyeOff, MoreVertical, Trash2, Pencil, AlertCircle, ExternalLink } from 'lucide-react';
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
import { useAgents } from '@/api/agents';
import { toast } from '@/components/ui/use-toast';

function chatUrl(token: string): string {
  return `${window.location.origin}/chat/${token}`;
}

function modelLabel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('haiku')) return 'Haiku';
  if (m.includes('sonnet')) return 'Sonnet';
  return model;
}

interface FormState {
  name: string;
  agentId: string;
  username: string;
  password: string;
}

const emptyForm: FormState = { name: '', agentId: '', username: '', password: '' };

export function Channels() {
  const { data: webChats, isLoading, isError } = useWebChats();
  const { data: agents } = useAgents();
  const createWebChat = useCreateWebChat();
  const updateWebChat = useUpdateWebChat();
  const deleteWebChat = useDeleteWebChat();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WebChat | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
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

  return (
    <div>
      <PageHeader title="Channels" description="Ways people can reach your agents outside Slack">
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New web chat
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
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
    </div>
  );
}
