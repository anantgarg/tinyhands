import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Send } from 'lucide-react';

interface ChatMeta {
  name: string;
  agentName: string;
  agentEmoji: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

export function WebChat() {
  const { token } = useParams<{ token: string }>();

  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const sessionIdRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load public metadata for the chat (title / agent name).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/chat/${token}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'This chat link is not available.');
        }
        return res.json();
      })
      .then((data: ChatMeta) => {
        if (!cancelled) {
          setMeta(data);
          setLoadingMeta(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMetaError(err.message);
          setLoadingMeta(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const res = await postJson(`/api/public/chat/${token}/login`, { username, password });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Incorrect username or password.');
      }
      setAuthed(true);
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const pollReply = async (traceId: string, assistantId: string) => {
    const started = Date.now();
    while (Date.now() - started < POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const res = await fetch(
        `/api/public/chat/${token}/message/${traceId}?sessionId=${encodeURIComponent(sessionIdRef.current)}`,
        { credentials: 'include' },
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data.status === 'done') {
        setMessages((m) =>
          m.map((msg) => (msg.id === assistantId ? { ...msg, content: data.content, pending: false } : msg)),
        );
        return;
      }
      if (data.status === 'error') {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: 'Sorry, something went wrong. Please try again.', pending: false }
              : msg,
          ),
        );
        return;
      }
    }
    setMessages((m) =>
      m.map((msg) =>
        msg.id === assistantId
          ? { ...msg, content: 'The reply is taking too long. Please try again.', pending: false }
          : msg,
      ),
    );
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: userId, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', pending: true },
    ]);
    setInput('');
    setSending(true);

    try {
      const res = await postJson(`/api/public/chat/${token}/message`, {
        text,
        sessionId: sessionIdRef.current || undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not send your message.');
      }
      sessionIdRef.current = data.sessionId;
      await pollReply(data.traceId, assistantId);
    } catch (err: any) {
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content: err.message, pending: false } : msg)),
      );
    } finally {
      setSending(false);
    }
  };

  if (loadingMeta) {
    return (
      <div className="flex h-screen items-center justify-center bg-warm-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-warm-text-secondary border-t-brand" />
      </div>
    );
  }

  if (metaError || !meta) {
    return (
      <div className="flex h-screen items-center justify-center bg-warm-bg px-6">
        <div className="text-center">
          <h1 className="text-lg font-bold text-warm-text">Chat unavailable</h1>
          <p className="mt-1.5 text-sm text-warm-text-secondary">
            {metaError || 'This chat link is not available.'}
          </p>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex h-screen items-center justify-center bg-warm-bg px-6">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-card border border-warm-border bg-white p-6"
        >
          <h1 className="text-lg font-bold text-warm-text">{meta.name}</h1>
          <p className="mt-1 text-sm text-warm-text-secondary">
            Enter the username and password you were given to start chatting.
          </p>
          <div className="mt-5 space-y-3">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full rounded-lg border border-warm-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-warm-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
          {loginError && <p className="mt-3 text-sm text-red-500">{loginError}</p>}
          <button
            type="submit"
            disabled={loggingIn}
            className="mt-5 w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loggingIn ? 'Signing in…' : 'Start chat'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-warm-bg">
      <header className="flex items-center gap-2 border-b border-warm-border bg-white px-5 py-3">
        <span className="text-lg">{meta.agentEmoji || '💬'}</span>
        <div>
          <p className="text-sm font-semibold text-warm-text">{meta.name}</p>
          <p className="text-xs text-warm-text-secondary">with {meta.agentName}</p>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <p className="text-center text-sm text-warm-text-secondary">
              Send a message to start the conversation.
            </p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={
                  msg.role === 'user'
                    ? 'max-w-[80%] rounded-2xl bg-brand px-4 py-2 text-sm text-white'
                    : 'max-w-[80%] rounded-2xl border border-warm-border bg-white px-4 py-2 text-sm text-warm-text'
                }
              >
                {msg.pending ? (
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary [animation-delay:300ms]" />
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSend} className="border-t border-warm-border bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            type="text"
            placeholder="Type a message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 rounded-lg border border-warm-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
