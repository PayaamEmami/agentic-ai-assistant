import { BrowserWorkspace } from '@/components/browser-workspace';

export default async function BrowserSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { sessionId } = await params;
  const { returnTo } = await searchParams;

  return <BrowserWorkspace sessionId={sessionId} returnToChatUrl={returnTo ?? null} />;
}
