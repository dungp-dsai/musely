/** Lightweight markdown for chat bubbles (no extra deps). */

export function renderChatMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (!line.trim()) return <div key={i} className="hc-md-gap" />;

    const isCodeFence = line.startsWith("```");
    if (isCodeFence) {
      return (
        <code key={i} className="hc-md-fence">
          {line.replace(/^```\w*/, "")}
        </code>
      );
    }

    let html = line
      .replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    if (/^#{1,3}\s/.test(line)) {
      return (
        <div
          key={i}
          className="hc-md-h"
          dangerouslySetInnerHTML={{ __html: html.replace(/^#{1,3}\s/, "") }}
        />
      );
    }

    if (/^[-*]\s/.test(line)) {
      return (
        <li
          key={i}
          className="hc-md-li"
          dangerouslySetInnerHTML={{ __html: html.replace(/^[-*]\s/, "") }}
        />
      );
    }

    return <p key={i} className="hc-md-p" dangerouslySetInnerHTML={{ __html: html }} />;
  });
}
