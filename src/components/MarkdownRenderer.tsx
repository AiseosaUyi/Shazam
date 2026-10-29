'use client';

import React, { useState } from 'react';
import { Copy, Check, Terminal, AlertTriangle, ExternalLink } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onOpenFile?: (path: string) => void;
}

export function MarkdownRenderer({ content, className = '', onOpenFile }: MarkdownRendererProps) {
  // 1. Separate code blocks from regular markdown text
  const blocks = splitCodeBlocks(content);

  return (
    <div className={`space-y-3 font-sans text-sm text-zinc-200 leading-relaxed ${className}`}>
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return <CodeBlock key={index} language={block.language} code={block.code} />;
        }
        return <TextBlock key={index} text={block.text} onOpenFile={onOpenFile} />;
      })}
    </div>
  );
}

interface Block {
  type: 'code' | 'text';
  language?: string;
  code?: string;
  text?: string;
}

function splitCodeBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: 'text',
        text: content.slice(lastIndex, match.index),
      });
    }

    blocks.push({
      type: 'code',
      language: match[1]?.trim() || 'code',
      code: match[2]?.trim() || '',
    });

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    blocks.push({
      type: 'text',
      text: content.slice(lastIndex),
    });
  }

  return blocks;
}

function CodeBlock({ language, code = '' }: { language?: string; code?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="my-3 rounded-2xl bg-black/70 border border-white/[0.08] overflow-hidden shadow-xl group">
      <div className="px-4 py-2 bg-white/[0.03] border-b border-white/[0.06] flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {language}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="px-2 py-1 rounded-lg hover:bg-white/[0.06] text-zinc-400 hover:text-white flex items-center gap-1.5 transition text-xs"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed selection:bg-amber-500/30">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ImageCard({ alt = 'Generated Image', src }: { alt?: string; src: string }) {
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(src);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="my-4 rounded-2xl bg-zinc-950/80 border border-white/[0.08] overflow-hidden shadow-2xl group max-w-2xl">
      <div className="relative aspect-square max-h-[512px] bg-zinc-900 flex items-center justify-center overflow-hidden">
        {!loaded && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500 bg-zinc-900/50 backdrop-blur-sm">
            <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            <span className="text-xs font-mono">Rendering high-res frame...</span>
          </div>
        )}
        {error ? (
          <div className="p-6 text-center text-zinc-400">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <p className="text-xs">Failed to load preview image</p>
          </div>
        ) : (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            className={`w-full h-full object-contain transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}

        <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur-md p-1 rounded-xl border border-white/10 shadow-lg">
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition text-xs"
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition text-xs"
            title="Copy image link"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {alt && alt !== 'Generated Image' && (
        <div className="px-4 py-2.5 bg-white/[0.02] border-t border-white/[0.06] flex items-center justify-between text-xs text-zinc-400">
          <span className="truncate pr-2 italic font-mono text-[11px] text-zinc-300">{alt}</span>
          <span className="shrink-0 text-[10px] font-semibold tracking-wider uppercase text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
            FLUX.1 Schnell
          </span>
        </div>
      )}
    </div>
  );
}

function TextBlock({ text = '', onOpenFile }: { text?: string; onOpenFile?: (path: string) => void }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;

  function flushList() {
    if (!currentList) return;
    if (currentList.type === 'ul') {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-2 space-y-1.5 pl-1">
          {currentList.items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-zinc-300 leading-relaxed">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-2 shrink-0 opacity-80" />
              <span className="flex-1">{renderInline(item, onOpenFile)}</span>
            </li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`ol-${elements.length}`} className="my-2 space-y-1.5 pl-1">
          {currentList.items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-zinc-300 leading-relaxed">
              <span className="px-1.5 py-0.2 rounded bg-white/[0.05] border border-white/10 text-[10px] font-mono text-amber-300 font-semibold shrink-0 mt-0.5">
                {idx + 1}
              </span>
              <span className="flex-1">{renderInline(item, onOpenFile)}</span>
            </li>
          ))}
        </ol>
      );
    }
    currentList = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Callout alert warning (e.g. ⚠️ **Unable to complete task:** ...)
    if (trimmed.startsWith('⚠️')) {
      flushList();
      elements.push(
        <div
          key={`alert-${i}`}
          className="my-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex items-start gap-2.5 shadow-md"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed flex-1">{renderInline(trimmed.replace(/^⚠️\s*/, ''), onOpenFile)}</div>
        </div>
      );
      continue;
    }

    // Standalone image: ![alt](url)
    const imgMatch = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imgMatch) {
      flushList();
      elements.push(
        <ImageCard key={`img-${i}`} alt={imgMatch[1]} src={imgMatch[2]} />
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      flushList();
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="border-l-2 border-amber-500/50 pl-3.5 my-2.5 text-zinc-400 italic text-xs leading-relaxed"
        >
          {renderInline(trimmed.replace(/^>\s*/, ''), onOpenFile)}
        </blockquote>
      );
      continue;
    }

    // Headings
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h1 key={`h1-${i}`} className="text-lg font-bold text-white mt-4 mb-2 tracking-tight">
          {renderInline(trimmed.slice(2).trim(), onOpenFile)}
        </h1>
      );
      continue;
    }
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} className="text-base font-bold text-white mt-3.5 mb-1.5 tracking-tight">
          {renderInline(trimmed.slice(3).trim(), onOpenFile)}
        </h2>
      );
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${i}`} className="text-sm font-bold text-amber-300 mt-3 mb-1 tracking-tight">
          {renderInline(trimmed.slice(4).trim(), onOpenFile)}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      flushList();
      elements.push(
        <h4 key={`h4-${i}`} className="text-xs font-semibold text-zinc-100 mt-2.5 mb-1 tracking-tight">
          {renderInline(trimmed.slice(5).trim(), onOpenFile)}
        </h4>
      );
      continue;
    }

    // Unordered list (* item, - item)
    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(ulMatch[1]);
      continue;
    }

    // Ordered list (1. item, 2. item)
    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(olMatch[2]);
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${i}`} className="text-zinc-200 leading-relaxed my-1">
        {renderInline(trimmed, onOpenFile)}
      </p>
    );
  }

  flushList();

  return <>{elements}</>;
}

/**
 * Parses inline markdown:
 * - **bold**
 * - *italic*
 * - `code` (and detects file paths like `06-football-model.md` to make them clickable!)
 * - [label](url)
 */
function renderInline(text: string, onOpenFile?: (path: string) => void): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  // Tokenize ![image](url), `code`, **bold**, *italic*, [link](url)
  const regex = /(!\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith('![') && token.includes('](')) {
      const imgMatch = token.match(/^!\[(.*?)\]\((.*?)\)$/);
      if (imgMatch) {
        tokens.push(
          <ImageCard key={`inline-img-${match.index}`} alt={imgMatch[1]} src={imgMatch[2]} />
        );
      } else {
        tokens.push(token);
      }
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const inner = token.slice(1, -1);
      // Check if the inline code is a file path (e.g. 06-football-model.md, src/App.tsx, kelly.ts)
      const isFilePath = /\.[a-zA-Z0-9_-]+$/.test(inner) || inner.includes('/');

      if (isFilePath && onOpenFile) {
        tokens.push(
          <button
            key={`file-${match.index}`}
            type="button"
            onClick={() => onOpenFile(inner)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-mono text-[12px] font-medium transition cursor-pointer hover:underline mx-0.5 shadow-sm"
            title={`Click to open ${inner}`}
          >
            <span>📄</span>
            <span>{inner}</span>
          </button>
        );
      } else {
        tokens.push(
          <code
            key={`code-${match.index}`}
            className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-amber-300 font-mono text-[12px] font-medium"
          >
            {inner}
          </code>
        );
      }
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(
        <em key={`italic-${match.index}`} className="italic text-zinc-300">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('[') && token.includes('](')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        tokens.push(
          <a
            key={`link-${match.index}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 underline underline-offset-2 hover:text-amber-300 transition"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        tokens.push(token);
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens.length === 1 ? tokens[0] : <>{tokens}</>;
}
