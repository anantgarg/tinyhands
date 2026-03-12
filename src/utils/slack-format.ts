// ── Markdown → Slack mrkdwn Converter ──
// Converts standard markdown output from Claude to Slack-compatible mrkdwn format.

export function markdownToSlack(text: string): string {
  if (!text) return text;

  let result = text;

  // Convert literal \n sequences to actual newlines (can occur in agent output)
  result = result.replace(/\\n/g, '\n');

  // Convert headers: ## Header → *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Convert bold: **text** → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Convert italic: _text_ stays the same (Slack supports it)
  // Convert single * italic that aren't already bold markers
  // Be careful not to double-convert

  // Convert inline code: `code` stays the same (Slack supports it)
  // Convert code blocks: ```lang\ncode\n``` → ```\ncode\n```
  result = result.replace(/```\w*\n/g, '```\n');

  // Convert links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Convert images: ![alt](url) → <url|alt>
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');

  // Convert horizontal rules: --- or *** → ───
  result = result.replace(/^[-*]{3,}$/gm, '───');

  // Convert blockquotes: > text → > text (Slack supports > for quotes)

  // Convert strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Convert numbered lists: keep as-is (Slack renders them fine)
  // Convert bullet lists: - item or * item → • item
  result = result.replace(/^[\t ]*[-*]\s+/gm, '• ');

  // Remove HTML tags that might appear
  result = result.replace(/<\/?(?:br|p|div|span|h[1-6]|ul|ol|li)[^>]*>/gi, '');

  return result;
}
