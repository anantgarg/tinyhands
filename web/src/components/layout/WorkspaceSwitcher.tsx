import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Workspace {
  workspace_id: string;
  workspace_slug: string;
  team_name: string;
  role: 'admin' | 'member';
}

async function fetchWorkspaces(): Promise<{ workspaces: Workspace[]; activeWorkspaceId: string }> {
  const res = await fetch('/api/v1/auth/workspaces', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch workspaces');
  return res.json();
}

async function switchWorkspace(workspaceId: string): Promise<void> {
  const res = await fetch('/api/v1/auth/switch-workspace', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  });
  if (!res.ok) throw new Error('Failed to switch workspace');
}

export function WorkspaceSwitcher() {
  const { user } = useAuthStore();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchWorkspaces().then((d) => setWorkspaces(d.workspaces)).catch(() => setWorkspaces([]));
  }, []);

  // Hide the switcher for users with only one workspace — keeps UI simple
  // for the most common case.
  if (!user || workspaces.length <= 1) {
    return null;
  }

  const current = workspaces.find((w) => w.workspace_id === user.workspaceId);
  const label = current?.team_name || 'Workspace';

  const handleSwitch = async (workspaceId: string) => {
    if (workspaceId === user.workspaceId) {
      setOpen(false);
      return;
    }
    try {
      await switchWorkspace(workspaceId);
      // Reload the page so all workspace-scoped data is refetched cleanly
      window.location.reload();
    } catch {
      setOpen(false);
    }
  };

  return (
    <div className="relative px-3 py-2 border-b border-warm-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm text-warm-text hover:bg-warm-bg transition-colors"
      >
        <span className="truncate font-medium">{label}</span>
        <ChevronDown className={cn('h-4 w-4 text-warm-text-secondary transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-3 right-3 z-30 mt-1 rounded-md border border-warm-border bg-white shadow-lg">
          {workspaces.map((ws) => (
            <button
              key={ws.workspace_id}
              onClick={() => handleSwitch(ws.workspace_id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-warm-bg"
            >
              <div className="flex flex-col min-w-0">
                <span className="truncate font-medium">{ws.team_name}</span>
                <span className="text-xs text-warm-text-secondary capitalize">{ws.role}</span>
              </div>
              {ws.workspace_id === user.workspaceId && <Check className="h-4 w-4 text-brand shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
