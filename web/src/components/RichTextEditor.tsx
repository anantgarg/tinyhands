import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useSlackUsers } from '@/api/slack';
import { useDatabaseTables } from '@/api/database';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  enableUserMentions?: boolean;
  /**
   * When true, typing `@database` in the editor opens a second-level picker
   * of the workspace's database tables. Selecting a table inserts the literal
   * reference `@database:<table_name> ` into the prompt. The reference is
   * surfaced to the agent at runtime — its `describe_table` output is injected
   * into the system context before the first turn.
   */
  enableDatabaseMentions?: boolean;
}

/**
 * Convert plain text with lightweight markdown formatting to TipTap-compatible HTML.
 *
 * Supported input syntax:
 *   **bold** or *bold*  ->  <strong>bold</strong>
 *   ## Heading          ->  <h2>Heading</h2>
 *   - item / * item     ->  bullet list
 *   1. item              ->  ordered list
 */
function plainTextToHtml(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const htmlParts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading (## ...)
    if (/^##\s+(.+)/.test(line)) {
      const content = line.replace(/^##\s+/, '');
      htmlParts.push(`<h2>${inlineFormat(content)}</h2>`);
      i++;
      continue;
    }

    // Bullet list (- or * at start)
    if (/^[\-\*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\-\*]\s+/, ''));
        i++;
      }
      htmlParts.push(
        '<ul>' +
          items.map((item) => `<li><p>${inlineFormat(item)}</p></li>`).join('') +
          '</ul>',
      );
      continue;
    }

    // Ordered list (1. 2. etc.)
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      htmlParts.push(
        '<ol>' +
          items.map((item) => `<li><p>${inlineFormat(item)}</p></li>`).join('') +
          '</ol>',
      );
      continue;
    }

    // Empty line -> empty paragraph
    if (line.trim() === '') {
      htmlParts.push('<p></p>');
      i++;
      continue;
    }

    // Regular paragraph
    htmlParts.push(`<p>${inlineFormat(line)}</p>`);
    i++;
  }

  return htmlParts.join('');
}

/** Apply inline bold/italic formatting and preserve Slack mention tokens. */
function inlineFormat(text: string): string {
  // Escape HTML special chars first.
  let result = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // **bold** (double asterisk, processed first)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // *italic* (single asterisk, after bold is already handled)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Convert the now-escaped Slack mention tokens into a Tiptap-parseable span
  // so they render as mention chips in the editor while keeping `<@ID>` as the
  // storage format.
  result = result.replace(/&lt;@([A-Z][A-Z0-9]+)&gt;/g, '<span data-mention-id="$1"></span>');
  return result;
}

