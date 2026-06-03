import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from '@/components/layout/app-providers';
import { ClientLogBootstrap } from '@/components/layout/client-log-bootstrap';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'Agentic AI Assistant',
  description: 'AI assistant with multi-modal support',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>
          <AppProviders>{children}</AppProviders>
        </AuthProvider>
        <ClientLogBootstrap />
      </body>
    </html>
  );
}
