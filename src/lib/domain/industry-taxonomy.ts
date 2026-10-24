// Ghana-wide industry taxonomy: 30 industry groups covering the businesses the agency meets in the
// field, from chop bars and su-su collectors to software firms and small-scale miners.
//
// Rules this file holds itself to:
// • `label` is what a person sees and what is stored in `businesses.category`. Labels are the stable
//   identifier at the database level (the column is free text, 80 characters), so a label is never
//   edited to mean something else — add a new label instead.
// • `id` is a slug of the label, used for URL-safe references and lookups. It is derived, never typed.
// • `searchTerm` is the phrase sent to a discovery provider when nobody typed custom terms. It is a
//   plain-English (or widely used local) search phrase, not a claim about any business.
// • `placesTypes` may only contain verified Google Places API (New) *Table A* identifiers from
//   `places-types.ts`. An empty list is honest: the text query is the fallback, never a guess.
// • The twenty categories that existed before this expansion keep their exact labels, so every saved
//   prospect still resolves to the same track, template and report guidance.

import type { PlacesType } from './places-types';

export const TRACK_KEYS = [
  'fashion',
  'bridal',
  'furniture',
  'beauty',
  'hospitality',
  'food',
  'auto',
  'events',
  'creative',
  'fitness',
  'education',
  'professional',
  'health',
  'pharmacy',
  'agriculture',
  'livestock',
  'finance',
  'ict',
  'construction',
  'real_estate',
  'mining_energy',
  'manufacturing',
  'logistics',
  'retail',
  'wholesale',
  'facilities',
  'environment',
  'nonprofit',
  'general',
] as const;

export type TrackKey = (typeof TRACK_KEYS)[number];

export interface IndustryGroup {
  key: string;
  label: string;
  /** One line, shown under the group in a picker. */
  description: string;
  /** Search phrase used when the whole group is researched rather than one category. */
  searchTerm: string;
  /** The default track for the group; each category states its own, which may differ. */
  track: TrackKey;
}

export const INDUSTRY_GROUPS = [
  {
    key: 'agriculture',
    label: 'Agriculture & Crop Farming',
    description: 'Crop farms, plantations and the suppliers that serve them.',
    searchTerm: 'agricultural farm',
    track: 'agriculture',
  },
  {
    key: 'livestock',
    label: 'Livestock, Poultry & Fisheries',
    description: 'Animal farms, hatcheries, fisheries and veterinary services.',
    searchTerm: 'livestock and poultry farm',
    track: 'livestock',
  },
  {
    key: 'food',
    label: 'Food, Drink & Catering',
    description: 'Eateries, local kitchens, bakeries, bars, catering and delivery.',
    searchTerm: 'food and drink business',
    track: 'food',
  },
  {
    key: 'hospitality',
    label: 'Hotels, Lodging & Tourism',
    description: 'Hotels, guesthouses, short lets, travel and visitor experiences.',
    searchTerm: 'hotel and lodging',
    track: 'hospitality',
  },
  {
    key: 'retail',
    label: 'Retail & General Merchandise',
    description: 'Shops and stores selling goods directly to the public.',
    searchTerm: 'retail shop',
    track: 'retail',
  },
  {
    key: 'wholesale',
    label: 'Wholesale, Distribution & Trade',
    description: 'Distributors, importers, commodity traders and bulk suppliers.',
    searchTerm: 'wholesale distributor',
    track: 'wholesale',
  },
  {
    key: 'markets',
    label: 'Markets & Street Trading',
    description: 'Market traders, foodstuff sellers, hawkers and street vendors.',
    searchTerm: 'market trader',
    track: 'retail',
  },
  {
    key: 'fashion',
    label: 'Fashion, Tailoring & Textiles',
    description: 'Boutiques, tailors, weavers, textile merchants and leatherwork.',
    searchTerm: 'fashion and tailoring',
    track: 'fashion',
  },
  {
    key: 'beauty',
    label: 'Beauty, Barbering & Wellness',
    description: 'Salons, barbers, nails, makeup, spa and personal care.',
    searchTerm: 'beauty salon and barber',
    track: 'beauty',
  },
  {
    key: 'health',
    label: 'Health & Medical Services',
    description: 'Clinics, hospitals, diagnostics, therapy and medical supply.',
    searchTerm: 'health facility',
    track: 'health',
  },
  {
    key: 'pharmacy',
    label: 'Pharmacy & Chemical Shops',
    description: 'Pharmacies, licensed chemical sellers and medicine shops.',
    searchTerm: 'pharmacy',
    track: 'pharmacy',
  },
  {
    key: 'education',
    label: 'Education & Training',
    description: 'Schools, creches, vocational institutes, tutors and exam centres.',
    searchTerm: 'school and training centre',
    track: 'education',
  },
  {
    key: 'professional',
    label: 'Professional & Business Services',
    description: 'Law, accounting, consulting, design, recruitment and support offices.',
    searchTerm: 'professional services firm',
    track: 'professional',
  },
  {
    key: 'finance',
    label: 'Financial Services & Savings',
    description: 'Banks, microfinance, su-su collectors, insurance and payments.',
    searchTerm: 'financial services',
    track: 'finance',
  },
  {
    key: 'ict',
    label: 'ICT, Software & Digital Services',
    description: 'Software, IT support, web, data, repair and tech hubs.',
    searchTerm: 'IT and software company',
    track: 'ict',
  },
  {
    key: 'telecom',
    label: 'Telecommunications & Electronics',
    description: 'Network dealers, ISPs, airtime, devices and communication equipment.',
    searchTerm: 'telecommunications and electronics',
    track: 'ict',
  },
  {
    key: 'construction',
    label: 'Construction & Building Trades',
    description: 'Contractors, trades, fabrication and building equipment.',
    searchTerm: 'construction company',
    track: 'construction',
  },
  {
    key: 'real_estate',
    label: 'Real Estate & Property',
    description: 'Agencies, developers, land, letting, valuation and property care.',
    searchTerm: 'real estate company',
    track: 'real_estate',
  },
  {
    key: 'mining_energy',
    label: 'Mining, Energy & Utilities',
    description: 'Mining services, quarrying, fuel, solar, power and water systems.',
    searchTerm: 'mining and energy company',
    track: 'mining_energy',
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing, Printing & Packaging',
    description: 'Factories and workshops that make, print or package goods.',
    searchTerm: 'manufacturer',
    track: 'manufacturing',
  },
  {
    key: 'transport',
    label: 'Transport, Haulage & Logistics',
    description: 'Trotros, taxis, haulage, courier, freight, storage and fleet services.',
    searchTerm: 'transport and logistics company',
    track: 'logistics',
  },
  {
    key: 'auto',
    label: 'Automotive Sales & Services',
    description: 'Dealers, parts, repairs, washing, inspection and charging.',
    searchTerm: 'car dealer and auto repair',
    track: 'auto',
  },
  {
    key: 'furniture',
    label: 'Furniture, Home & Interiors',
    description: 'Furniture, interiors, decor, flooring, lighting and fittings.',
    searchTerm: 'furniture and interior',
    track: 'furniture',
  },
  {
    key: 'events',
    label: 'Events, Entertainment & Leisure',
    description: 'Planners, venues, decor, sound, entertainment and party supplies.',
    searchTerm: 'event planner',
    track: 'events',
  },
  {
    key: 'creative',
    label: 'Media, Photography & Creative Arts',
    description: 'Photo, video, design, music, broadcast, publishing and craft.',
    searchTerm: 'photography and creative studio',
    track: 'creative',
  },
  {
    key: 'fitness',
    label: 'Fitness, Sports & Recreation',
    description: 'Gyms, studios, sports academies, pools and outdoor training.',
    searchTerm: 'gym and fitness centre',
    track: 'fitness',
  },
  {
    key: 'facilities',
    label: 'Facilities, Security & Cleaning',
    description: 'Cleaning, security, pest control, maintenance and funeral services.',
    searchTerm: 'facilities and cleaning services',
    track: 'facilities',
  },
  {
    key: 'environment',
    label: 'Environment, Water & Sanitation',
    description: 'Water treatment, drilling, recycling, sanitation and environmental advice.',
    searchTerm: 'environmental and water services',
    track: 'environment',
  },
  {
    key: 'nonprofit',
    label: 'Nonprofits, Associations & Public Bodies',
    description: 'NGOs, cooperatives, faith bodies, associations and civic institutions.',
    searchTerm: 'non-governmental organisation',
    track: 'nonprofit',
  },
  {
    key: 'repairs',
    label: 'Repairs, Maintenance & Personal Services',
    description: 'Appliance, shoe, watch, phone and furniture repair; childcare and pet care.',
    searchTerm: 'repair and maintenance service',
    track: 'facilities',
  },
] as const satisfies readonly IndustryGroup[];

