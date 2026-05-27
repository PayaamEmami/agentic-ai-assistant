'use client';

import { useEffect } from 'react';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import { installGlobalClientErrorHandlers, reportWebVital } from '@/lib/client-logging';

export function ClientLogBootstrap() {
  useEffect(() => {
    installGlobalClientErrorHandlers();
    onCLS(reportWebVital);
    onFCP(reportWebVital);
    onINP(reportWebVital);
    onLCP(reportWebVital);
    onTTFB(reportWebVital);
  }, []);

  return null;
}
