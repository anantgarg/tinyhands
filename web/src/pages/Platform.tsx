import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';

interface WorkspaceHealth {
  workspace_id: string;
  team_name: string;
  workspace_slug: string;
  status: string;
  installed_at: string;
  runs_24h: number;
  error_rate_24h: number;
  anthropic_key_configured: boolean;
}

export function Platform() {
  const { user, isPlatformAdmin } = useAuthStore();
  const [workspaces, setWorkspaces] = useState<WorkspaceHealth[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/platform/workspaces', { credentials: 'include' })
      .then(async (r) => {
        if (r.status === 403) throw new Error('Platform admin access required');
        if (!r.ok) throw new Error('Failed to load workspaces');
        const d = await r.json();
        setWorkspaces(d.workspaces || []);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (!user) return null;
  if (!isPlatformAdmin()) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold">Platform admin</h1>
        <p className="mt-2 text-warm-text-secondary">Only platform admins can access this page.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">Platform health</h1>
      <p className="mt-1 text-warm-text-secondary">Per-workspace health. No access to workspace data beyond counts.</p>

      {error && <p className="mt-4 text-red-600">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-warm-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-warm-bg text-left text-warm-text-secondary">
            <tr>
              <th className="px-4 py-2">Workspace</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Runs (24h)</th>
              <th className="px-4 py-2">Error rate</th>
              <th className="px-4 py-2">Claude key</th>
              <th className="px-4 py-2">Installed</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((ws) => (
              <tr key={ws.workspace_id} className="border-t border-warm-border">
                <td className="px-4 py-2">
                  <div className="font-medium">{ws.team_name}</div>
                  <div className="text-xs text-warm-text-secondary">{ws.workspace_slug}</div>
                </td>
                <td className="px-4 py-2 capitalize">{ws.status}</td>
                <td className="px-4 py-2">{ws.runs_24h}</td>
                <td className="px-4 py-2">{ws.runs_24h > 0 ? `${Math.round(ws.error_rate_24h * 100)}%` : '—'}</td>
                <td className="px-4 py-2">{ws.anthropic_key_configured ? 'Configured' : 'Missing'}</td>
                <td className="px-4 py-2">{new Date(ws.installed_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {workspaces.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-warm-text-secondary">No workspaces yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
