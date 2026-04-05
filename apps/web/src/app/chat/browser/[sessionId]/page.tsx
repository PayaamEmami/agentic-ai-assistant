import { BrowserWorkspace } from '@/components/browser-workspace';

export default async function BrowserSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return <BrowserWorkspace sessionId={sessionId} />;
}
