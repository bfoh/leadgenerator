import 'server-only';

import type { DiscoveryProviderAdapter } from './provider';
import { offlineSyntheticProvider } from './offline-provider';

// Only connectors with a reviewed declaration and an implementation belong here. A real provider is
// added only after the owner approves it; no placeholder adapter is registered.
const ADAPTERS: DiscoveryProviderAdapter[] = [offlineSyntheticProvider];

export function discoveryAdapters(): DiscoveryProviderAdapter[] {
  return ADAPTERS;
}

export function discoveryAdapter(id: string): DiscoveryProviderAdapter | null {
  return ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}
