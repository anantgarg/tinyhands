import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
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

/** Apply inline bold/italic formatting. */
function inlineFormat(text: string): string {
  // **bold** (double asterisk, processed first)
  let result = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // *italic* (single asterisk, after bold is already handled)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
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
        if (childTag === 'strong' || childTag === 'b') {
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
// Main component
// ---------------------------------------------------------------------------

function RichTextEditor({ value, onChange, placeholder, className }: RichTextEditorProps) {
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
    </div>
  );
}

export default RichTextEditor;
