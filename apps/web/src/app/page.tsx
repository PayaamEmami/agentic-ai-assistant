import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight">Agentic AI Assistant</h1>
        <p className="mt-4 text-lg text-gray-600">
          Your personal AI assistant with voice, tools, and deep context.
        </p>
        <Link
          href="/chat"
          className="mt-8 inline-block rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
        >
          Open Chat
        </Link>
      </div>
    </main>
  );
}
