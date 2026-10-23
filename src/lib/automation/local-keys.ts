// Browser-storage key for the demo automation queue, kept dependency-free so the demo data store can
// clear a deleted prospect's jobs and runs (the database cascades the same way) without an import cycle.

export const AUTOMATION_KEY = 'dof-v7-automation';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function forgetBusinessAutomation(storage: StorageLike | null, businessId: string) {
  try {
    const raw = storage?.getItem(AUTOMATION_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as { jobs?: { businessId: string | null }[]; runs?: { businessId: string | null }[] };
    state.jobs = (state.jobs ?? []).filter((j) => j.businessId !== businessId);
    state.runs = (state.runs ?? []).filter((r) => r.businessId !== businessId);
    storage!.setItem(AUTOMATION_KEY, JSON.stringify(state));
  } catch {
    // Automation history is secondary to the deletion itself.
  }
}
