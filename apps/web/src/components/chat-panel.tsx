import { Message } from './message';

export function ChatPanel() {
  // TODO: load messages from conversation state
  const messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }> = [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center h-full">
          <p className="text-gray-400">Start a conversation</p>
        </div>
      ) : (
        messages.map((msg) => <Message key={msg.id} role={msg.role} text={msg.text} />)
      )}
    </div>
  );
}
