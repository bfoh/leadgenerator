import 'server-only';

import { demoProvider } from './demo-provider';
import { googlePlacesProvider } from './google-places';
import type { DiscoveryProvider } from './discovery';

const PROVIDERS: DiscoveryProvider[] = [googlePlacesProvider, demoProvider];

export function discoveryProviders() {
  return PROVIDERS;
}

export function discoveryProvider(id: string) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}
