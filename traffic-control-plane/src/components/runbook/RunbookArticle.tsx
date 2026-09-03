import { Children, isValidElement, type ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MermaidDiagram from './MermaidDiagram';

type MarkdownCodeProps = ComponentProps<'code'> & { node?: unknown; mermaidLabel: string };
type MarkdownPreProps = ComponentProps<'pre'> & { node?: unknown };

export function getMarkdownCodeLanguage(className: string | undefined): string | null {
  const languageTokens = className?.split(/\s+/u).filter(Boolean) || [];
  const languageToken = languageTokens.find((token) => token === 'language-mermaid')
    || languageTokens.find((token) => token.startsWith('language-'));
  return languageToken?.slice('language-'.length) || null;
}

export function isMermaidCodeBlock(className: string | undefined): boolean {
  return getMarkdownCodeLanguage(className) === 'mermaid';
}

function MarkdownCode({ className, children, mermaidLabel }: MarkdownCodeProps) {
  const source = String(children).replace(/\n$/u, '');
  if (isMermaidCodeBlock(className)) {
    return <MermaidDiagram source={source} label={mermaidLabel} />;
  }

  return <code className={['runbook-code-inline', className].filter(Boolean).join(' ')}>{children}</code>;
}

function MarkdownPre({ className, children }: MarkdownPreProps) {
  const childNodes = Children.toArray(children);
  const child = childNodes.length === 1 ? childNodes[0] : null;
  if (isValidElement(child) && child.type === MermaidDiagram) return child;

  return <pre className={['runbook-code', className].filter(Boolean).join(' ')}>{children}</pre>;
}

export default function RunbookArticle({ markdown, mermaidLabel }: { markdown: string; mermaidLabel: string }) {
  const components: Components = {
    code: (props) => <MarkdownCode {...props} mermaidLabel={mermaidLabel} />,
    pre: MarkdownPre,
  };

  return (
    <article className="runbook-article min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}