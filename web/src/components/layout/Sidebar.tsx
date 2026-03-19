import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Wrench,
  BookOpen,
  Link,
  Zap,
  GitBranch,
  Lightbulb,
  FileText,
  Shield,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useSidebarStore } from '@/store/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useEvolutionProposals } from '@/api/evolution';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

const mainNav: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
];

const manageNav: NavItem[] = [
  { label: 'Agents', to: '/agents', icon: Bot },
  { label: 'Tools & Integrations', to: '/tools', icon: Wrench },
  { label: 'Knowledge Base', to: '/kb', icon: BookOpen },
  { label: 'Connections', to: '/connections', icon: Link },
  { label: 'Triggers', to: '/triggers', icon: Zap },
  { label: 'Workflows', to: '/workflows', icon: GitBranch },
];

const reviewNav: NavItem[] = [
  { label: 'Evolution Proposals', to: '/evolution', icon: Lightbulb },
  { label: 'Audit Log', to: '/audit', icon: FileText },
];

const settingsNav: NavItem[] = [
  { label: 'Access & Roles', to: '/access', icon: Shield },
  { label: 'Workspace Settings', to: '/settings', icon: Settings },
];

function NavSection({ title, items }: { title?: string; items: NavItem[] }) {
  return (
    <div className="mb-2">
      {title && (
        <p className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-warm-text-secondary/70">
          {title}
        </p>
      )}
      <nav className="space-y-0.5 px-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-btn px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white/70 text-warm-text border-l-2 border-brand shadow-sm'
                  : 'text-warm-text-secondary hover:bg-white/40 hover:text-warm-text border-l-2 border-transparent',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const { user, clearUser } = useAuthStore();
  const { collapsed, toggle } = useSidebarStore();
  const { data: evolutionData } = useEvolutionProposals({ status: 'pending' });
  const pendingCount = evolutionData?.total ?? 0;

  const reviewItems = reviewNav.map((item) =>
    item.to === '/evolution' ? { ...item, badge: pendingCount } : item,
  );

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    clearUser();
    navigate('/login');
  };

  if (collapsed) {
    return (
      <div className="flex h-screen w-16 flex-col border-r border-warm-border bg-warm-sidebar">
        <div className="flex h-14 items-center justify-center">
          <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8">
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1 py-2">
          {[...mainNav, ...manageNav, ...reviewItems, ...settingsNav].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-btn transition-colors',
                  isActive ? 'bg-white/70 text-brand shadow-sm' : 'text-warm-text-secondary hover:bg-white/40',
                )
              }
              title={item.label}
            >
              <item.icon className="h-4 w-4" />
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-[260px] flex-col border-r border-warm-border bg-warm-sidebar">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤲</span>
          <span className="text-sm font-bold text-warm-text">TinyHands</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      <div className="flex-1 overflow-y-auto py-3">
        <NavSection items={mainNav} />
        <NavSection title="Manage" items={manageNav} />
        <NavSection title="Review" items={reviewItems} />
        <NavSection title="Settings" items={settingsNav} />
      </div>

      <Separator />

      <div className="flex items-center gap-3 p-4">
        <Avatar className="h-8 w-8">
          <AvatarImage src={user?.avatarUrl} alt={user?.displayName} />
          <AvatarFallback>{user?.displayName?.charAt(0) ?? '?'}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium">{user?.displayName ?? 'Unknown'}</p>
          <p className="truncate text-xs text-warm-text-secondary capitalize">{user?.platformRole ?? 'member'}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8 shrink-0">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
