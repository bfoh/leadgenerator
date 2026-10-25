import 'server-only';
import { extractResourceOfferings, type GoogleResourceListing, type WebsiteResources } from '@/lib/domain/business-resources';
import { extractPageFacts } from '@/lib/domain/page-signals';
import { extractContacts } from '@/lib/domain/contact-extraction';
import type { RequestContext } from './context';
import { enforceBudget } from './budget';
import { serverEnv } from './env';
import { HttpError } from './http';
import { googleResourceDetails, googleResourcePhoto, googleResourceSearch } from './providers/google-places';
import { enforceQuota, paidCall } from './usage';

export function resourceGoogleStatus() {
  const simulated = serverEnv.simulateExternalTools();
  return { simulated, enabled: simulated || (process.env.RESOURCE_GOOGLE_ENABLED === 'true' && Boolean(serverEnv.placesKey())),
    detailsMaxUsd: Math.max(0.05, serverEnv.cost.placesDetails()), searchMaxUsd: Math.max(0.05, serverEnv.cost.placesSearch()), photoMaxUsd: Math.max(0.01, serverEnv.cost.placesPhoto()) };
}

export function simulatedResourceListing(id: string): GoogleResourceListing {
  return { id, name: 'Fictional Coast Bakery', address: '12 Sample Lane, Cape Coast', phone: '+233 24 000 0100',
    website: id.endsWith('with_website') ? 'https://resource-bakery.example.org' : null,
    mapsUri: 'https://www.google.com/maps', directionsUri: null, hours: ['Monday–Friday: 8:00 AM–5:00 PM'], status: 'OPERATIONAL',
    photos: [{ name: `places/${id}/photos/fictional_sample`, width: 800, height: 500, googleMapsUri: 'https://www.google.com/maps', authors: [{ name: 'Original test illustration — simulated photo', uri: null, photoUri: null }] }],
    attributions: [], simulated: true };
}

export function simulatedResourceWebsite(url: string): WebsiteResources {
  const html = `<html lang="en"><head><title>Fictional Resources Bakery</title><link rel="icon" href="/favicon.png"><meta name="theme-color" content="#24564a"><style>body{color:#24564a;font-family:Arial,sans-serif}</style></head><body><h1>Fictional Resources Bakery</h1><img src="/owner-logo.png" alt="Bakery logo"><img src="/bread.png" alt="Bread product photograph"><a href="/services">Bespoke baking</a><a href="/products">Bread and pastry</a><a href="tel:+233241234567">Call</a><a href="mailto:hello@resource-bakery.example.org">Email</a><a href="https://www.instagram.com/fictionalresourcebakery">Instagram</a><script type="application/ld+json">{"@type":"Service","name":"Celebration baking","description":"Fictional owner service candidate for permission review."}</script></body></html>`;
  return { url, facts: extractPageFacts(html, url), contacts: extractContacts(html, url), offerings: extractResourceOfferings(html), simulated: true, error: null };
}

/** User-initiated only; the ledger holds cost/operation metadata, never provider response content. */
async function googleCall<T>(ctx: RequestContext, kind: 'details' | 'search' | 'photo', send: () => Promise<T>) {
  const status = resourceGoogleStatus();
  if (!status.enabled) throw new HttpError(503, 'Live resource lookup is disabled. Configure the server key and RESOURCE_GOOGLE_ENABLED after reviewing billing and applicable Google terms.');
  if (ctx.mode === 'demo' && !status.simulated) throw new HttpError(403, 'Live collector calls require an authenticated workspace.');
  const maxCostUsd = status[`${kind}MaxUsd`];
  const operation = `resource_places_${kind}`;
  await enforceQuota(ctx, `${operation}:sent`, kind === 'photo' ? 120 : 30);
  await enforceBudget(ctx, { google_places: maxCostUsd });
  return (await paidCall(ctx, { provider: 'google_places', operation, maxCostUsd }, send, () => ({ estimatedCostUsd: maxCostUsd }))).result;
}

export async function collectGoogleListing(ctx: RequestContext, id: string) {
  if (serverEnv.simulateExternalTools()) return simulatedResourceListing(id);
  return googleCall(ctx, 'details', () => googleResourceDetails(id));
}
export async function collectGooglePhoto(ctx: RequestContext, name: string) {
  if (serverEnv.simulateExternalTools()) return '/resource-samples/shopfront.svg';
  return googleCall(ctx, 'photo', () => googleResourcePhoto(name));
}
export async function searchResourcePlaces(ctx: RequestContext, query: string, country: string) {
  if (serverEnv.simulateExternalTools()) return [{ id: 'fictional_place_no_website', name: 'Fictional Coast Bakery', address: '12 Sample Lane, Cape Coast' }, { id: 'fictional_place_with_website', name: 'Fictional Coast Bakery Studio', address: '14 Sample Lane, Cape Coast' }];
  return googleCall(ctx, 'search', () => googleResourceSearch(query, country));
}
