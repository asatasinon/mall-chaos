import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function RunbookArticle({ markdown }: { markdown: string }) {
  return (
    <article className="runbook-article min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}