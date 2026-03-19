import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { FloatingChat } from '@/components/FloatingChat';
import { Menu } from 'lucide-react';

export function Shell() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-40 flex h-12 items-center gap-3 border-b border-warm-border bg-white px-4 md:hidden">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-warm-text-secondary hover:text-warm-text hover:bg-warm-bg"
        >
          <Menu className="h-5 w-5" />
        </button>
        <img src="https://avatars.slack-edge.com/2026-03-12/10669603251543_4076da95a48800f96b7c_512.png" alt="TinyHands" className="h-6 w-6 rounded-md" />
        <span className="text-sm font-extrabold text-warm-text">TinyHands</span>
      </div>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative h-full w-[280px]" onClick={e => e.stopPropagation()}>
            <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto bg-warm-bg pt-12 md:pt-0">
          <div className="mx-auto max-w-[1200px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
      <FloatingChat />
    </div>
  );
}
