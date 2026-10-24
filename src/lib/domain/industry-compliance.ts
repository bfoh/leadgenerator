// Lawful-activity guardrails for the industry catalogue.
//
// The catalogue lists commercial activities a Ghanaian agency can legitimately serve. Some need a
// licence or registration before the business may trade at all; others are unlawful and deliberately
// absent. This module records which is which so the product can say so plainly in Discover and in
// proposals — without giving legal advice.
//
// It is guidance, not a legal opinion. Notes name the usual regulator; compliance is always the
// business's responsibility, and the agency's scope stays digital services.

import { findIndustryCategory } from './categories';

export interface ComplianceNote {
  /** The regulator or permission a lawful operator normally needs. */
  regulator: string;
  /** One plain sentence, safe to show a prospect or repeat in a proposal. */
  note: string;
}

const health: ComplianceNote = {
  regulator: 'Health Facilities Regulatory Agency (HeFRA) and the relevant professional council',
  note: 'A health facility needs a HeFRA licence and its practitioners must be registered with their professional council.',
};
const food: ComplianceNote = {
  regulator: 'Food and Drugs Authority (FDA) and the district environmental health office',
  note: 'Food premises need an FDA food-handling permit and the district’s environmental health approval.',
};
const alcohol: ComplianceNote = {
  regulator: 'The district assembly (liquor licence) and the FDA',
  note: 'Selling alcohol needs a district assembly liquor licence and, where food is handled, an FDA permit.',
};
const school: ComplianceNote = {
  regulator: 'Ghana Education Service (GES) or the relevant education commission',
  note: 'A school, creche or training provider must be registered with GES, CTVET or the tertiary commission before it enrols learners.',
};
const bankOfGhana: ComplianceNote = {
  regulator: 'Bank of Ghana',
  note: 'Deposit-taking, lending, payments and foreign exchange need a Bank of Ghana licence before the business can trade.',
};
const mining: ComplianceNote = {
  regulator: 'Minerals Commission, the EPA and (for gold buying) the Precious Minerals Marketing Company',
  note: 'Mining, quarrying and gold buying need a mineral right or licence and environmental approval; unlicensed small-scale mining is outside this catalogue.',
};
const waste: ComplianceNote = {
  regulator: 'Environmental Protection Agency (EPA) and the district assembly',
  note: 'Waste collection, recycling and sanitation services need an EPA permit and district assembly approval.',
};
const security: ComplianceNote = {
  regulator: 'Ministry of the Interior',
  note: 'Private security operations need a Ministry of the Interior licence.',
};
const property: ComplianceNote = {
  regulator: 'Real Estate Agency Council',
  note: 'Real estate agency, letting and land documentation services must be licensed by the Real Estate Agency Council.',
};

