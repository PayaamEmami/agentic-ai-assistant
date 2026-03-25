'use client';

import { useEffect } from 'react';
import { installGlobalClientErrorHandlers } from '@/lib/client-logging';

export function ClientLogBootstrap() {
  useEffect(() => {
    installGlobalClientErrorHandlers();
  }, []);

  return null;
}
