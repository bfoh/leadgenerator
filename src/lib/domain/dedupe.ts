// Duplicate detection for research candidates. Warns rather than blocks: two businesses can
// legitimately share a name.

const STOPWORDS = new Set(['the', 'ltd', 'limited', 'enterprise', 'enterprises', 'ventures', 'company', 'co', 'gh', 'ghana', 'llc', 'inc', 'and']);

export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
    .join(' ')
    .trim();
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function digits(phone: string | null | undefined) {
  const d = (phone ?? '').replace(/\D/g, '');
  // Compare Ghanaian numbers on their last 9 digits so +233 and 0-prefixed forms match.
  return d.length >= 9 ? d.slice(-9) : '';
}

function tokens(name: string) {
  return new Set(normalizeName(name).split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DuplicateCandidate {
  id?: string;
  name: string;
  city: string;
  officialWebsite?: string | null;
  phone?: string | null;
  placesPlaceId?: string | null;
}

export interface DuplicateMatch<T> {
  record: T;
  reasons: string[];
  strength: 'exact' | 'likely' | 'possible';
}

export function findDuplicates<T extends DuplicateCandidate & { id: string }>(candidate: DuplicateCandidate, existing: T[]): DuplicateMatch<T>[] {
  const name = normalizeName(candidate.name);
  const city = candidate.city.trim().toLowerCase();
  const domain = domainOf(candidate.officialWebsite);
  const phone = digits(candidate.phone);
  const candTokens = tokens(candidate.name);
  const matches: DuplicateMatch<T>[] = [];

  for (const record of existing) {
    if (candidate.id && record.id === candidate.id) continue;
    const reasons: string[] = [];
    let strength: DuplicateMatch<T>['strength'] = 'possible';
    const sameCity = record.city.trim().toLowerCase() === city;

    if (candidate.placesPlaceId && record.placesPlaceId === candidate.placesPlaceId) {
      reasons.push('Same Google Place ID');
      strength = 'exact';
    }
    if (name && sameCity && normalizeName(record.name) === name) {
      reasons.push('Same name in the same city');
      if (strength !== 'exact') strength = 'likely';
    } else if (sameCity && jaccard(candTokens, tokens(record.name)) >= 0.6) {
      reasons.push('Similar name in the same city');
    }
    if (domain && domainOf(record.officialWebsite) === domain) {
      reasons.push('Same website domain');
      if (strength === 'possible') strength = 'likely';
    }
    if (phone && digits(record.phone) === phone) {
      reasons.push('Same phone number');
      if (strength === 'possible') strength = 'likely';
    }
    if (reasons.length) matches.push({ record, reasons, strength });
  }

  const rank = { exact: 0, likely: 1, possible: 2 };
  return matches.sort((a, b) => rank[a.strength] - rank[b.strength]);
}