/**
 * Convert TipTap HTML back to plain text with lightweight markdown formatting.
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines: string[] = [];

  function processNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      return; // handled by parent element processing
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    switch (tag) {
      case 'h2': {
        const text = getInlineText(el);
        if (text) lines.push(`## ${text}`);
        break;
      }
      case 'ul': {
        for (const li of Array.from(el.children)) {
          const text = getInlineText(li);
          if (text) lines.push(`- ${text}`);
        }
        break;
      }
      case 'ol': {
        let idx = 1;
        for (const li of Array.from(el.children)) {
          const text = getInlineText(li);
          if (text) lines.push(`${idx}. ${text}`);
          idx++;
        }
        break;
      }
      case 'p': {
        const text = getInlineText(el);
        lines.push(text); // empty string for blank lines is fine
        break;
      }
      default: {
        // Recurse for wrapper elements (body, div, etc.)
        for (const child of Array.from(el.childNodes)) {
          processNode(child);
        }
      }
    }
  }

  function getInlineText(el: Node): string {
    let result = '';
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent ?? '';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as HTMLElement;
        const childTag = childEl.tagName.toLowerCase();
        const mentionId = childEl.getAttribute('data-mention-id');
        if (mentionId) {
          result += `<@${mentionId}>`;
        } else if (childTag === 'strong' || childTag === 'b') {
          result += `**${getInlineText(childEl)}**`;
        } else if (childTag === 'em' || childTag === 'i') {
          result += `*${getInlineText(childEl)}*`;
        } else if (childTag === 'p') {
          // Nested <p> inside <li> -- just extract text
          result += getInlineText(childEl);
        } else {
          result += getInlineText(childEl);
        }
      }
    }
    return result;
  }

  processNode(doc.body);

  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  onClick: () => void;
  isActive: boolean;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, isActive, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center justify-center h-8 w-8 rounded-badge text-sm font-medium transition-colors',
        isActive
          ? 'bg-brand text-white'
          : 'text-warm-text-secondary hover:text-warm-text hover:bg-warm-bg',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Slack mention node (renders as @Name chip, serializes to <@ID>)
// ---------------------------------------------------------------------------

const SlackMention = TiptapNode.create({
  name: 'slackMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-id'),
        renderHTML: (attrs: { id?: string | null }) =>
          attrs.id ? { 'data-mention-id': attrs.id } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'slack-mention' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChip);
  },
});

function MentionChip({ node }: { node: { attrs: Record<string, unknown> } }) {
  const id = (node.attrs.id as string | undefined) ?? '';
  const { data } = useSlackUsers();
  const user = (data?.users ?? []).find((u) => u.id === id);
  const name = user ? user.realName || user.displayName || user.name : null;
  return (
    <NodeViewWrapper
      as="span"
      data-mention-id={id}
      className="mx-px inline-flex h-5 items-center gap-1 rounded bg-blue-100 px-1.5 align-middle text-sm font-medium leading-none text-blue-700"
    >
      {user?.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="inline-block h-4 w-4 rounded-full" />
      ) : null}
      <span>@{name || 'Unknown user'}</span>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function RichTextEditor({ value, onChange, placeholder, className, enableUserMentions, enableDatabaseMentions }: RichTextEditorProps) {
  // Track whether the latest change came from the editor itself so we don't
  // feed the value back in an infinite loop.
  const isInternalChange = useRef(false);

  const handleUpdate = useCallback(
    ({ editor }: { editor: ReturnType<typeof useEditor> }) => {
      if (!editor) return;
      isInternalChange.current = true;
      const html = editor.getHTML();
      const plain = htmlToPlainText(html);
      onChange(plain);
    },
    [onChange],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Start writing...',
      }),
      SlackMention,
    ],
    content: plainTextToHtml(value),
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[200px] px-4 py-3 focus:outline-none overflow-y-auto text-warm-text',
      },
    },
  });

  // Sync external value changes into the editor (e.g. form reset).
  useEffect(() => {
    if (!editor) return;
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const currentPlain = htmlToPlainText(editor.getHTML());
    if (currentPlain !== value) {
      editor.commands.setContent(plainTextToHtml(value), { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        'rounded-btn border border-warm-border bg-white transition-colors focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand',
        className,
      )}
    >
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-warm-border bg-white px-2 py-1.5 rounded-t-btn">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold"
        >
          <span className="font-bold">B</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic"
        >
          <span className="italic">I</span>
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-warm-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title="Heading"
        >
          <span className="text-xs font-bold">H2</span>
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-warm-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-4 w-4"
          >
            <circle cx="2.5" cy="4" r="1.5" />
            <circle cx="2.5" cy="8" r="1.5" />
            <circle cx="2.5" cy="12" r="1.5" />
            <rect x="6" y="3" width="9" height="2" rx="0.5" />
            <rect x="6" y="7" width="9" height="2" rx="0.5" />
            <rect x="6" y="11" width="9" height="2" rx="0.5" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Ordered List"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-4 w-4"
          >
            <text x="0.5" y="5.5" fontSize="5" fontWeight="bold">
              1
            </text>
            <text x="0.5" y="9.5" fontSize="5" fontWeight="bold">
              2
            </text>
            <text x="0.5" y="13.5" fontSize="5" fontWeight="bold">
              3
            </text>
            <rect x="6" y="3" width="9" height="2" rx="0.5" />
            <rect x="6" y="7" width="9" height="2" rx="0.5" />
            <rect x="6" y="11" width="9" height="2" rx="0.5" />
          </svg>
        </ToolbarButton>

      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      {enableUserMentions && <MentionAutocomplete editor={editor} />}
      {enableDatabaseMentions && <DatabaseMentionAutocomplete editor={editor} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline @mention autocomplete
// ---------------------------------------------------------------------------

interface MentionAutocompleteProps {
  editor: Editor;
}

interface MentionState {
  open: boolean;
  query: string;
  from: number; // document position where the `@` starts
  coords: { top: number; left: number } | null;
}

const CLOSED_STATE: MentionState = { open: false, query: '', from: 0, coords: null };

function MentionAutocomplete({ editor }: MentionAutocompleteProps) {
  const { data } = useSlackUsers();
  const users = data?.users ?? [];

  const [state, setState] = useState<MentionState>(CLOSED_STATE);
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(() => {
    const q = state.query.trim().toLowerCase();
    const list = q
      ? users.filter((u) => {
          const name = (u.realName || u.displayName || u.name || '').toLowerCase();
          const handle = (u.name || '').toLowerCase();
          return name.includes(q) || handle.includes(q);
        })
      : users;
    return list.slice(0, 20);
  }, [users, state.query]);

  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useLayoutEffect(() => {
    itemRefs.current[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  // Reset highlight when the filtered list shifts.
  useEffect(() => {
    setHighlight(0);
  }, [state.query, filtered.length]);

  // Refs so the editor's static key handler can read the latest values
  // without re-binding.
  const stateRef = useRef(state);
  const filteredRef = useRef(filtered);
  const highlightRef = useRef(highlight);
  useLayoutEffect(() => {
    stateRef.current = state;
    filteredRef.current = filtered;
    highlightRef.current = highlight;
  });

  const close = useCallback(() => {
    setState(CLOSED_STATE);
  }, []);

  const insertAt = useCallback(
    (from: number, userId: string) => {
      const to = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, [
          { type: 'slackMention', attrs: { id: userId } },
          { type: 'text', text: ' ' },
        ])
        .run();
      close();
    },
    [editor, close],
  );

  // Watch the editor for `@word` at the cursor and open/update the popup.
  useEffect(() => {
    const handler = () => {
      const { selection } = editor.state;
      if (!selection.empty) {
        if (stateRef.current.open) close();
        return;
      }
      const cursor = selection.from;
      const textBefore = editor.state.doc.textBetween(
        Math.max(0, cursor - 40),
        cursor,
        '\n',
        '\n',
      );
      const match = /(?:^|\s)@([\w.\-]*)$/.exec(textBefore);
      if (!match) {
        if (stateRef.current.open) close();
        return;
      }
      // The regex is anchored to the end of textBefore, so match[1] ends
      // exactly at the cursor. `@` sits one character before match[1].
      const from = cursor - match[1].length - 1;
      const coords = editor.view.coordsAtPos(from);
      setState({
        open: true,
        query: match[1],
        from,
        coords: { top: coords.bottom, left: coords.left },
      });
    };

    editor.on('update', handler);
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('update', handler);
      editor.off('selectionUpdate', handler);
    };
  }, [editor, close]);

  // Intercept arrow/enter/escape while the popup is open. We attach this once
  // and read state via refs so Tiptap doesn't need to reinitialize.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setHighlight((h) => Math.min(h + 1, Math.max(0, filteredRef.current.length - 1)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const u = filteredRef.current[highlightRef.current];
        if (u) {
          event.preventDefault();
          event.stopPropagation();
          insertAt(s.from, u.id);
        }
        return;
      }
    };
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, insertAt, close]);

  if (!state.open || !state.coords || filtered.length === 0) return null;

  return createPortal(
    <div
      className="fixed z-50 w-72 rounded-lg border border-warm-border bg-white shadow-lg"
      style={{ top: state.coords.top + 4, left: state.coords.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="max-h-[240px] overflow-y-auto">
        {filtered.map((u, idx) => {
          const name = u.realName || u.displayName || u.name;
          const isActive = idx === highlight;
          return (
            <button
              key={u.id}
              ref={(el) => { itemRefs.current[idx] = el; }}
              type="button"
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => insertAt(state.from, u.id)}
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1 text-left transition-colors',
                isActive ? 'bg-warm-bg' : 'hover:bg-warm-bg',
              )}
            >
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarImage src={u.avatarUrl} />
                <AvatarFallback>{(name || '?').charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-sm font-medium truncate">{name || u.name || 'Unknown'}</div>
                {u.name && u.name !== name && (
                  <div className="text-xs text-warm-text-secondary truncate">@{u.name}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Database table @ autocomplete
// ---------------------------------------------------------------------------
//
// Triggered when the user types `@database` (with optional `:partial` suffix)
// at a word boundary. The plan REQUIRES that the author pick a specific table
// — there is no bare `@database` reference. So we only insert the fully
// qualified `@database:<table_name> ` once a table is chosen.

interface DBState {
  open: boolean;
  query: string;
  from: number;
  coords: { top: number; left: number } | null;
}
const DB_CLOSED: DBState = { open: false, query: '', from: 0, coords: null };

function DatabaseMentionAutocomplete({ editor }: { editor: Editor }) {
  const { data: tables } = useDatabaseTables();

  const [state, setState] = useState<DBState>(DB_CLOSED);
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(() => {
    const q = state.query.trim().toLowerCase();
    const all = tables || [];
    const list = q
      ? all.filter((t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
      : all;
    return list.slice(0, 12);
  }, [tables, state.query]);

  const stateRef = useRef(state);
  const filteredRef = useRef(filtered);
  const highlightRef = useRef(highlight);
  useLayoutEffect(() => {
    stateRef.current = state;
    filteredRef.current = filtered;
    highlightRef.current = highlight;
  });

  useEffect(() => { setHighlight(0); }, [state.query, filtered.length]);

  const close = useCallback(() => setState(DB_CLOSED), []);

  const insertAt = useCallback((from: number, tableName: string) => {
    const to = editor.state.selection.from;
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, [
        { type: 'text', text: `@database:${tableName} ` },
      ])
      .run();
    close();
  }, [editor, close]);

  // Detect `@database` or `@database:partial` at the cursor.
  useEffect(() => {
    const handler = () => {
      const { selection } = editor.state;
      if (!selection.empty) { if (stateRef.current.open) close(); return; }
      const cursor = selection.from;
      const before = editor.state.doc.textBetween(Math.max(0, cursor - 50), cursor, '\n', '\n');
      const m = /(?:^|\s)@database(?::([\w\-]*))?$/i.exec(before);
      if (!m) { if (stateRef.current.open) close(); return; }
      const matchedLen = m[0].length - (m[0].startsWith(' ') || m[0].startsWith('\n') ? 1 : 0);
      const from = cursor - matchedLen;
      const coords = editor.view.coordsAtPos(from);
      setState({ open: true, query: m[1] || '', from, coords: { top: coords.bottom, left: coords.left } });
    };
    editor.on('update', handler);
    editor.on('selectionUpdate', handler);
    return () => { editor.off('update', handler); editor.off('selectionUpdate', handler); };
  }, [editor, close]);

  useEffect(() => {
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.open) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHighlight(h => Math.min(h + 1, Math.max(0, filteredRef.current.length - 1))); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHighlight(h => Math.max(h - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const t = filteredRef.current[highlightRef.current];
        if (t) { e.preventDefault(); e.stopPropagation(); insertAt(s.from, t.name); }
        return;
      }
    };
    dom.addEventListener('keydown', onKey, true);
    return () => dom.removeEventListener('keydown', onKey, true);
  }, [editor, insertAt, close]);

  if (!state.open || !state.coords) return null;

  return createPortal(
    <div
      className="fixed z-50 w-80 rounded-lg border border-warm-border bg-white shadow-lg"
      style={{ top: state.coords.top + 4, left: state.coords.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-3 py-2 border-b border-warm-border text-xs font-medium text-warm-text-secondary">
        Pick a database table
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-warm-text-secondary">
            {tables === undefined ? 'Loading tables…' : 'No tables yet. Create one in Database.'}
          </div>
        ) : filtered.map((t, idx) => {
          const isActive = idx === highlight;
          return (
            <button
              key={t.id}
              type="button"
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => insertAt(state.from, t.name)}
              title={`${(t.columns || []).length} columns`}
              className={cn(
                'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                isActive ? 'bg-warm-bg' : 'hover:bg-warm-bg',
              )}
            >
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-sm font-medium font-mono">{t.name}</div>
                {t.description && (
                  <div className="text-xs text-warm-text-secondary truncate">{t.description}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

export default RichTextEditor;
