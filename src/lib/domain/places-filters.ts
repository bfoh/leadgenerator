// Which Google Places API (New) `includedType` filters are safe to send.
//
// Audit (Milestone 3A.1). The taxonomy declares a reference type for 159 categories, but an
// `includedType` request narrows results to places Google tagged with that exact type. That is an
// unintended exclusion whenever the category is broader than the tag: a market trader is not a
// `market`, a street vendor is rarely `meal_takeaway`, and a clinic may be tagged `doctor` or
// `medical_center`. Only the reviewed pairs below are sent. Everything else keeps the text phrase,
// which is always sent and never hides a business because Google chose a different tag.
//
// Adding a pair means checking two things: the Google type is a business kind (not a venue,
// container or generic relation such as `market`, `bus_station`, `supplier`), and a business that
// plainly belongs to the category would be tagged with it.

import type { PlacesType } from './places-types';
import { findIndustryCategory } from './categories';

const REVIEWED_FILTERS: readonly (readonly [string, PlacesType])[] = [
  // Agriculture, livestock and veterinary services
  ['Rice farm', 'farm'],
  ['Oil palm plantation', 'farm'],
  ['Vegetable farm', 'farm'],
  ['Banana plantation', 'farm'],
  ['Poultry farm', 'farm'],
  ['Egg producer & layer farm', 'farm'],
  ['Goat & sheep farm', 'farm'],
  ['Cattle ranch', 'ranch'],
  ['Fish farm', 'farm'],
  ['Veterinary clinic', 'veterinary_care'],
  // Food, drink and hospitality
  ['Catering service', 'catering_service'],
  ['Drinking bar', 'bar'],
  ['Coffee shop', 'coffee_shop'],
  ['Guesthouse', 'guest_house'],
  ['Resort', 'resort_hotel'],
  ['Bed & breakfast', 'bed_and_breakfast'],
  ['Travel agency', 'travel_agency'],
  ['Car rental', 'car_rental'],
  ['Tourist attraction & site', 'tourist_attraction'],
  // Retail and wholesale
  ['Mini-mart & convenience shop', 'convenience_store'],
  ['Grocery store', 'grocery_store'],
  ['Shoe shop', 'shoe_store'],
  ['Cosmetics & beauty supply shop', 'cosmetics_store'],
  ['Electronics shop', 'electronics_store'],
  ['Phone & accessory shop', 'cell_phone_store'],
  ['Hardware shop', 'hardware_store'],
  ['Sporting goods shop', 'sporting_goods_store'],
  ['Gift & souvenir shop', 'gift_shop'],
  ['Second-hand clothing shop', 'thrift_store'],
  ['Liquor & wine shop', 'liquor_store'],
  ['Pet shop & supplies', 'pet_store'],
  ['Wholesale distributor', 'wholesaler'],
  ['FMCG distributor', 'wholesaler'],
  ['Beverage distributor', 'wholesaler'],
  ['Agricultural produce buying company', 'wholesaler'],
  ['Pharmaceutical distributor', 'wholesaler'],
  ['Meat & poultry seller', 'butcher_shop'],
  // Fashion, beauty and personal care
  ['Tailoring & dressmaking', 'tailor'],
  ['Beauty salon', 'beauty_salon'],
  ['Spa', 'spa'],
  ['Barbering shop', 'barber_shop'],
  ['Hair salon & braiding', 'hair_salon'],
  ['Nail studio', 'nail_salon'],
  ['Makeup artist', 'makeup_artist'],
  ['Sauna & steam bath', 'sauna'],
  ['Skincare clinic', 'skin_care_clinic'],
  ['Tattoo & body art studio', 'body_art_service'],
  // Health and pharmacy
  ['Hospital', 'hospital'],
  ['Dental clinic', 'dental_clinic'],
  ['Diagnostic laboratory', 'medical_lab'],
  ['Physiotherapy centre', 'physiotherapist'],
  ['Chiropractic clinic', 'chiropractor'],
  ['Pharmacy', 'pharmacy'],
  ['Licensed chemical seller', 'drugstore'],
  ['Drugstore & chemist', 'drugstore'],
  // Education
  ['Primary school', 'primary_school'],
  ['Junior high school', 'school'],
  ['Senior high school', 'secondary_school'],
  ['International school', 'school'],
  ['Daycare & creche', 'preschool'],
  ['Kindergarten & preschool', 'preschool'],
  ['University & tertiary college', 'university'],
  // Professional, finance and ICT services
  ['Law firm', 'lawyer'],
  ['Accounting & audit firm', 'accounting'],
  ['HR & recruitment agency', 'employment_agency'],
  ['Insurance brokerage', 'insurance_agency'],
  ['Insurance company', 'insurance_agency'],
  ['Rural & community bank', 'bank'],
  ['Co-working & virtual office', 'coworking_space'],
  ['Internet cafe & business centre', 'internet_cafe'],
  ['Telecommunications service provider', 'telecommunications_service_provider'],
  // Construction and property
  ['Electrical contractor', 'electrician'],
  ['Electrical & power contractor', 'electrician'],
  ['Plumbing & pipefitting', 'plumber'],
  ['Painting & decorating', 'painter'],
  ['Roofing contractor', 'roofing_contractor'],
  ['Real estate agency', 'real_estate_agency'],
  ['Letting & rental agency', 'real_estate_agency'],
  // Energy
  ['Fuel station & petroleum retail', 'gas_station'],
  // Transport and automotive
  ['Taxi & ride-hailing service', 'taxi_service'],
  ['Courier & parcel delivery', 'courier_service'],
  ['Warehouse & storage', 'storage'],
  ['Moving & relocation company', 'moving_company'],
  ['Car rental & chauffeur', 'car_rental'],
  ['Airport transfer & shuttle service', 'chauffeur_service'],
  ['Auto dealership', 'car_dealer'],
  ['Used car dealer', 'car_dealer'],
  ['Spare parts shop', 'auto_parts_store'],
  ['Tyre & battery shop', 'tire_shop'],
  ['Auto mechanic workshop', 'car_repair'],
  ['Car wash & detailing', 'car_wash'],
  ['Vehicle leasing', 'car_rental'],
  ['Truck & heavy equipment dealer', 'truck_dealer'],
  // Furniture, home and events
  ['Furniture showroom', 'furniture_store'],
  ['Home decor & accessories', 'home_goods_store'],
  ['Flooring & tiles showroom', 'home_improvement_store'],
  ['Lighting & electrical fittings', 'home_improvement_store'],
  ['Banquet hall', 'banquet_hall'],
  ['Wedding venue', 'wedding_venue'],
  ['Conference & convention centre', 'convention_center'],
  ['Art gallery', 'art_gallery'],
  // Fitness, facilities and civic
  ['Gym', 'gym'],
  ['Yoga & pilates studio', 'yoga_studio'],
  ['Swimming pool & lessons', 'swimming_pool'],
  ['Sports equipment shop', 'sporting_goods_store'],
  ['Wellness & meditation centre', 'wellness_center'],
  ['Laundry & dry cleaning', 'laundry'],
  ['Funeral home & mortuary', 'funeral_home'],
  ['Cemetery & burial services', 'cemetery'],
  ['Non-governmental organisation', 'non_profit_organization'],
  ['Foundation & charity', 'non_profit_organization'],
  ['Trade association & chamber', 'association_or_organization'],
  ['Cooperative society', 'association_or_organization'],
  ['Professional body & institute', 'association_or_organization'],
  ['Religious organisation & church', 'church'],
  ['Mosque & Islamic centre', 'mosque'],
  ['Local government office', 'local_government_office'],
  ['Government agency', 'government_office'],
  ['Public library', 'library'],
  ['Police station', 'police'],
  ['Fire station', 'fire_station'],
  ['Post office', 'post_office'],
  ['Embassy & consulate', 'embassy'],
  ['Community centre', 'community_center'],
  ['Key cutting & locksmith', 'locksmith'],
  ['Bicycle repair & sales', 'bicycle_store'],
  ['Childcare & day nursery', 'child_care_agency'],
  // PART_THREE
];

