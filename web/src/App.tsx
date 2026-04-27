import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { Shell } from '@/components/layout/Shell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

// Lazy-load all pages for code splitting
const Login = lazy(() => import('@/pages/Login').then(m => ({ default: m.Login })));
const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Agents = lazy(() => import('@/pages/Agents').then(m => ({ default: m.Agents })));
const AgentDetail = lazy(() => import('@/pages/AgentDetail').then(m => ({ default: m.AgentDetail })));
const AgentCreate = lazy(() => import('@/pages/AgentCreate').then(m => ({ default: m.AgentCreate })));
const AgentTemplates = lazy(() => import('@/pages/AgentTemplates').then(m => ({ default: m.AgentTemplates })));
const KnowledgeBase = lazy(() => import('@/pages/KnowledgeBase').then(m => ({ default: m.KnowledgeBase })));
const KBSources = lazy(() => import('@/pages/KBSources').then(m => ({ default: m.KBSources })));
const Apps = lazy(() => import('@/pages/Apps').then(m => ({ default: m.Apps })));
const Triggers = lazy(() => import('@/pages/Triggers').then(m => ({ default: m.Triggers })));

const AuditLog = lazy(() => import('@/pages/AuditLog').then(m => ({ default: m.AuditLog })));
const AccessRoles = lazy(() => import('@/pages/AccessRoles').then(m => ({ default: m.AccessRoles })));
const Settings = lazy(() => import('@/pages/Settings').then(m => ({ default: m.Settings })));
const GoogleOAuthAppSettings = lazy(() => import('@/pages/settings/integrations/google-oauth-app').then(m => ({ default: m.GoogleOAuthAppSettings })));
const Requests = lazy(() => import('@/pages/Requests').then(m => ({ default: m.Requests })));
const ErrorLogs = lazy(() => import('@/pages/ErrorLogs').then(m => ({ default: m.ErrorLogs })));
const Skills = lazy(() => import('@/pages/Skills').then(m => ({ default: m.Skills })));
const Evolution = lazy(() => import('@/pages/Evolution').then(m => ({ default: m.Evolution })));
const Documents = lazy(() => import('@/pages/Documents').then(m => ({ default: m.Documents })));
const DocumentDetail = lazy(() => import('@/pages/DocumentDetail').then(m => ({ default: m.DocumentDetail })));
const Database = lazy(() => import('@/pages/Database').then(m => ({ default: m.Database })));
const DatabaseTable = lazy(() => import('@/pages/DatabaseTable').then(m => ({ default: m.DatabaseTable })));
const Platform = lazy(() => import('@/pages/Platform').then(m => ({ default: m.Platform })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-warm-text-secondary border-t-brand" />
    </div>
  );
}

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
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-warm-text-secondary border-t-brand" />
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
          <Suspense fallback={<PageLoader />}>
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
                <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
                <Route path="agents" element={<Suspense fallback={<PageLoader />}><Agents /></Suspense>} />
                <Route path="agents/new" element={<Suspense fallback={<PageLoader />}><AgentCreate /></Suspense>} />
                <Route path="agents/templates" element={<Suspense fallback={<PageLoader />}><AgentTemplates /></Suspense>} />
                <Route path="agents/:id" element={<Suspense fallback={<PageLoader />}><AgentDetail /></Suspense>} />
                <Route path="skills" element={<Suspense fallback={<PageLoader />}><Skills /></Suspense>} />
                <Route path="kb" element={<Suspense fallback={<PageLoader />}><KnowledgeBase /></Suspense>} />
                <Route path="kb/sources" element={<Suspense fallback={<PageLoader />}><KBSources /></Suspense>} />
                <Route path="documents" element={<Suspense fallback={<PageLoader />}><Documents /></Suspense>} />
                <Route path="documents/:id" element={<Suspense fallback={<PageLoader />}><DocumentDetail /></Suspense>} />
                <Route path="database" element={<Suspense fallback={<PageLoader />}><Database /></Suspense>} />
                <Route path="database/:id" element={<Suspense fallback={<PageLoader />}><DatabaseTable /></Suspense>} />
                <Route path="tools" element={<Suspense fallback={<PageLoader />}><Apps /></Suspense>} />
                <Route path="apps" element={<Navigate to="/tools" replace />} />
                <Route path="connections" element={<Navigate to="/tools?tab=personal" replace />} />
                <Route path="triggers" element={<Suspense fallback={<PageLoader />}><Triggers /></Suspense>} />
                <Route path="requests" element={<Suspense fallback={<PageLoader />}><Requests /></Suspense>} />
                <Route path="errors" element={<Suspense fallback={<PageLoader />}><ErrorLogs /></Suspense>} />
                <Route path="evolution" element={<Suspense fallback={<PageLoader />}><Evolution /></Suspense>} />

                <Route path="audit" element={<Suspense fallback={<PageLoader />}><AuditLog /></Suspense>} />
                <Route path="access" element={<Suspense fallback={<PageLoader />}><AccessRoles /></Suspense>} />
                <Route path="settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
                <Route path="settings/integrations/google" element={<Suspense fallback={<PageLoader />}><GoogleOAuthAppSettings /></Suspense>} />
                <Route path="platform" element={<Suspense fallback={<PageLoader />}><Platform /></Suspense>} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
