// Classifies a link a listing calls its "website". Directory website fields often hold a social
// profile or link-in-bio page, which is not an official website.

const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'wa.me',
  'whatsapp.com',
  'snapchat.com',
  'pinterest.com',
  'linktr.ee',
  'beacons.ai',
  'jumia.com.gh',
];

export type ListedLinkKind = 'none' | 'website' | 'social';

export function classifyListedLink(url: string | null | undefined): ListedLinkKind {
  if (!url) return 'none';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  } catch {
    return 'website';
  }
  return SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? 'social' : 'website';
}
