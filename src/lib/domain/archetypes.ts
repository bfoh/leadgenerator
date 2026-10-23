// Reusable website solution library. Archetypes describe typical structures; briefs generated
// from them are starting points for design work, not finished websites.

export interface Archetype {
  key: string;
  name: string;
  targetBusiness: string;
  pages: string[];
  features: string[];
  designDirection: string;
  integrations: string[];
  clientAssets: string[];
  complexity: 'Low' | 'Medium' | 'High';
  phases: string[];
  reference?: { label: string; url: string; note: string };
}

export const ARCHETYPES: Archetype[] = [
  {
    key: 'fashion-editorial',
    name: 'Fashion editorial website',
    targetBusiness: "Fashion boutiques and men's suit retailers",
    pages: ['Home (campaign hero)', 'Collections', 'Product detail', 'Lookbook', 'About / atelier story', 'Visit the store', 'Contact'],
    features: ['Editorial typography and full-bleed imagery', 'Collection filtering', 'WhatsApp product enquiry', 'Size guide', 'Optional checkout'],
    designDirection: 'Luxury editorial: generous whitespace, serif display type, restrained palette, cinematic scroll reveals that respect reduced-motion settings.',
    integrations: ['WhatsApp click-to-chat', 'Instagram embed (business account)', 'Paystack / Hubtel checkout (optional)', 'Analytics'],
    clientAssets: ['Logo and brand colours', 'Professional product and campaign photography', 'Collection names and descriptions', 'Store address and hours'],
    complexity: 'Medium',
    phases: ['Brand & content audit', 'Art direction & key layouts', 'Build & motion', 'Content load, QA, launch'],
    reference: {
      label: 'Digne Suits & More (concept prototype)',
      url: 'https://digne-ashy.vercel.app/',
      note: 'Internal creative reference inspired by Edit Suits Co. It is a prototype, not a client case study — do not present it as commissioned work.',
    },
  },
  {
    key: 'furniture-catalogue',
    name: 'Furniture catalogue',
    targetBusiness: 'Furniture showrooms and interior stores',
    pages: ['Home', 'Categories (living, bedroom, dining, office)', 'Product detail with dimensions', 'Custom orders', 'Delivery information', 'Showroom visit', 'Contact'],
    features: ['Catalogue with filters (room, material, price band)', 'Quote request builder', 'Stock status', 'Delivery-area checker'],
    designDirection: 'Warm, tactile and calm: neutral palette, large product imagery, clear specification tables.',
    integrations: ['Inventory spreadsheet or POS import', 'WhatsApp enquiries', 'Optional checkout'],
    clientAssets: ['Product list with dimensions and materials', 'Product photography', 'Delivery zones and fees'],
    complexity: 'Medium',
    phases: ['Catalogue structure', 'Design', 'Build & data import', 'QA & launch'],
  },
  {
    key: 'bridal-portfolio',
    name: 'Bridal portfolio',
    targetBusiness: 'Bridal shops and occasionwear boutiques',
    pages: ['Home', 'Lookbook', 'Collections', 'Book a fitting', 'Testimonials (with permission)', 'Contact'],
    features: ['Lookbook galleries', 'Appointment request with preferred dates', 'Rental vs purchase information'],
    designDirection: 'Romantic and light: soft palette, elegant serif headings, full-screen imagery.',
    integrations: ['Calendar booking (e.g. Cal.com)', 'WhatsApp', 'Instagram'],
    clientAssets: ['Lookbook photography', 'Collection details', 'Appointment policies'],
    complexity: 'Low',
    phases: ['Content plan', 'Design', 'Build', 'Launch'],
  },
  {
    key: 'beauty-booking',
    name: 'Beauty booking website',
    targetBusiness: 'Salons, spas, barbers and gyms',
    pages: ['Home', 'Services & prices', 'Book now', 'Portfolio', 'Team', 'Contact'],
    features: ['Service menu', 'Online booking with deposits', 'Staff selection', 'Reminders (with consent)'],
    designDirection: 'Fresh and confident: bright accents, strong service hierarchy, mobile-first booking flow.',
    integrations: ['Booking platform or custom scheduler', 'Mobile money / card deposits', 'WhatsApp'],
    clientAssets: ['Service list with durations and prices', 'Portfolio photos', 'Staff profiles'],
    complexity: 'Medium',
    phases: ['Service mapping', 'Design', 'Booking integration', 'Launch'],
  },
  {
    key: 'hotel-reservation',
    name: 'Hotel reservation website',
    targetBusiness: 'Hotels, guesthouses and lodges',
    pages: ['Home', 'Rooms', 'Room detail', 'Facilities', 'Location & attractions', 'Book', 'Contact'],
    features: ['Room showcase', 'Availability and booking engine', 'Direct-booking offers', 'Multi-currency display'],
    designDirection: 'Immersive and trustworthy: photography-led, clear rates and policies, prominent booking call-to-action.',
    integrations: ['Booking engine / channel manager', 'Payment gateway', 'Google Business Profile links'],
    clientAssets: ['Room photography and descriptions', 'Rates and policies', 'Facilities list'],
    complexity: 'High',
    phases: ['Discovery & channel review', 'Design', 'Booking integration', 'Testing & launch'],
  },
  {
    key: 'restaurant-ordering',
    name: 'Restaurant ordering website',
    targetBusiness: 'Restaurants, cafés and bakeries',
    pages: ['Home', 'Menu', 'Order online', 'Reservations', 'Catering', 'Location & hours'],
    features: ['Digital menu', 'Online ordering (pickup/delivery)', 'Reservations', 'Daily specials'],
    designDirection: 'Appetising and fast: food photography, simple ordering flow, very quick mobile load.',
    integrations: ['Ordering system', 'Mobile money / card payments', 'Delivery partner links'],
    clientAssets: ['Menu with prices', 'Food photography', 'Opening hours and delivery zones'],
    complexity: 'Medium',
    phases: ['Menu structure', 'Design', 'Ordering integration', 'Launch'],
  },
  {
    key: 'auto-dealership',
    name: 'Auto dealership website',
    targetBusiness: 'Car dealerships and auto traders',
    pages: ['Home', 'Inventory', 'Vehicle detail', 'Financing', 'Trade-in', 'Test drive', 'Contact'],
    features: ['Searchable inventory', 'Vehicle detail with specifications', 'Test-drive booking', 'Lead capture'],
    designDirection: 'Bold and technical: dark surfaces, strong imagery, clear specification hierarchy.',
    integrations: ['Inventory management', 'CRM', 'WhatsApp'],
    clientAssets: ['Vehicle data and photos', 'Financing partners and terms'],
    complexity: 'High',
    phases: ['Inventory model', 'Design', 'Build & import', 'Launch'],
  },
  {
    key: 'corporate',
    name: 'Corporate website',
    targetBusiness: 'Professional services, training institutions, event planners and studios',
    pages: ['Home', 'About', 'Services', 'Case studies (with client permission)', 'Team', 'Insights', 'Contact'],
    features: ['Service pages', 'Consultation requests', 'Content management', 'Lead routing'],
    designDirection: 'Clear and credible: structured layouts, restrained colour, strong typography.',
    integrations: ['CRM or email', 'Calendar booking', 'Analytics'],
    clientAssets: ['Service descriptions', 'Team bios and photos', 'Approved client references'],
    complexity: 'Low',
    phases: ['Content plan', 'Design', 'Build', 'Launch'],
  },
];

