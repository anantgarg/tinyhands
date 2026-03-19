import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { FloatingChat } from '@/components/FloatingChat';

export function Shell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-warm-bg">
          <div className="mx-auto max-w-[1200px] p-8">
            <Outlet />
          </div>
        </main>
      </div>
      <FloatingChat />
    </div>
  );
}
