'use client';

import { useChatContext } from '@/lib/chat-context';

export function Sidebar() {
  const { conversations, currentConversationId, loading, selectConversation } = useChatContext();

  return (
    <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <button
          onClick={() => void selectConversation(undefined)}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          title="New conversation"
        >
          <PlusIcon />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {loading.isLoadingConversations && conversations.length === 0 ? (
          <p className="p-2 text-sm text-gray-400">Loading conversations...</p>
        ) : conversations.length === 0 ? (
          <p className="p-2 text-sm text-gray-400">No conversations yet</p>
        ) : (
          conversations.map((conversation) => {
            const isActive = currentConversationId === conversation.id;
            return (
              <button
                key={conversation.id}
                onClick={() => void selectConversation(conversation.id)}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <p className="truncate">{conversation.title ?? 'Untitled conversation'}</p>
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