/** Categories that need a licence or registration before trading. Keyed by exact catalogue label. */
export const COMPLIANCE_NOTES: Readonly<Record<string, ComplianceNote>> = {
  // Health
  Clinic: health,
  Hospital: health,
  'Dental clinic': health,
  'Maternity home': health,
  'Diagnostic laboratory': health,
  'Radiology & imaging centre': health,
  'Community health centre': health,
  'Physiotherapy centre': health,
  'Chiropractic clinic': health,
  'Mental health & counselling service': health,
  'Optical & eye care centre': health,
  'Herbal clinic': { regulator: 'Traditional Medicine Practice Council', note: 'Traditional and herbal practitioners must be registered with the Traditional Medicine Practice Council.' },
  Pharmacy: { regulator: 'Pharmacy Council of Ghana', note: 'A pharmacy needs a Pharmacy Council premises licence and a registered pharmacist in charge.' },
  'Licensed chemical seller': { regulator: 'Pharmacy Council of Ghana', note: 'A licensed chemical seller needs a Pharmacy Council licence for the over-the-counter medicines it may sell.' },
  'Drugstore & chemist': { regulator: 'Pharmacy Council of Ghana', note: 'A drugstore needs a Pharmacy Council licence; prescription medicines stay with a licensed pharmacy.' },
  'Herbal medicine shop': { regulator: 'Traditional Medicine Practice Council and the FDA', note: 'Herbal medicines need Traditional Medicine Practice Council registration and FDA product approval.' },
  'Pharmaceutical manufacturer': { regulator: 'Food and Drugs Authority (FDA)', note: 'Manufacturing medicines needs an FDA establishment licence.' },
  // Finance and insurance
  'Microfinance institution': bankOfGhana,
  'Rural & community bank': bankOfGhana,
  'Savings & loans company': bankOfGhana,
  'Credit union': { regulator: 'Bank of Ghana and the Registrar of Cooperatives', note: 'Credit unions must be registered as cooperatives and supervised under Bank of Ghana rules.' },
  'Susu collection & savings': { regulator: 'Bank of Ghana', note: 'Susu companies need a Bank of Ghana licence; informal collectors operate under the same depositor-protection rules.' },
  'Forex bureau': bankOfGhana,
  'Investment advisory': { regulator: 'Securities and Exchange Commission (SEC)', note: 'Investment advice and fund management need SEC registration.' },
  'Leasing & asset finance': bankOfGhana,
  'Payment service provider': bankOfGhana,
  'Debt collection agency': { regulator: 'Bank of Ghana and the Data Protection Commission', note: 'Debt collection is supervised by Bank of Ghana and must respect data-protection rules.' },
  'Mobile money agent': { regulator: 'Bank of Ghana and the mobile network operator', note: 'A mobile money agent operates under a Bank of Ghana agent agreement and the network’s rules.' },
  'Insurance company': { regulator: 'National Insurance Commission (NIC)', note: 'Insurers and brokers must be licensed by the National Insurance Commission.' },
  'Insurance brokerage': { regulator: 'National Insurance Commission (NIC)', note: 'Insurance brokers must be licensed by the National Insurance Commission.' },
  // Mining and energy
  'Small-scale mining operator': mining,
  'Mining support services': mining,
  'Gold buying & refining': mining,
  'Quarry & stone crushing': mining,
  'Sand & gravel supplier': { regulator: 'Minerals Commission and the district assembly', note: 'Sand and gravel winning needs a minerals right and district approval.' },
  // Education
  'Training institution': school,
  'Daycare & creche': school,
  'Kindergarten & preschool': school,
  'Primary school': school,
  'Junior high school': school,
  'Senior high school': school,
  'International school': school,
  'Vocational & technical school': school,
  'University & tertiary college': school,
  // Employment, property and security
  'HR & recruitment agency': { regulator: 'Labour Department', note: 'Private employment agencies need a Labour Department licence under the Labour Act.' },
  'Real estate agency': property,
  'Letting & rental agency': property,
  'Land sales & documentation': property,
  'Property management company': property,
  'Security services company': security,
  // Food, alcohol, waste and water
  'Chop bar': food,
  'Waakye joint': food,
  'Kenkey house': food,
  'Banku & tilapia joint': food,
  'Fufu joint': food,
  'Street food vendor': food,
  'Catering service': food,
  'Food processing company': food,
  'Food delivery service': food,
  'Drinking bar': alcohol,
  'Pub & lounge': alcohol,
  'Liquor & wine shop': alcohol,
  'Waste collection & sanitation': waste,
  'Recycling & waste recovery': waste,
  'Sanitation & toilet construction': waste,
  'Plastic waste collection & buy-back': waste,
  'Water treatment & purification': { regulator: 'Water Resources Commission', note: 'Water abstraction and treatment need a Water Resources Commission permit.' },
  'Borehole drilling & pump installation': { regulator: 'Water Resources Commission', note: 'Borehole drilling needs a Water Resources Commission drilling licence.' },
};

/**
 * Activities the catalogue deliberately does not list. A label, search phrase or alias matching one
 * of these is a data error: the product does not help market unlawful activity.
 */
export const UNLAWFUL_ACTIVITY_TERMS = [
  'galamsey',
  'illegal mining',
  'unlicensed mining',
  'smuggling',
  'counterfeit',
  'fake drugs',
  'drug trafficking',
  'cannabis',
  'wee',
  'prostitution',
  'sex work',
  'escort service',
  'money laundering',
  'ponzi',
  'pyramid scheme',
  'loan shark',
  'arms dealer',
  'firearms',
  'sakawa',
  'cyber fraud',
] as const;

/** The standing assumption added to a proposal for a regulated activity. */
export const COMPLIANCE_ASSUMPTION =
  'Licensing and registration for this activity are the business’s responsibility; this work covers digital services only and does not include regulatory advice.';

const ESCAPED = UNLAWFUL_ACTIVITY_TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** Whether a label or phrase names an activity the catalogue must not carry. */
export function mentionsUnlawfulActivity(text: string): boolean {
  return ESCAPED.some((term) => new RegExp(`\\b${term}\\b`, 'i').test(text));
}

/** The compliance note for a stored category, or null for an activity with no special licence. */
export function complianceForCategory(labelOrId: string): ComplianceNote | null {
  const known = findIndustryCategory(labelOrId);
  return COMPLIANCE_NOTES[known?.label ?? labelOrId.trim()] ?? null;
}

/** Whether the activity needs a licence or registration before trading. */
export function isRegulatedCategory(labelOrId: string): boolean {
  return complianceForCategory(labelOrId) != null;
}
