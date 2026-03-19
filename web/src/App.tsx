import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { Shell } from '@/components/layout/Shell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Agents } from '@/pages/Agents';
import { AgentDetail } from '@/pages/AgentDetail';
import { AgentCreate } from '@/pages/AgentCreate';
import { AgentTemplates } from '@/pages/AgentTemplates';
import { Tools } from '@/pages/Tools';
import { KnowledgeBase } from '@/pages/KnowledgeBase';
import { KBSources } from '@/pages/KBSources';
import { Connections } from '@/pages/Connections';
import { Triggers } from '@/pages/Triggers';
import { Workflows } from '@/pages/Workflows';
import { Evolution } from '@/pages/Evolution';
import { AuditLog } from '@/pages/AuditLog';
import { AccessRoles } from '@/pages/AccessRoles';
import { Settings } from '@/pages/Settings';
import { Requests } from '@/pages/Requests';
import { ErrorLogs } from '@/pages/ErrorLogs';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, setUser, clearUser } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/auth/me', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data);
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearUser();
          setChecking(false);
        }
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-warm-bg">
        <p className="text-warm-text-secondary">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <Shell />
                  </ErrorBoundary>
                </RequireAuth>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="agents" element={<Agents />} />
              <Route path="agents/new" element={<AgentCreate />} />
              <Route path="agents/templates" element={<AgentTemplates />} />
              <Route path="agents/:id" element={<AgentDetail />} />
              <Route path="tools" element={<Tools />} />
              <Route path="kb" element={<KnowledgeBase />} />
              <Route path="kb/sources" element={<KBSources />} />
              <Route path="connections" element={<Connections />} />
              <Route path="triggers" element={<Triggers />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="requests" element={<Requests />} />
              <Route path="errors" element={<ErrorLogs />} />
              <Route path="evolution" element={<Evolution />} />
              <Route path="audit" element={<AuditLog />} />
              <Route path="access" element={<AccessRoles />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