export function archetypeByKey(key: string) {
  return ARCHETYPES.find((a) => a.key === key) ?? null;
}

/** A structured brief suitable for pasting into Claude Code. Contains only recorded facts. */
export function designBrief(a: Archetype, business?: { name: string; category: string; city: string; notes?: string; needs?: string[] }) {
  return [
    `# Design brief — ${business ? business.name : a.name}`,
    '',
    business ? `Business: ${business.name} (${business.category}, ${business.city}). Use only facts confirmed with the business; mark everything else as placeholder content.` : `Archetype: ${a.targetBusiness}.`,
    '',
    '## Goal',
    `Build a ${a.name.toLowerCase()} concept as a Next.js App Router project with TypeScript and Tailwind CSS. Treat this as a proposal concept, not a production launch.`,
    '',
    '## Pages',
    ...a.pages.map((p) => `- ${p}`),
    '',
    '## Features',
    ...a.features.map((f) => `- ${f}`),
    ...(business?.needs?.length ? ['', '## Confirmed business needs', ...business.needs.map((n) => `- ${n}`)] : []),
    '',
    '## Design direction',
    a.designDirection,
    '',
    '## Integrations (stub in the concept)',
    ...a.integrations.map((i) => `- ${i}`),
    '',
    '## Content',
    'Use clearly labeled placeholder text and imagery. Do not invent prices, testimonials, awards or client names.',
    ...a.clientAssets.map((c) => `- Needed from client: ${c}`),
    '',
    '## Quality bar',
    '- Mobile-first, responsive, accessible (WCAG 2.2 AA), respects prefers-reduced-motion',
    '- Lighthouse performance ≥ 90 on mobile',
    ...(a.reference ? ['', '## Creative reference', `${a.reference.label}: ${a.reference.url} — ${a.reference.note}`] : []),
  ].join('\n');
}
