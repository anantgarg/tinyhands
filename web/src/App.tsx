import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth';
import { Shell } from '@/components/layout/Shell';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { checkAuth } = useAuth();
  const { user, isLoading } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-warm-bg">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-32 mx-auto" />
          <Skeleton className="h-4 w-48 mx-auto" />
          <Skeleton className="h-4 w-40 mx-auto" />
        </div>
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
                  <Shell />
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
