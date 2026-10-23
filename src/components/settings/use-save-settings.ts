'use client';

import { useQueryClient } from '@tanstack/react-query';
import * as svc from '@/lib/data/services';
import { useAction } from '@/lib/workspace/hooks';

/** Saves settings; a rename also refreshes the cached workspace so the sidebar shows it. */
export function useSaveSettings(success = 'Settings saved') {
  const qc = useQueryClient();
  return useAction(svc.saveSettings, {
    success: (r) => (r.rescored ? `${success} · ${r.rescored} prospects rescored` : success),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace'] }),
  });
}
