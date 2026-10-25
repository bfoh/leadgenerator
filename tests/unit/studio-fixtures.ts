import type { PageFacts } from '@/lib/domain/page-signals';

// One fictional Ghanaian fashion business, used by the Studio tests. The page facts describe what a
// homepage reading would return for a small atelier running a dated template site: some real contact
// routes, a stale footer, photographs served from a website-builder CDN, and gaps the business must
// answer for itself. Nothing here is a real company.

export const FASHION_BUSINESS = {
  name: 'Nsroma Atelier',
  category: 'Fashion and tailoring',
  city: 'Accra',
};

export const SITE_URL = 'https://nsromaatelier.example';

export const TODAY = '2026-10-25T09:00:00.000Z';

/** A homepage that is readable, dated, and partly silent — the ordinary case for a Studio concept. */
export function fashionFacts(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    title: 'Nsroma Atelier | Bespoke Kente & Kaba',
    description: 'Hand-finished kente and kaba for weddings, naming ceremonies and everyday wear in Accra.',
    siteName: 'Nsroma Atelier',
    h1: ['Bespoke kente, sewn in Osu'],
    lang: 'en-GH',
    generator: 'Wix.com Website Builder',
    hasViewport: true,
    hasCanonical: true,
    schemaTypes: ['ClothingStore', 'LocalBusiness'],
    schemaNames: ['Nsroma Atelier'],
    schemaLocality: 'Accra',
    socialLinks: [
      { platform: 'instagram', url: 'https://instagram.com/nsromaatelier' },
      { platform: 'facebook', url: 'https://facebook.com/nsromaatelier' },
    ],
    outboundSites: [],
    favicon: 'https://static.wixstatic.com/media/nsroma-favicon.png',
    themeColor: '#7a1f3d',
    fonts: ['Playfair Display', 'Lato'],
    colors: ['#7a1f3d', '#f7f1e8', '#1f1a17'],
    navLinks: [
      { url: `${SITE_URL}/`, label: 'Home', category: 'home' },
      { url: `${SITE_URL}/shop`, label: 'Shop', category: 'products' },
      { url: `${SITE_URL}/lookbook`, label: 'Lookbook', category: 'gallery' },
      { url: `${SITE_URL}/contact`, label: 'Contact', category: 'contact' },
    ],
    logoCandidates: [
      { url: 'https://static.wixstatic.com/media/nsroma-logo.png', alt: 'Nsroma Atelier', role: 'logo' },
    ],
    imageCandidates: [
      { url: 'https://static.wixstatic.com/media/kente-gown.jpg', alt: 'Model in a teal kente gown' },
      { url: 'https://static.wixstatic.com/media/kaba-set.jpg', alt: 'Kaba and slit set on a mannequin' },
    ],
    hasTelLink: true,
    hasMailtoLink: false,
    hasWhatsAppLink: true,
    formCount: 1,
    insecureFormAction: false,
    booking: false,
    catalogue: true,
    commerce: false,
    copyrightYear: 2021,
    parked: false,
    placeholder: false,
    wordCount: 340,
    ...overrides,
  };
}

/** A page that says almost nothing: every gap must become an `unknown`, never a guess. */
export function silentFacts(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    title: null,
    description: null,
    siteName: null,
    h1: [],
    lang: null,
    generator: null,
    hasViewport: false,
    hasCanonical: false,
    schemaTypes: [],
    schemaNames: [],
    schemaLocality: null,
    socialLinks: [],
    outboundSites: [],
    favicon: null,
    themeColor: null,
    fonts: [],
    colors: [],
    navLinks: [],
    logoCandidates: [],
    imageCandidates: [],
    hasTelLink: false,
    hasMailtoLink: false,
    hasWhatsAppLink: false,
    formCount: 0,
    insecureFormAction: false,
    booking: false,
    catalogue: false,
    commerce: false,
    copyrightYear: null,
    parked: false,
    placeholder: false,
    wordCount: 24,
    ...overrides,
  };
}
