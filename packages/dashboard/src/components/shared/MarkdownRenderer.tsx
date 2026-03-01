import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown with GitHub Flavored Markdown (tables, task lists, strikethrough)
 * and syntax-highlighted code blocks using the GitHub Dark theme.
 * Typography is tuned to the GitHub Dark palette used across the dashboard.
 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("text-[#c9d1d9]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base font-semibold text-[#e1e4e8] mt-0 mb-3 pb-2 border-b border-[#21262d]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold text-[#e1e4e8] mt-6 mb-2 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold text-[#c9d1d9] mt-4 mb-1.5">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-xs text-[#c9d1d9] leading-relaxed mb-3 last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-4 space-y-1 mb-3 text-xs text-[#c9d1d9]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside ml-4 space-y-1 mb-3 text-xs text-[#c9d1d9]">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">{children}</li>
          ),
          code: ({ children, className: hlClass }) => {
            const isBlock = Boolean(hlClass?.startsWith("language-"));
            if (isBlock) {
              return (
                <code className={cn("text-[11px] leading-relaxed", hlClass)}>
                  {children}
                </code>
              );
            }
            return (
              <code className="px-1 py-0.5 rounded text-[11px] font-mono bg-[#1c2333] text-[#58a6ff] border border-[#30363d]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="rounded-lg bg-[#0d1117] border border-[#21262d] p-4 overflow-x-auto mb-3 text-[11px] leading-relaxed">
              {children}
            </pre>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[#e1e4e8]">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-[#8b949e]">{children}</em>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-[#58a6ff] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#58a6ff] pl-4 my-3 text-[#8b949e] italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-[#21262d] my-4" />,
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs border-collapse border border-[#30363d]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#161b22]">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-medium text-[#8b949e] border border-[#30363d]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-[#c9d1d9] border border-[#21262d]">
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="even:bg-[#0d1117]">{children}</tr>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
