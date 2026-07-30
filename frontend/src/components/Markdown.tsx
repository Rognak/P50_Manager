import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

const HIGHLIGHT_OPTS = { detect: true, ignoreMissing: true }

export function Markdown({ content }: { content: string }) {
  return (
    <div className="md-body text-sm text-slate-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, HIGHLIGHT_OPTS]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
