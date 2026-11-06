'use client';

import { Sparkles, Cpu, Copy, Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
  taskId?: string | null;
  routeInfo?: any;
}

interface MessageThreadProps {
  messages: Message[];
  copiedId: string | null;
  feedbackSent: Record<string, number>;
  isStreaming: boolean;
  activeRouteInfo: any;
  streamingReasoning: string;
  streamingText: string;
  handleCopy: (text: string, id: string) => void;
  handleFeedback: (taskId: string, rating: number) => void;
}

export function MessageThread({
  messages,
  copiedId,
  feedbackSent,
  isStreaming,
  activeRouteInfo,
  streamingReasoning,
  streamingText,
  handleCopy,
  handleFeedback,
}: MessageThreadProps) {
  return (
  <div className="max-w-3xl mx-auto space-y-6 pb-28">
    {messages.map((msg) => (
      <div
        key={msg.id}
        className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
      >
        {/* User Bubble */}
        {msg.role === 'user' ? (
          <div className="max-w-2xl rounded-2xl rounded-tr-sm px-4.5 py-3 text-sm bg-surface-2/90 text-ink border border-line/10 shadow-sm leading-relaxed whitespace-pre-wrap">
            {msg.content}
          </div>
        ) : (
          /* Assistant Bubble */
          <div className="w-full space-y-3">
            <div className="flex items-center gap-2 text-xs text-ink-2">
              <div className="w-5 h-5 rounded-md bg-brand/20 border border-brand/30 flex items-center justify-center text-brand">
                <Sparkles className="w-3 h-3" />
              </div>
              <span className="font-medium text-ink-2">
                {msg.routeInfo?.model?.name || 'Arcwork'}
              </span>
              {msg.routeInfo?.route?.costClass && (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono border border-emerald-500/20">
                  {msg.routeInfo.route.costClass}
                </span>
              )}
              {msg.routeInfo?.fallback && (
                <span className="px-2 py-0.5 rounded-full bg-brand/10 text-brand-soft text-[10px] font-mono border border-brand/20" title={msg.routeInfo.fallback.reason || 'Primary provider unavailable'}>
                  fallback
                </span>
              )}
            </div>

            {/* Reasoning Drawer */}
            {msg.reasoning && (
              <details className="rounded-xl bg-line/[0.02] border border-line/[0.06] overflow-hidden text-ink-2">
                <summary className="px-3.5 py-2 cursor-pointer text-xs font-mono text-ink-2 hover:text-ink flex items-center gap-2 select-none">
                  <Cpu className="w-3.5 h-3.5 text-brand" />
                  <span>View model thought process</span>
                </summary>
                <div className="p-3.5 text-xs font-mono text-ink-2 whitespace-pre-wrap border-t border-line/[0.06] bg-black/20">
                  {msg.reasoning}
                </div>
              </details>
            )}

            <div>
              <MarkdownRenderer content={msg.content} />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-line/5 text-xs text-ink-3">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleCopy(msg.content, msg.id)}
                  title="Copy response"
                  className="p-1.5 text-ink-2 hover:text-ink rounded-lg hover:bg-line/5 transition"
                >
                  {copiedId === msg.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                {msg.taskId && (
                  <>
                    <button
                      onClick={() => handleFeedback(msg.taskId!, 1)}
                      title="Helpful"
                      className={`p-1.5 rounded-lg hover:bg-line/5 transition ${
                        feedbackSent[msg.taskId!] === 1
                          ? 'text-emerald-400'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleFeedback(msg.taskId!, -1)}
                      title="Not helpful"
                      className={`p-1.5 rounded-lg hover:bg-line/5 transition ${
                        feedbackSent[msg.taskId!] === -1
                          ? 'text-red-400'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    ))}

    {/* Streaming Assistant Card */}
    {isStreaming && (
      <div className="w-full space-y-3 pt-2">
        <div className="flex items-center gap-2 text-xs text-ink-2">
          <div className="w-5 h-5 rounded-md bg-brand/20 border border-brand/30 flex items-center justify-center text-brand">
            <Sparkles className="w-3 h-3 animate-pulse" />
          </div>
          <span className="font-medium text-ink-2">
            {activeRouteInfo?.model?.name || 'Evaluating optimum model...'}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-brand animate-ping" />
        </div>

        {streamingReasoning && (
          <div className="p-3.5 rounded-xl bg-line/[0.02] border border-line/[0.06] text-xs font-mono text-ink-2 whitespace-pre-wrap max-h-36 overflow-y-auto">
            <div className="text-[10px] font-semibold text-brand mb-1 flex items-center gap-1.5">
              <Cpu className="w-3 h-3" /> Thinking:
            </div>
            {streamingReasoning}
          </div>
        )}

        {streamingText ? (
          <div>
            <MarkdownRenderer content={streamingText} />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-ink-2 text-xs py-2">
            <span className="inline-block w-2 h-4 bg-brand animate-pulse rounded-sm" />
            <span>Streaming response tokens...</span>
          </div>
        )}
      </div>
    )}
  </div>
  );
}
