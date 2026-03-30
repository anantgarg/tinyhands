import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Wrench,
  Sparkles,
  BookOpen,
  Link,
  Zap,
  Bell,
  FileText,
  AlertTriangle,
  Lightbulb,
  Shield,
  Settings,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useSidebarStore } from '@/store/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { usePendingCounts } from '@/api/agents';
import { useExpiredConnectionCount } from '@/api/connections';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  adminOnly?: boolean;
}

const mainNav: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
];

const manageNav: NavItem[] = [
  { label: 'Agents', to: '/agents', icon: Bot },
  { label: 'Skills', to: '/skills', icon: Sparkles, adminOnly: true },
  { label: 'Tools & Integrations', to: '/tools', icon: Wrench, adminOnly: true },
  { label: 'Connections', to: '/connections', icon: Link },
  { label: 'Knowledge Base', to: '/kb', icon: BookOpen },
  { label: 'Triggers', to: '/triggers', icon: Zap },
];

const reviewNav: NavItem[] = [
  { label: 'Requests', to: '/requests', icon: Bell },
  { label: 'Evolution', to: '/evolution', icon: Lightbulb, adminOnly: true },
  { label: 'Error Logs', to: '/errors', icon: AlertTriangle },
  { label: 'Audit Log', to: '/audit', icon: FileText, adminOnly: true },
];

const settingsNav: NavItem[] = [
  { label: 'Access & Roles', to: '/access', icon: Shield, adminOnly: true },
  { label: 'Workspace Settings', to: '/settings', icon: Settings, adminOnly: true },
];

function NavSection({ title, items, isAdmin, onNavigate }: { title?: string; items: NavItem[]; isAdmin: boolean; onNavigate?: () => void }) {
  const visibleItems = items.filter((item) => !item.adminOnly || isAdmin);
  if (visibleItems.length === 0) return null;

  return (
    <div className="mb-1">
      {title && (
        <p className="px-4 pt-5 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-warm-text-secondary/50">
          {title}
        </p>
      )}
      <nav className="space-y-px px-3">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[14px] transition-colors',
                isActive
                  ? 'bg-brand-light text-brand font-semibold'
                  : 'text-warm-text-secondary hover:text-warm-text hover:bg-warm-bg',
              )
            }
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
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

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const navigate = useNavigate();
  const { user, clearUser, isAdmin } = useAuthStore();
  const admin = isAdmin();
  const { collapsed, toggle } = useSidebarStore();
  const { data: pendingCounts } = usePendingCounts();
  const { data: expiredCount } = useExpiredConnectionCount();

  // Inject badge count on the Requests nav item
  const reviewNavWithBadge: NavItem[] = reviewNav.map((item) =>
    item.to === '/requests' && pendingCounts?.total
      ? { ...item, badge: pendingCounts.total }
      : item
  );

  // Inject badge count on the Connections nav item for expired connections
  const manageNavWithBadge: NavItem[] = manageNav.map((item) =>
    item.to === '/connections' && expiredCount?.count
      ? { ...item, badge: expiredCount.count }
      : item
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

  const allItems = [...mainNav, ...manageNavWithBadge, ...reviewNavWithBadge, ...settingsNav];
  const visibleCollapsedItems = allItems.filter((item) => !item.adminOnly || admin);

  if (collapsed) {
    return (
      <div className="flex h-screen w-[52px] flex-col border-r border-warm-border bg-white">
        <button
          onClick={toggle}
          className="flex h-12 items-center justify-center text-warm-text-secondary hover:text-warm-text"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
        <nav className="flex flex-1 flex-col items-center gap-1 py-2">
          {visibleCollapsedItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                  isActive ? 'bg-brand-light text-brand' : 'text-warm-text-secondary hover:bg-warm-bg hover:text-warm-text',
                )
              }
              title={item.label}
            >
              <item.icon className="h-[18px] w-[18px]" />
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
    <div className="flex h-screen w-[240px] flex-col border-r border-warm-border bg-white">
      {/* Header */}
      <div className="flex h-12 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <img src="https://avatars.slack-edge.com/2026-03-12/10669603251543_4076da95a48800f96b7c_512.png" alt="TinyHands" className="h-7 w-7 rounded-md" />
          <span className="text-[15px] font-extrabold text-warm-text tracking-tight">TinyHands</span>
        </div>
        <button
          onClick={toggle}
          className="flex h-7 w-7 items-center justify-center rounded-md text-warm-text-secondary hover:text-warm-text hover:bg-warm-bg transition-colors"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto pt-1 pb-3">
        <NavSection items={mainNav} isAdmin={admin} onNavigate={onNavigate} />
        <NavSection title="Manage" items={manageNavWithBadge} isAdmin={admin} onNavigate={onNavigate} />
        <NavSection title="Review" items={reviewNavWithBadge} isAdmin={admin} onNavigate={onNavigate} />
        <NavSection title="Settings" items={settingsNav} isAdmin={admin} onNavigate={onNavigate} />
      </div>

      {/* User footer */}
      <div className="border-t border-warm-border px-3 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-7 w-7">
            <AvatarImage src={user?.avatarUrl} alt={user?.displayName} />
            <AvatarFallback className="text-xs bg-brand-light text-brand font-semibold">
              {user?.displayName?.charAt(0) ?? '?'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium leading-tight">{user?.displayName ?? 'Unknown'}</p>
            <p className="truncate text-xs text-warm-text-secondary capitalize">{(user?.platformRole ?? 'member').replace('superadmin', 'Super Admin').replace('admin', 'Admin').replace('member', 'Member')}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex h-7 w-7 items-center justify-center rounded-md text-warm-text-secondary hover:text-warm-text hover:bg-warm-bg transition-colors shrink-0"
            title="Log out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
