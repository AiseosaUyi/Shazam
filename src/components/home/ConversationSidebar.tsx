'use client';

import React from 'react';
import Link from 'next/link';
import { Plus, Search, Layers, Sparkles, MessageSquare, Trash2 } from 'lucide-react';

export interface ConversationItem {
  id: string;
  title: string;
  projectId?: string | null;
  updatedAt: string;
}

export function ConversationSidebar({
  sidebarOpen,
  setSidebarOpen,
  user,
  conversations,
  currentConvId,
  searchQuery,
  setSearchQuery,
  onNewChat,
  onOpenLibrary,
  onSelectConversation,
  onDeleteConversation,
}: {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  user: { email: string; name?: string; role?: string } | null;
  conversations: ConversationItem[];
  currentConvId: string | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onNewChat: () => void;
  onOpenLibrary: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (e: React.MouseEvent, id: string) => void;
}) {
  return (
  <aside
    className={`fixed inset-y-0 left-0 z-40 w-64 bg-sidebar border-r border-line/[0.06] flex flex-col transition-transform duration-200 md:static md:translate-x-0 select-none ${
      sidebarOpen ? 'translate-x-0' : '-translate-x-full'
    }`}
  >
    {/* Top: New chat, search, library (Claude-style) */}
    <div className="space-y-0.5 p-3">
      <button onClick={onNewChat} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface-2">
        <Plus className="h-4 w-4 text-brand" /> New chat
      </button>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-ink-3" />
        <input
          type="text"
          placeholder="Search chats"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl bg-transparent py-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-2 hover:bg-surface-2/60 focus:bg-surface-2 focus:outline-none"
        />
      </div>
      <button type="button" onClick={onOpenLibrary} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2/60 hover:text-ink">
        <Layers className="h-4 w-4" /> Library
      </button>
    </div>

    {/* Conversations History: Pinned & Recents */}
    <div className="flex-1 overflow-y-auto p-2 space-y-3">
      <div className="px-2 py-1 text-[10px] font-bold text-ink-3">
        Recents
      </div>

      <div className="space-y-0.5">
        {!user ? (
          <div className="p-3 mx-1 my-2 rounded-xl bg-line/[0.02] border border-line/[0.06] text-center">
            <Sparkles className="w-4 h-4 text-brand mx-auto mb-1.5" />
            <p className="text-xs font-medium text-ink">Guest Session</p>
            <p className="text-[11px] text-ink-2 mt-1 mb-2.5 leading-relaxed">
              Sign in to save and sync your conversations across devices.
            </p>
            <Link
              href="/login"
              className="inline-block px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs transition shadow-sm"
            >
              Sign In
            </Link>
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-ink-3">
            No conversations yet
          </div>
        ) : (
          conversations
            .filter((c) => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((conv) => (
              <div
                key={conv.id}
                onClick={() => {
                  onSelectConversation(conv.id);
                  setSidebarOpen(false);
                }}
                className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                  currentConvId === conv.id
                    ? 'bg-brand/10 text-brand-soft font-medium'
                    : 'text-ink-2 hover:bg-line/[0.03] hover:text-ink'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{conv.title}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => onDeleteConversation(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-ink-3 hover:text-red-400 transition rounded"
                  title="Delete chat"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
        )}
      </div>
    </div>

  </aside>
  );
}
