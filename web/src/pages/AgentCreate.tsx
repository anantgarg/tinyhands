import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useChatStore } from '@/store/chat';

export function AgentCreate() {
  const { creationMode, enterCreationMode, exitCreationMode } = useChatStore();

  useEffect(() => {
    if (!creationMode) {
      enterCreationMode();
    }
    return () => {
      // Exit creation mode when navigating away
      exitCreationMode();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <Link
        to="/agents"
        className="inline-flex items-center gap-1 text-sm text-warm-text-secondary hover:text-warm-text mb-4"
        onClick={() => exitCreationMode()}
      >
        <ArrowLeft className="h-4 w-4" />
        Agents
      </Link>

      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Sparkles className="h-10 w-10 text-brand" />
        <h2 className="text-xl font-bold text-warm-text">Creating your agent</h2>
        <p className="text-sm text-warm-text-secondary text-center max-w-md">
          Use the chat panel to describe what your agent should do. The assistant will guide you through
          choosing a channel, tools, and settings.
        </p>
      </div>
    </div>
  );
}
