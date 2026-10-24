'use client';

import { useQuery } from '@tanstack/react-query';
import type { DataStore } from '@/lib/data/store';
import type { UsageInsert } from '@/lib/domain/types';

// Typed calls to this app's route handlers. Secrets stay on the server; the browser only sees
// results and configuration booleans.

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  capabilities: { search: boolean; details: boolean; websiteField: boolean; phoneInDetails: boolean; maxPageSize: number; isDemo: boolean };
  attribution: { text: string; url: string | null; notes: string };
  retention: { storableFields: string[]; displayOnlyFields: string[]; cacheSeconds: number; policyUrl: string | null; notes: string };
  estimatedCostUsd: { search: number; details: number };
}

export interface ServerStatus {
  mode: 'demo' | 'cloud';
  serverTools: boolean;
  ai: { configured: boolean; model: string | null };
  webSearch: { configured: boolean; name: string };
  discovery: ProviderInfo[];
  /** Autonomous discovery connector state (absent on older servers). */
  autonomousDiscovery?: { syntheticEnabled: boolean };
  quotas: { discovery: number; aiReports: number; websiteChecks: number; webSearch: number };
  automation?: { backgroundWorker: boolean; outboundSending: boolean };
  /** Website verification tools (absent on servers older than phase 3). */
  research?: { simulated: boolean; search: { configured: boolean; provider: string | null; costPerQueryUsd: number } };
  /** Contact research tools and licensed contact-data providers (absent on servers older than phase 4). */
  contacts?: { simulated: boolean; mxLookupQuota: number; providers: ContactProviderInfo[] };
}

export interface ContactProviderInfo {
  id: string;
  name: string;
  sourceType: string;
  configured: boolean;
  storagePermitted: boolean;
  marketingUsePermitted: boolean;
  licenceReviewedAt: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, credentials: 'same-origin' });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError('Network error. Check your connection and try again.', 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new ApiError(body?.error ?? `Request failed (${res.status}).`, res.status);
  return body;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown, signal?: AbortSignal) => request<T>(url, { method: 'POST', body: JSON.stringify(body), signal }),
  patch: <T>(url: string, body: unknown) => request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};

/** In demo mode the server cannot write to browser storage, so charges are recorded client-side. */
export async function recordCharge(store: DataStore, usage: UsageInsert | null | undefined) {
  if (store.mode !== 'demo' || !usage) return;
  try {
    await store.recordUsage({ ...usage, metadata: usage.metadata ?? null });
  } catch {
    // Usage display is informational in demo mode; never block the action on it.
  }
}

export function useServerStatus() {
  return useQuery({ queryKey: ['server-status'], queryFn: () => api.get<ServerStatus>('/api/status'), staleTime: 5 * 60_000 });
}