export type GroupKey = (typeof INDUSTRY_GROUPS)[number]['key'];

export interface IndustryCategory {
  id: string;
  label: string;
  group: GroupKey;
  track: TrackKey;
  searchTerm: string;
  placesTypes: readonly PlacesType[];
  /** Extra phrases that should find this category in a picker search. */
  aliases: readonly string[];
}

/** URL-safe, stable id derived from the label. Apostrophes and ampersands are normalised away. */
export function categoryId(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function c(
  group: GroupKey,
  label: string,
  track: TrackKey,
  placesTypes: readonly PlacesType[] = [],
  searchTerm: string = label.toLowerCase(),
  aliases: readonly string[] = [],
): IndustryCategory {
  return { id: categoryId(label), label, group, track, searchTerm, placesTypes, aliases };
}

export const INDUSTRY_CATEGORIES: IndustryCategory[] = [
  // Agriculture & crop farming
  c('agriculture', 'Maize farm', 'agriculture', ['farm']),
  c('agriculture', 'Rice farm', 'agriculture', ['farm'], 'rice farm'),
  c('agriculture', 'Cassava farm', 'agriculture', ['farm']),
  c('agriculture', 'Yam farm', 'agriculture', ['farm']),
  c('agriculture', 'Cocoa farm', 'agriculture', ['farm']),
  c('agriculture', 'Oil palm plantation', 'agriculture', ['farm'], 'oil palm plantation'),
  c('agriculture', 'Vegetable farm', 'agriculture', ['farm'], 'vegetable farm'),
  c('agriculture', 'Pineapple farm', 'agriculture', ['farm']),
  c('agriculture', 'Banana plantation', 'agriculture', ['farm'], 'banana plantation'),
  c('agriculture', 'Shea butter producer', 'agriculture', ['manufacturer'], 'shea butter producer'),
  c('agriculture', 'Agricultural input dealer', 'agriculture', ['supplier'], 'agricultural input dealer'),
  c('agriculture', 'Farm equipment & irrigation supplier', 'agriculture', ['supplier'], 'farm equipment supplier'),

  // Livestock, poultry and fisheries
  c('livestock', 'Poultry farm', 'livestock', ['farm'], 'poultry farm'),
  c('livestock', 'Egg producer & layer farm', 'livestock', ['farm'], 'layer farm'),
  c('livestock', 'Pig farm', 'livestock', ['farm']),
  c('livestock', 'Goat & sheep farm', 'livestock', ['farm'], 'goat and sheep farm'),
  c('livestock', 'Cattle ranch', 'livestock', ['ranch'], 'cattle ranch'),
  c('livestock', 'Fish farm', 'livestock', ['farm'], 'fish farm aquaculture'),
  c('livestock', 'Poultry hatchery', 'livestock', ['farm'], 'poultry hatchery'),
  c('livestock', 'Animal feed producer', 'livestock', ['manufacturer'], 'animal feed producer'),
  c('livestock', 'Veterinary clinic', 'livestock', ['veterinary_care'], 'veterinary clinic'),
  c('livestock', 'Livestock & veterinary supplies', 'livestock', ['supplier'], 'veterinary supplies dealer'),

  // Food, drink and catering
  c('food', 'Restaurant', 'food', ['restaurant']),
  c('food', 'Chop bar', 'food', ['restaurant'], 'chop bar', ['chopbar', 'local eatery']),
  c('food', 'Waakye joint', 'food', ['snack_bar'], 'waakye', ['waakye']),
  c('food', 'Kenkey house', 'food', ['snack_bar'], 'kenkey', ['kenkey', 'ga kenkey']),
  c('food', 'Banku & tilapia joint', 'food', ['restaurant'], 'banku and tilapia'),
  c('food', 'Fufu joint', 'food', ['restaurant'], 'fufu'),
  c('food', 'Bakery', 'food', ['bakery']),
  c('food', 'Pastry & cake shop', 'food', ['cake_shop', 'pastry_shop'], 'pastry and cake shop'),
  c('food', 'Catering service', 'food', ['catering_service'], 'catering service'),
  c('food', 'Drinking bar', 'food', ['bar'], 'drinking bar'),
  c('food', 'Pub & lounge', 'food', ['pub', 'lounge_bar'], 'pub and lounge'),
  c('food', 'Nightclub', 'food', ['night_club']),
  c('food', 'Coffee shop', 'food', ['coffee_shop'], 'coffee shop'),
  c('food', 'Juice & smoothie bar', 'food', ['juice_shop'], 'juice bar'),
  c('food', 'Ice cream & yoghurt shop', 'food', ['ice_cream_shop'], 'ice cream shop'),
  c('food', 'Food delivery service', 'food', ['food_delivery', 'meal_delivery'], 'food delivery service'),

  // Hotels, lodging and tourism
  c('hospitality', 'Hotel', 'hospitality', ['hotel']),
  c('hospitality', 'Guesthouse', 'hospitality', ['guest_house'], 'guest house'),
  c('hospitality', 'Hostel', 'hospitality', ['hostel']),
  c('hospitality', 'Motel', 'hospitality', ['motel']),
  c('hospitality', 'Resort', 'hospitality', ['resort_hotel'], 'resort hotel'),
  c('hospitality', 'Short-let apartment', 'hospitality', ['lodging'], 'short let apartment'),
  c('hospitality', 'Bed & breakfast', 'hospitality', ['bed_and_breakfast'], 'bed and breakfast'),
  c('hospitality', 'Eco-lodge & camp', 'hospitality', ['campground', 'cottage'], 'eco lodge'),
  c('hospitality', 'Travel agency', 'hospitality', ['travel_agency'], 'travel agency'),
  c('hospitality', 'Tour operator', 'hospitality', ['travel_agency'], 'tour operator'),
  c('hospitality', 'Car rental', 'hospitality', ['car_rental'], 'car rental'),
  c('hospitality', 'Tourist attraction & site', 'hospitality', ['tourist_attraction'], 'tourist attraction'),
  c('hospitality', 'Conference & event venue', 'hospitality', ['convention_center', 'event_venue'], 'conference venue'),
  c('hospitality', 'Airport transfer & shuttle service', 'hospitality', ['chauffeur_service'], 'airport shuttle service'),
  // Retail and general merchandise
  c('retail', 'Supermarket', 'retail', ['supermarket']),
  c('retail', 'Mini-mart & convenience shop', 'retail', ['convenience_store'], 'mini mart convenience shop'),
  c('retail', 'Provision shop', 'retail', ['convenience_store', 'grocery_store'], 'provision shop'),
  c('retail', 'Grocery store', 'retail', ['grocery_store'], 'grocery store'),
  c('retail', 'Clothing & fabric shop', 'retail', ['clothing_store'], 'clothing and fabric shop'),
  c('retail', 'Shoe shop', 'retail', ['shoe_store'], 'shoe shop'),
  c('retail', 'Cosmetics & beauty supply shop', 'retail', ['cosmetics_store'], 'cosmetics shop'),
  c('retail', 'Electronics shop', 'retail', ['electronics_store'], 'electronics shop'),
  c('retail', 'Phone & accessory shop', 'retail', ['cell_phone_store'], 'phone shop'),
  c('retail', 'Building materials dealer', 'retail', ['building_materials_store', 'hardware_store'], 'building materials shop'),
  c('retail', 'Hardware shop', 'retail', ['hardware_store'], 'hardware shop'),
  c('retail', 'Home & kitchenware shop', 'retail', ['home_goods_store'], 'kitchenware shop'),
  c('retail', 'Stationery & bookshop', 'retail', ['book_store'], 'stationery bookshop'),
  c('retail', 'Jewellery & watch shop', 'retail', ['jewelry_store'], 'jewellery shop'),
  c('retail', 'Sporting goods shop', 'retail', ['sporting_goods_store'], 'sports shop'),
  c('retail', 'Toy & baby shop', 'retail', ['toy_store'], 'toy shop'),
  c('retail', 'Gift & souvenir shop', 'retail', ['gift_shop'], 'gift shop'),
  c('retail', 'Second-hand clothing shop', 'retail', ['thrift_store'], 'second hand clothing', ['obroni wawu']),
  c('retail', 'Liquor & wine shop', 'retail', ['liquor_store'], 'liquor shop'),
  c('retail', 'Pet shop & supplies', 'retail', ['pet_store'], 'pet shop'),

  // Wholesale, distribution and trade
  c('wholesale', 'Wholesale distributor', 'wholesale', ['wholesaler'], 'wholesale distributor'),
  c('wholesale', 'FMCG distributor', 'wholesale', ['wholesaler'], 'fast moving consumer goods distributor'),
  c('wholesale', 'Building materials wholesaler', 'wholesale', ['wholesaler', 'building_materials_store'], 'building materials wholesaler'),
  c('wholesale', 'Agricultural produce buying company', 'wholesale', ['wholesaler'], 'produce buying company'),
  c('wholesale', 'Import & export trader', 'wholesale', [], 'import and export company'),
  c('wholesale', 'Commodity broker', 'wholesale', ['consultant'], 'commodity broker'),
  c('wholesale', 'Beverage distributor', 'wholesale', ['wholesaler', 'liquor_store'], 'beverage distributor'),
  c('wholesale', 'Pharmaceutical distributor', 'wholesale', ['wholesaler'], 'pharmaceutical distributor'),
  c('wholesale', 'Cold store & frozen foods', 'wholesale', [], 'cold store frozen foods'),
  c('wholesale', 'Packaging materials supplier', 'wholesale', ['supplier'], 'packaging materials supplier'),
  c('wholesale', 'Industrial equipment supplier', 'wholesale', ['supplier'], 'industrial equipment supplier'),
  c('wholesale', 'Scrap dealer & metal merchant', 'wholesale', [], 'scrap dealer'),

  // Markets and street trading
  c('markets', 'Market trader', 'retail', ['market'], 'market trader'),
  c('markets', 'Foodstuff trader', 'retail', ['market'], 'foodstuff trader'),
  c('markets', 'Livestock market', 'retail', ['market'], 'livestock market'),
  c('markets', 'Second-hand goods trader', 'retail', ['flea_market'], 'second hand goods market'),
  c('markets', 'Street food vendor', 'retail', ['meal_takeaway'], 'street food vendor'),
  c('markets', 'Fishmonger', 'retail', ['market'], 'fishmonger'),
  c('markets', 'Meat & poultry seller', 'retail', ['butcher_shop'], 'meat seller'),
  c('markets', 'Produce aggregator', 'retail', ['market'], 'produce aggregator'),
  c('markets', 'Container shop operator', 'retail', ['market'], 'container shop'),
  c('markets', 'Hawker & itinerant trader', 'retail', ['market'], 'hawker'),
  // Fashion, tailoring and textiles
  c('fashion', 'Fashion boutique', 'fashion', ['clothing_store'], 'fashion boutique'),
  c('fashion', "Men's suit retailer", 'fashion', ['clothing_store'], "men's suit shop"),
  c('fashion', 'Bridal shop', 'bridal', ['clothing_store'], 'bridal shop'),
  c('fashion', 'Tailoring & dressmaking', 'fashion', ['tailor'], 'tailoring and dressmaking'),
  c('fashion', 'Kente weaver', 'fashion', [], 'kente weaver', ['kente']),
  c('fashion', 'Smock & batakari weaver', 'fashion', [], 'smock weaver', ['batakari', 'fugu']),
  c('fashion', 'Adinkra & tie-dye producer', 'fashion', [], 'tie and dye producer', ['adinkra']),
  c('fashion', 'Cloth & textile merchant', 'fashion', ['clothing_store'], 'textile merchant'),
  c('fashion', 'Shoe & sandal maker', 'fashion', [], 'shoemaker'),
  c('fashion', 'Leather bags & accessories', 'fashion', [], 'leather bag maker'),
  c('fashion', 'Beadwork & jewellery maker', 'fashion', ['jewelry_store'], 'bead maker'),
  c('fashion', 'Embroidery & monogramming', 'fashion', [], 'embroidery service'),
  c('fashion', 'Fashion design studio', 'fashion', [], 'fashion designer'),
  c('fashion', 'School uniform & workwear supplier', 'fashion', ['tailor'], 'uniform supplier'),

  // Beauty, barbering and wellness
  c('beauty', 'Beauty salon', 'beauty', ['beauty_salon'], 'beauty salon'),
  c('beauty', 'Spa', 'beauty', ['spa'], 'spa'),
  c('beauty', 'Barbering shop', 'beauty', ['barber_shop'], 'barber shop'),
  c('beauty', 'Hair salon & braiding', 'beauty', ['hair_salon'], 'hair braiding salon'),
  c('beauty', 'Nail studio', 'beauty', ['nail_salon'], 'nail salon'),
  c('beauty', 'Makeup artist', 'beauty', ['makeup_artist'], 'makeup artist'),
  c('beauty', 'Cosmetics & skincare shop', 'beauty', ['cosmetics_store'], 'skincare shop'),
  c('beauty', 'Massage & wellness centre', 'beauty', ['massage_spa', 'wellness_center'], 'massage spa'),
  c('beauty', 'Sauna & steam bath', 'beauty', ['sauna'], 'sauna'),
  c('beauty', 'Skincare clinic', 'beauty', ['skin_care_clinic'], 'skin care clinic'),
  c('beauty', 'Tattoo & body art studio', 'beauty', ['body_art_service'], 'tattoo studio'),
  c('beauty', 'Beauty training school', 'beauty', ['school'], 'beauty training school'),
  c('beauty', 'Salon supplies distributor', 'beauty', ['supplier'], 'salon supplies'),

  // Health and medical services
  c('health', 'Clinic', 'health', ['medical_clinic'], 'medical clinic'),
  c('health', 'Hospital', 'health', ['hospital'], 'hospital'),
  c('health', 'Herbal clinic', 'health', [], 'herbal clinic'),
  c('health', 'Dental clinic', 'health', ['dental_clinic', 'dentist'], 'dental clinic'),
  c('health', 'Optical & eye care centre', 'health', [], 'optician eye care'),
  c('health', 'Diagnostic laboratory', 'health', ['medical_lab'], 'diagnostic laboratory'),
  c('health', 'Maternity home', 'health', ['medical_clinic'], 'maternity home'),
  c('health', 'Physiotherapy centre', 'health', ['physiotherapist'], 'physiotherapy clinic'),
  c('health', 'Chiropractic clinic', 'health', ['chiropractor'], 'chiropractor'),
  c('health', 'Radiology & imaging centre', 'health', ['medical_lab'], 'radiology centre'),
  c('health', 'Community health centre', 'health', ['medical_center'], 'community clinic'),
  c('health', 'Mental health & counselling service', 'health', [], 'counselling service'),
  c('health', 'Medical equipment supplier', 'health', ['supplier'], 'medical equipment supplier'),
  c('health', 'Ambulance & emergency service', 'health', [], 'ambulance service'),
  c('health', 'Home care & nursing agency', 'health', [], 'home nursing agency'),
  c('health', 'Wellness & nutrition clinic', 'health', ['wellness_center'], 'nutrition clinic'),
  // Pharmacy and chemical shops
  c('pharmacy', 'Pharmacy', 'pharmacy', ['pharmacy'], 'pharmacy'),
  c('pharmacy', 'Licensed chemical seller', 'pharmacy', ['drugstore'], 'chemical shop'),
  c('pharmacy', 'Drugstore & chemist', 'pharmacy', ['drugstore'], 'drugstore chemist'),
  c('pharmacy', 'Herbal medicine shop', 'pharmacy', [], 'herbal medicine shop'),
  c('pharmacy', 'Medical supplies & consumables', 'pharmacy', ['supplier'], 'medical supplies'),
  c('pharmacy', 'Homeopathic & natural remedies', 'pharmacy', [], 'homeopathic remedies'),

  // Education and training
  c('education', 'Training institution', 'education', ['school'], 'training institute'),
  c('education', 'Daycare & creche', 'education', ['preschool'], 'daycare creche'),
  c('education', 'Kindergarten & preschool', 'education', ['preschool'], 'kindergarten'),
  c('education', 'Primary school', 'education', ['primary_school'], 'primary school'),
  c('education', 'Junior high school', 'education', ['school'], 'junior high school'),
  c('education', 'Senior high school', 'education', ['secondary_school'], 'senior high school'),
  c('education', 'International school', 'education', ['school'], 'international school'),
  c('education', 'Vocational & technical school', 'education', ['school'], 'vocational training school'),
  c('education', 'Driving school', 'education', [], 'driving school'),
  c('education', 'Language & exam preparation centre', 'education', ['school'], 'language school'),
  c('education', 'ICT & coding bootcamp', 'education', ['school'], 'coding bootcamp'),
  c('education', 'Music & arts academy', 'education', ['school'], 'music school'),
  c('education', 'Tutoring & home lessons', 'education', [], 'home tutor'),
  c('education', 'Examination & certification centre', 'education', ['school'], 'exam centre'),
  c('education', 'University & tertiary college', 'education', ['university'], 'university college'),

  // Professional and business services
  c('professional', 'Professional services', 'professional', ['consultant'], 'consulting firm'),
  c('professional', 'Law firm', 'professional', ['lawyer'], 'law firm'),
  c('professional', 'Accounting & audit firm', 'professional', ['accounting'], 'accounting firm'),
  c('professional', 'Tax & business advisory', 'professional', ['accounting', 'consultant'], 'tax advisory'),
  c('professional', 'Management consulting', 'professional', ['consultant'], 'management consulting'),
  c('professional', 'Marketing & advertising agency', 'professional', ['marketing_consultant'], 'advertising agency'),
  c('professional', 'HR & recruitment agency', 'professional', ['employment_agency'], 'recruitment agency'),
  c('professional', 'Architecture & design studio', 'professional', [], 'architecture firm'),
  c('professional', 'Quantity surveying & valuation', 'professional', [], 'quantity surveyor'),
  c('professional', 'Engineering consultancy', 'professional', [], 'engineering consultancy'),
  c('professional', 'Insurance brokerage', 'professional', ['insurance_agency'], 'insurance broker'),
  c('professional', 'Translation & secretarial services', 'professional', [], 'translation services'),
  c('professional', 'Land surveying & geospatial', 'professional', [], 'land surveyor'),
  c('professional', 'Business registration & compliance', 'professional', [], 'business registration agent'),
  c('professional', 'Call centre & customer support', 'professional', [], 'call centre'),
  c('professional', 'Co-working & virtual office', 'professional', ['coworking_space'], 'coworking space'),
  // Financial services and savings
  c('finance', 'Microfinance institution', 'finance', [], 'microfinance institution'),
  c('finance', 'Rural & community bank', 'finance', ['bank'], 'rural bank'),
  c('finance', 'Savings & loans company', 'finance', [], 'savings and loans company'),
  c('finance', 'Credit union', 'finance', [], 'credit union'),
  c('finance', 'Susu collection & savings', 'finance', [], 'susu savings collector', ['susu']),
  c('finance', 'Insurance company', 'finance', ['insurance_agency'], 'insurance company'),
  c('finance', 'Forex bureau', 'finance', [], 'forex bureau'),
  c('finance', 'Mobile money agent', 'finance', [], 'mobile money agent', ['momo']),
  c('finance', 'Investment advisory', 'finance', [], 'investment advisor'),
  c('finance', 'Leasing & asset finance', 'finance', [], 'asset finance company'),
  c('finance', 'Payment service provider', 'finance', [], 'payment service provider'),
  c('finance', 'Debt collection agency', 'finance', [], 'debt collection agency'),

  // ICT, software and digital services
  c('ict', 'Software development company', 'ict', [], 'software development company'),
  c('ict', 'IT support & managed services', 'ict', [], 'IT support company'),
  c('ict', 'Web design & digital agency', 'ict', [], 'web design agency'),
  c('ict', 'Cybersecurity consultancy', 'ict', [], 'cybersecurity company'),
  c('ict', 'Data & analytics consultancy', 'ict', [], 'data analytics consultancy'),
  c('ict', 'Web hosting & domain reseller', 'ict', [], 'web hosting company'),
  c('ict', 'Computer hardware retailer', 'ict', ['electronics_store'], 'computer shop'),
  c('ict', 'Computer repair & maintenance', 'ict', [], 'computer repair shop'),
  c('ict', 'Mobile phone repair', 'ict', [], 'phone repair shop'),
  c('ict', 'Internet cafe & business centre', 'ict', ['internet_cafe'], 'internet cafe'),
  c('ict', 'IT training & certification', 'ict', ['school'], 'IT training centre'),
  c('ict', 'POS & business software vendor', 'ict', [], 'POS software vendor'),
  c('ict', 'Drone services & geospatial tech', 'ict', [], 'drone services'),
  c('ict', 'Tech hub & startup incubator', 'ict', ['coworking_space'], 'tech hub incubator'),

  // Telecommunications and electronics
  c('telecom', 'Telecommunications service provider', 'ict', ['telecommunications_service_provider'], 'telecommunications company'),
  c('telecom', 'Mobile network dealer', 'ict', [], 'mobile network dealer'),
  c('telecom', 'Airtime & data reseller', 'ict', [], 'airtime and data reseller'),
  c('telecom', 'Phone accessories wholesaler', 'ict', ['wholesaler'], 'phone accessories wholesaler'),
  c('telecom', 'SIM registration agent', 'ict', [], 'SIM registration agent'),
  c('telecom', 'Internet service provider', 'ict', [], 'internet service provider'),
  c('telecom', 'Satellite TV & decoder dealer', 'ict', ['electronics_store'], 'satellite TV dealer'),
  c('telecom', 'Two-way radio & communication equipment', 'ict', ['supplier'], 'two way radio supplier'),
  c('telecom', 'Telecom tower & site maintenance', 'ict', [], 'telecom tower maintenance'),
  c('telecom', 'Telecom equipment installer', 'ict', [], 'telecom equipment installer'),
  // Construction and building trades
  c('construction', 'Building contractor', 'construction', [], 'building contractor'),
  c('construction', 'Civil engineering contractor', 'construction', [], 'civil engineering contractor'),
  c('construction', 'Road & drainage contractor', 'construction', [], 'road construction company'),
  c('construction', 'Electrical contractor', 'construction', ['electrician'], 'electrical contractor'),
  c('construction', 'Plumbing & pipefitting', 'construction', ['plumber'], 'plumbing contractor'),
  c('construction', 'Painting & decorating', 'construction', ['painter'], 'painting contractor'),
  c('construction', 'Roofing contractor', 'construction', ['roofing_contractor'], 'roofing contractor'),
  c('construction', 'Carpentry & joinery workshop', 'construction', [], 'carpentry workshop'),
  c('construction', 'Masonry & block making', 'construction', [], 'block moulding'),
  c('construction', 'Steel fabrication & welding', 'construction', ['manufacturer'], 'steel fabrication'),
  c('construction', 'Aluminium & glass works', 'construction', [], 'aluminium windows and glass'),
  c('construction', 'Tiling & terrazzo contractor', 'construction', [], 'tiling contractor'),
  c('construction', 'Land preparation & earthworks', 'construction', [], 'land preparation earthworks'),
  c('construction', 'Construction equipment rental', 'construction', [], 'construction equipment rental'),
  c('construction', 'Interior fit-out contractor', 'construction', [], 'interior fit out'),
  c('construction', 'Building design & drafting', 'construction', [], 'building design service'),
  c('construction', 'Scaffolding & access equipment', 'construction', [], 'scaffolding supplier'),

  // Real estate and property
  c('real_estate', 'Real estate agency', 'real_estate', ['real_estate_agency'], 'real estate agency'),
  c('real_estate', 'Property developer', 'real_estate', ['real_estate_agency'], 'property developer'),
  c('real_estate', 'Land sales & documentation', 'real_estate', [], 'land sales company'),
  c('real_estate', 'Property management company', 'real_estate', [], 'property management company'),
  c('real_estate', 'Letting & rental agency', 'real_estate', ['real_estate_agency'], 'letting agency'),
  c('real_estate', 'Property valuation & appraisal', 'real_estate', [], 'property valuation'),
  c('real_estate', 'Estate surveying', 'real_estate', [], 'estate surveyor'),
  c('real_estate', 'Serviced apartment operator', 'real_estate', ['lodging'], 'serviced apartments'),
  c('real_estate', 'Property investment company', 'real_estate', [], 'property investment'),

  // Mining, energy and utilities
  c('mining_energy', 'Small-scale mining operator', 'mining_energy', [], 'small scale mining company'),
  c('mining_energy', 'Mining support services', 'mining_energy', [], 'mining support services'),
  c('mining_energy', 'Gold buying & refining', 'mining_energy', [], 'gold buying company'),
  c('mining_energy', 'Quarry & stone crushing', 'mining_energy', [], 'quarry company'),
  c('mining_energy', 'Sand & gravel supplier', 'mining_energy', ['supplier'], 'sand and gravel supplier'),
  c('mining_energy', 'Solar energy installer', 'mining_energy', [], 'solar installation company'),
  c('mining_energy', 'Electrical & power contractor', 'mining_energy', ['electrician'], 'electrical power contractor'),
  c('mining_energy', 'Generator sales & servicing', 'mining_energy', [], 'generator sales and service'),
  c('mining_energy', 'LPG & gas filling station', 'mining_energy', ['gas_station'], 'LPG filling station'),
  c('mining_energy', 'Fuel station & petroleum retail', 'mining_energy', ['gas_station'], 'filling station'),
  c('mining_energy', 'Water treatment & borehole drilling', 'mining_energy', [], 'borehole drilling'),
  c('mining_energy', 'Renewable energy consultancy', 'mining_energy', [], 'renewable energy consultant'),
  // Manufacturing, printing and packaging
  c('manufacturing', 'Food processing company', 'manufacturing', ['manufacturer'], 'food processing company'),
  c('manufacturing', 'Agro-processing plant', 'manufacturing', ['manufacturer'], 'agro processing plant'),
  c('manufacturing', 'Beverage manufacturer', 'manufacturing', ['manufacturer'], 'beverage manufacturer'),
  c('manufacturing', 'Soap & cosmetics manufacturer', 'manufacturing', ['manufacturer'], 'soap manufacturer'),
  c('manufacturing', 'Printing press', 'manufacturing', ['manufacturer'], 'printing press'),
  c('manufacturing', 'Packaging & labelling company', 'manufacturing', ['manufacturer'], 'packaging company'),
  c('manufacturing', 'Signage & large-format printing', 'manufacturing', [], 'signage company'),
  c('manufacturing', 'Furniture manufacturer', 'manufacturing', ['manufacturer'], 'furniture manufacturer'),
  c('manufacturing', 'Plastics & recycling manufacturer', 'manufacturing', ['manufacturer'], 'plastic recycling company'),
  c('manufacturing', 'Metal & aluminium fabrication', 'manufacturing', ['manufacturer'], 'metal fabrication'),
  c('manufacturing', 'Textile & garment factory', 'manufacturing', ['manufacturer'], 'garment factory'),
  c('manufacturing', 'Pharmaceutical manufacturer', 'manufacturing', ['manufacturer'], 'pharmaceutical manufacturer'),
  c('manufacturing', 'Building materials manufacturer', 'manufacturing', ['manufacturer'], 'building materials manufacturer'),
  c('manufacturing', 'Paint & industrial chemicals', 'manufacturing', ['manufacturer'], 'paint manufacturer'),

  // Transport, haulage and logistics
  c('transport', 'Trotro & bus operator', 'logistics', ['bus_station'], 'bus transport company', ['trotro']),
  c('transport', 'Taxi & ride-hailing service', 'logistics', ['taxi_service'], 'taxi service'),
  c('transport', 'Car rental & chauffeur', 'logistics', ['car_rental', 'chauffeur_service'], 'car rental chauffeur service'),
  c('transport', 'Haulage & trucking company', 'logistics', [], 'haulage company'),
  c('transport', 'Courier & parcel delivery', 'logistics', ['courier_service'], 'courier delivery service'),
  c('transport', 'Freight forwarding & clearing agent', 'logistics', ['shipping_service'], 'freight forwarding company'),
  c('transport', 'Shipping & marine services', 'logistics', ['shipping_service', 'ferry_service'], 'shipping company'),
  c('transport', 'Warehouse & storage', 'logistics', ['storage', 'warehouse_store'], 'warehouse and storage'),
  c('transport', 'Moving & relocation company', 'logistics', ['moving_company'], 'moving company'),
  c('transport', 'Logistics & supply chain company', 'logistics', [], 'logistics company'),
  c('transport', 'Motorcycle & tricycle transport', 'logistics', [], 'okada transport service', ['okada', 'pragya']),
  c('transport', 'Boat & canoe transport', 'logistics', ['ferry_service'], 'boat transport'),
  c('transport', 'Vehicle tracking & fleet management', 'logistics', [], 'vehicle tracking company'),
  c('transport', 'Truck stop & rest services', 'logistics', ['truck_stop'], 'truck stop'),

  // Automotive sales and services
  c('auto', 'Auto dealership', 'auto', ['car_dealer'], 'car dealership'),
  c('auto', 'Used car dealer', 'auto', ['car_dealer'], 'used car dealer'),
  c('auto', 'Motorcycle dealer', 'auto', [], 'motorcycle dealer'),
  c('auto', 'Spare parts shop', 'auto', ['auto_parts_store'], 'spare parts shop'),
  c('auto', 'Tyre & battery shop', 'auto', ['tire_shop'], 'tyre and battery shop'),
  c('auto', 'Auto mechanic workshop', 'auto', ['car_repair'], 'auto mechanic workshop'),
  c('auto', 'Auto body & spray painting', 'auto', ['car_repair'], 'auto body repair'),
  c('auto', 'Car wash & detailing', 'auto', ['car_wash'], 'car wash'),
  c('auto', 'Vehicle inspection & diagnostics', 'auto', [], 'vehicle inspection'),
  c('auto', 'Vehicle leasing', 'auto', ['car_rental'], 'vehicle leasing'),
  c('auto', 'Truck & heavy equipment dealer', 'auto', ['truck_dealer'], 'truck dealer'),
  c('auto', 'EV charging & electric mobility', 'auto', [], 'electric vehicle charging'),
  // Furniture, home and interiors
  c('furniture', 'Furniture showroom', 'furniture', ['furniture_store'], 'furniture store'),
  c('furniture', 'Custom furniture maker', 'furniture', ['furniture_store'], 'custom furniture maker'),
  c('furniture', 'Interior design studio', 'furniture', [], 'interior design studio'),
  c('furniture', 'Curtains & upholstery', 'furniture', [], 'curtains and upholstery'),
  c('furniture', 'Mattress & bedding shop', 'furniture', ['home_goods_store'], 'mattress shop'),
  c('furniture', 'Kitchen cabinet maker', 'furniture', [], 'kitchen cabinet maker'),
  c('furniture', 'Office furniture supplier', 'furniture', ['furniture_store', 'supplier'], 'office furniture supplier'),
  c('furniture', 'Home decor & accessories', 'furniture', ['home_goods_store'], 'home decor shop'),
  c('furniture', 'Flooring & tiles showroom', 'furniture', ['home_improvement_store'], 'flooring showroom'),
  c('furniture', 'Lighting & electrical fittings', 'furniture', ['home_improvement_store'], 'lighting shop'),

  // Events, entertainment and leisure
  c('events', 'Event planning', 'events', [], 'event planner'),
  c('events', 'Wedding planner', 'events', [], 'wedding planner'),
  c('events', 'Event decor & rentals', 'events', [], 'event decoration and rentals'),
  c('events', 'Conference & convention centre', 'events', ['convention_center'], 'convention centre'),
  c('events', 'Banquet hall', 'events', ['banquet_hall'], 'banquet hall'),
  c('events', 'Wedding venue', 'events', ['wedding_venue'], 'wedding venue'),
  c('events', 'DJ & sound engineering', 'events', [], 'DJ and sound system'),
  c('events', 'Live band & entertainment', 'events', [], 'live band'),
  c('events', 'MC & protocol services', 'events', [], 'master of ceremonies'),
  c('events', 'Party supplies & balloon decor', 'events', [], 'party supplies shop'),
  c('events', 'Canopy & chair rental', 'events', [], 'canopy and chair rental'),
  c('events', 'Children’s party entertainment', 'events', [], 'children party entertainment'),
  c('events', 'Event ticketing & ushering', 'events', [], 'event ticketing service'),
  c('events', 'Corporate event & activation agency', 'events', [], 'corporate event agency'),

  // Media, photography and creative arts
  c('creative', 'Photography studio', 'creative', [], 'photography studio'),
  c('creative', 'Videography & film production', 'creative', [], 'video production company'),
  c('creative', 'Graphic design studio', 'creative', [], 'graphic design studio'),
  c('creative', 'Sign writing & branding', 'creative', [], 'sign writing'),
  c('creative', 'Music studio & recording', 'creative', [], 'recording studio'),
  c('creative', 'Radio & TV station', 'creative', [], 'radio station'),
  c('creative', 'Newspaper & online publisher', 'creative', [], 'newspaper publisher'),
  c('creative', 'Advertising production', 'creative', [], 'advertising production'),
  c('creative', 'Art gallery', 'creative', ['art_gallery'], 'art gallery'),
  c('creative', 'Craft & artisan workshop', 'creative', [], 'craft workshop'),
  c('creative', 'Social media & content agency', 'creative', [], 'social media agency'),
  c('creative', 'Drone photography & video', 'creative', [], 'drone photography'),
  // Fitness, sports and recreation
  c('fitness', 'Gym', 'fitness', ['gym', 'fitness_center'], 'gym'),
  c('fitness', 'Personal training studio', 'fitness', [], 'personal trainer'),
  c('fitness', 'Yoga & pilates studio', 'fitness', ['yoga_studio'], 'yoga studio'),
  c('fitness', 'Sports club & academy', 'fitness', ['sports_club', 'sports_school'], 'sports academy'),
  c('fitness', 'Football & athletics academy', 'fitness', ['sports_club'], 'football academy'),
  c('fitness', 'Swimming pool & lessons', 'fitness', ['swimming_pool'], 'swimming lessons'),
  c('fitness', 'Martial arts & boxing gym', 'fitness', [], 'martial arts gym'),
  c('fitness', 'Sports equipment shop', 'fitness', ['sporting_goods_store'], 'sports equipment shop'),
  c('fitness', 'Fitness bootcamp & outdoor training', 'fitness', [], 'fitness bootcamp'),
  c('fitness', 'Wellness & meditation centre', 'fitness', ['wellness_center'], 'meditation centre'),

  // Facilities, security and cleaning
  c('facilities', 'Cleaning services company', 'facilities', [], 'cleaning services company'),
  c('facilities', 'Security services company', 'facilities', [], 'security services company'),
  c('facilities', 'Facility management company', 'facilities', [], 'facility management company'),
  c('facilities', 'Pest control service', 'facilities', [], 'pest control service'),
  c('facilities', 'Landscaping & gardening', 'facilities', [], 'landscaping services'),
  c('facilities', 'Laundry & dry cleaning', 'facilities', ['laundry'], 'laundry and dry cleaning'),
  c('facilities', 'Waste collection & sanitation', 'facilities', [], 'waste collection company'),
  c('facilities', 'Fumigation & disinfection', 'facilities', [], 'fumigation services'),
  c('facilities', 'Janitorial & office support', 'facilities', [], 'janitorial services'),
  c('facilities', 'CCTV & security equipment installer', 'facilities', [], 'CCTV installation'),
  c('facilities', 'HVAC & generator maintenance', 'facilities', [], 'HVAC maintenance'),
  c('facilities', 'Elevator & escalator servicing', 'facilities', [], 'elevator maintenance'),
  c('facilities', 'Funeral home & mortuary', 'facilities', ['funeral_home'], 'funeral home'),
  c('facilities', 'Cemetery & burial services', 'facilities', ['cemetery'], 'cemetery services'),

  // Environment, water and sanitation
  c('environment', 'Water treatment & purification', 'environment', [], 'water treatment company'),
  c('environment', 'Borehole drilling & pump installation', 'environment', [], 'borehole drilling company'),
  c('environment', 'Environmental consultancy & impact assessment', 'environment', [], 'environmental consultancy'),
  c('environment', 'Recycling & waste recovery', 'environment', [], 'recycling company'),
  c('environment', 'Sanitation & toilet construction', 'environment', [], 'sanitation services'),
  c('environment', 'Tree nursery & afforestation', 'environment', [], 'tree nursery'),
  c('environment', 'Air quality & pollution monitoring', 'environment', [], 'air quality monitoring'),
  c('environment', 'Environmental testing laboratory', 'environment', [], 'environmental testing laboratory'),
  c('environment', 'Green building consultancy', 'environment', [], 'green building consultant'),
  c('environment', 'Plastic waste collection & buy-back', 'environment', [], 'plastic waste collection'),
  // Nonprofits, associations and public bodies
  c('nonprofit', 'Non-governmental organisation', 'nonprofit', ['non_profit_organization'], 'non-governmental organisation', ['ngo']),
  c('nonprofit', 'Community-based organisation', 'nonprofit', [], 'community based organisation', ['cbo']),
  c('nonprofit', 'Foundation & charity', 'nonprofit', ['non_profit_organization'], 'charity foundation'),
  c('nonprofit', 'Trade association & chamber', 'nonprofit', ['association_or_organization'], 'trade association'),
  c('nonprofit', 'Cooperative society', 'nonprofit', ['association_or_organization'], 'cooperative society'),
  c('nonprofit', 'Religious organisation & church', 'nonprofit', ['church'], 'church'),
  c('nonprofit', 'Mosque & Islamic centre', 'nonprofit', ['mosque'], 'mosque'),
  c('nonprofit', 'Faith-based development organisation', 'nonprofit', [], 'faith based organisation'),
  c('nonprofit', 'Social enterprise', 'nonprofit', [], 'social enterprise'),
  c('nonprofit', 'Professional body & institute', 'nonprofit', ['association_or_organization'], 'professional body'),
  c('nonprofit', 'Local government office', 'nonprofit', ['local_government_office'], 'district assembly'),
  c('nonprofit', 'Government agency', 'nonprofit', ['government_office'], 'government agency'),
  c('nonprofit', 'Public library', 'nonprofit', ['library'], 'public library'),
  c('nonprofit', 'Police station', 'nonprofit', ['police'], 'police station'),
  c('nonprofit', 'Fire station', 'nonprofit', ['fire_station'], 'fire station'),
  c('nonprofit', 'Post office', 'nonprofit', ['post_office'], 'post office'),
  c('nonprofit', 'Embassy & consulate', 'nonprofit', ['embassy'], 'embassy consulate'),
  c('nonprofit', 'Community centre', 'nonprofit', ['community_center'], 'community centre'),

  // Repairs, maintenance and personal services
  c('repairs', 'Appliance repair service', 'facilities', [], 'appliance repair'),
  c('repairs', 'Shoe repair & cobbler', 'facilities', [], 'shoe repair'),
  c('repairs', 'Watch & clock repair', 'facilities', [], 'watch repair'),
  c('repairs', 'Key cutting & locksmith', 'facilities', ['locksmith'], 'key cutting locksmith'),
  c('repairs', 'Furniture repair & restoration', 'facilities', [], 'furniture restoration'),
  c('repairs', 'Bicycle repair & sales', 'facilities', ['bicycle_store'], 'bicycle shop'),
  c('repairs', 'Photo framing & mounting', 'facilities', [], 'photo framing'),
  c('repairs', 'Upholstery & soft furnishing repair', 'facilities', [], 'upholstery repair'),
  c('repairs', 'AC & refrigeration repair', 'facilities', [], 'air conditioning repair'),
  c('repairs', 'Home errand & concierge service', 'facilities', [], 'home errand service'),
  c('repairs', 'Childcare & day nursery', 'facilities', ['child_care_agency'], 'childcare nursery'),
  c('repairs', 'Pet grooming & boarding', 'facilities', ['pet_care', 'pet_boarding_service'], 'pet grooming boarding'),
];

// ── Lookups ──────────────────────────────────────────────────────────────────

const BY_LABEL = new Map(INDUSTRY_CATEGORIES.map((category) => [category.label.toLowerCase(), category]));
const BY_ID = new Map(INDUSTRY_CATEGORIES.map((category) => [category.id, category]));
const GROUP_BY_KEY = new Map<string, IndustryGroup>(INDUSTRY_GROUPS.map((group) => [group.key, group]));
const GROUP_BY_LABEL = new Map(INDUSTRY_GROUPS.map((group) => [group.label.toLowerCase(), group]));

/** The category for a stored label or an id, if the label is part of the built-in taxonomy. */
export function findIndustryCategory(labelOrId: string): IndustryCategory | null {
  const key = labelOrId.trim();
  return BY_LABEL.get(key.toLowerCase()) ?? BY_ID.get(key.toLowerCase()) ?? null;
}

/**
 * The group a stored category belongs to. A group label resolves to itself, which is how a campaign
 * or a search can target a whole industry group without listing its categories.
 */
export function industryGroupForCategory(labelOrId: string): IndustryGroup | null {
  const category = findIndustryCategory(labelOrId);
  if (category) return GROUP_BY_KEY.get(category.group) ?? null;
  return GROUP_BY_LABEL.get(labelOrId.trim().toLowerCase()) ?? null;
}

export function industryGroupByKey(key: string): IndustryGroup | null {
  return GROUP_BY_KEY.get(key) ?? null;
}

export function industryGroupByLabel(label: string): IndustryGroup | null {
  return GROUP_BY_LABEL.get(label.trim().toLowerCase()) ?? null;
}

export function categoriesInGroup(key: string): IndustryCategory[] {
  return INDUSTRY_CATEGORIES.filter((category) => category.group === key);
}