/** Why a mapped category is still searched by phrase: the type would hide businesses in it. */
export const TEXT_ONLY_REASONS: Readonly<Record<string, string>> = {
  'Market trader': 'Google’s “market” type is the market building, not the traders in it.',
  'Foodstuff trader': 'Google’s “market” type is the market building, not the traders in it.',
  Fishmonger: 'Google’s “market” type is the market building, not the fishmongers in it.',
  'Produce aggregator': 'A market is a venue; aggregators are businesses.',
  'Container shop operator': 'Container shops are rarely tagged as a market.',
  'Hawker & itinerant trader': 'Hawkers are not tagged as a market.',
  'Livestock market': 'Individual traders and pens are not all tagged as a market.',
  'Second-hand goods trader': 'A flea market is a venue; second-hand traders are not all tagged there.',
  'Street food vendor': 'Street vendors are rarely tagged “meal takeaway”.',
  'Chop bar': 'Local eateries are often tagged fast food or takeaway, not “restaurant”.',
  'Banku & tilapia joint': 'Local eateries are often tagged fast food or takeaway, not “restaurant”.',
  'Fufu joint': 'Local eateries are often tagged fast food or takeaway, not “restaurant”.',
  'Waakye joint': 'Waakye joints are often untyped, not “snack bar”.',
  'Kenkey house': 'Kenkey houses are often untyped, not “snack bar”.',
  'Fashion boutique': 'Boutiques are inconsistently typed and often untyped.',
  'Bridal shop': 'Bridal shops are often untyped or tagged as clothing.',
  'Cloth & textile merchant': 'Textile merchants are often wholesale or untyped.',
  'Clothing & fabric shop': 'Fabric shops may be tagged as home goods.',
  'School uniform & workwear supplier': 'A supplier is not a tailor; the filter hides the supply side.',
  Clinic: 'Clinics are split across doctor, medical clinic and medical centre tags.',
  'Maternity home': 'Maternity homes are inconsistently typed.',
  'Radiology & imaging centre': 'Imaging centres are not reliably tagged as a laboratory.',
  'Community health centre': 'Public clinics are inconsistently typed.',
  'Training institution': 'Training providers are often untyped; a school filter hides short courses.',
  'Beauty training school': 'Beauty trainers are often untyped; a school filter hides them.',
  'IT training & certification': 'IT trainers are often untyped; a school filter hides them.',
  'Vocational & technical school': 'Vocational institutes are inconsistently typed.',
  'Language & exam preparation centre': 'Language centres are often untyped.',
  'ICT & coding bootcamp': 'Bootcamps are often untyped.',
  'Music & arts academy': 'Music academies are often untyped.',
  'Examination & certification centre': 'Exam centres are often untyped.',
  'Property developer': 'Developers are not estate agencies.',
  'LPG & gas filling station': 'Google’s “gas station” means petrol; LPG plants differ.',
  'Trotro & bus operator': 'A bus station is a place; the category is the operator.',
  'Freight forwarding & clearing agent': 'Clearing agents are often untyped or tagged as couriers.',
  'Shipping & marine services': 'Marine services are split across shipping and ferry tags.',
  'Boat & canoe transport': 'Canoe transport is rarely tagged as a ferry service.',
  'Custom furniture maker': 'Makers are often untyped; a store filter hides the workshop.',
  'Office furniture supplier': 'Suppliers are often untyped; a store filter hides them.',
  'Sports club & academy': 'Clubs are split across sports club and school tags.',
  'Football & athletics academy': 'Academies are split across sports club and school tags.',
  'Pet grooming & boarding': 'Pet care is split across grooming and boarding tags.',
  'Commodity broker': 'A broker is not a consultant; the type is meaningless here.',
  'Professional services': 'The label covers several professions; no single type represents it.',
  'Management consulting': 'Consultants are inconsistently typed and often untyped.',
  'Tax & business advisory': 'Advisory firms are split across accounting and consulting tags.',
  'Marketing & advertising agency': 'Agencies are split across marketing and advertising tags.',
  'Agricultural input dealer': '“supplier” is a generic relation, not a business type.',
  'Farm equipment & irrigation supplier': '“supplier” is a generic relation, not a business type.',
  'Livestock & veterinary supplies': '“supplier” is a generic relation, not a business type.',
  'Packaging materials supplier': '“supplier” is a generic relation, not a business type.',
  'Industrial equipment supplier': '“supplier” is a generic relation, not a business type.',
  'Salon supplies distributor': '“supplier” is a generic relation, not a business type.',
  'Medical equipment supplier': '“supplier” is a generic relation, not a business type.',
  'Medical supplies & consumables': '“supplier” is a generic relation, not a business type.',
  'Two-way radio & communication equipment': '“supplier” is a generic relation, not a business type.',
  'Sand & gravel supplier': '“supplier” is a generic relation, not a business type.',
};

