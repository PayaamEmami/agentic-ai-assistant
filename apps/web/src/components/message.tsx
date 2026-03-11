interface MessageProps {
  role: 'user' | 'assistant';
  text: string;
}

export function Message({ role, text }: MessageProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-lg px-4 py-2 text-sm ${
          isUser ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-900'
        }`}
      >
        {text}
      </div>
    </div>
  );
}