/** Used for a mapped category with no specific note above: the type is broader or narrower than the label. */
export const NARROW_MAPPING_REASON = 'Google’s type does not reliably cover every business in this category, so the text phrase is searched instead.';

const INCLUDED = new Map(REVIEWED_FILTERS.map(([label, type]) => [label.toLowerCase(), type]));
const REASONS = new Map(Object.entries(TEXT_ONLY_REASONS).map(([label, reason]) => [label.trim().toLowerCase(), reason]));

/** The reviewed pairs, keyed by category label, for documentation and tests. */
export const INCLUDED_TYPE_FILTERS: Readonly<Record<string, PlacesType>> = Object.fromEntries(REVIEWED_FILTERS);

/** The reviewed Google type filter for a category label or id, or null when the phrase is the honest search. */
export function includedTypeForCategory(labelOrId: string): PlacesType | null {
  const known = findIndustryCategory(labelOrId);
  return INCLUDED.get((known?.label ?? labelOrId).trim().toLowerCase()) ?? null;
}

/** Why a category is searched by phrase. Null when it has no reference mapping or reviewed filter. */
export function placesFilterReason(label: string): string | null {
  const known = findIndustryCategory(label);
  const key = (known?.label ?? label).trim().toLowerCase();
  if (INCLUDED.has(key)) return null;
  const specific = REASONS.get(key);
  if (specific) return specific;
  return known && known.placesTypes.length ? NARROW_MAPPING_REASON : null;
}
