// Reference geography. Records store country/region/city/neighborhood as text so new
// places can be added here (or typed freely) without a schema change.

export interface City {
  name: string;
  neighborhoods: string[];
}
export interface Region {
  name: string;
  cities: City[];
}
export interface Country {
  code: string;
  name: string;
  currency: string;
  regions: Region[];
}

export const COUNTRIES: Country[] = [
  {
    code: 'GH',
    name: 'Ghana',
    currency: 'GHS',
    regions: [
      {
        name: 'Greater Accra',
        cities: [
          {
            name: 'Accra',
            neighborhoods: [
              'Achimota', 'Adenta', 'Airport Residential Area', 'Cantonments', 'Dansoman', 'Dzorwulu', 'East Legon',
              'Haatso', 'Kaneshie', 'Labone', 'Lapaz', 'Madina', 'North Ridge', 'Nungua', 'Osu', 'Spintex', 'Teshie',
            ],
          },
          { name: 'Tema', neighborhoods: ['Community 1', 'Community 2', 'Community 11', 'Community 25', 'Sakumono', 'Tema Harbour'] },
        ],
      },
      {
        name: 'Ashanti',
        cities: [
          {
            name: 'Kumasi',
            neighborhoods: [
              'Adum', 'Ahodwo', 'Asafo', 'Asokwa', 'Atonsu', 'Ayigya', 'Bantama', 'Danyame', 'Kejetia', 'Kwadaso',
              'Nhyiaeso', 'Santasi', 'Suame', 'Tafo',
            ],
          },
          { name: 'Obuasi', neighborhoods: [] },
        ],
      },
      { name: 'Western', cities: [{ name: 'Sekondi-Takoradi', neighborhoods: [] }] },
      { name: 'Central', cities: [{ name: 'Cape Coast', neighborhoods: [] }, { name: 'Kasoa', neighborhoods: [] }] },
      { name: 'Eastern', cities: [{ name: 'Koforidua', neighborhoods: [] }] },
      { name: 'Volta', cities: [{ name: 'Ho', neighborhoods: [] }] },
      { name: 'Northern', cities: [{ name: 'Tamale', neighborhoods: [] }] },
      { name: 'Upper East', cities: [{ name: 'Bolgatanga', neighborhoods: [] }] },
      { name: 'Upper West', cities: [{ name: 'Wa', neighborhoods: [] }] },
      { name: 'Bono', cities: [{ name: 'Sunyani', neighborhoods: [] }] },
      { name: 'Bono East', cities: [{ name: 'Techiman', neighborhoods: [] }] },
      { name: 'Ahafo', cities: [{ name: 'Goaso', neighborhoods: [] }] },
      { name: 'Western North', cities: [{ name: 'Sefwi Wiawso', neighborhoods: [] }] },
      { name: 'Oti', cities: [{ name: 'Dambai', neighborhoods: [] }] },
      { name: 'Savannah', cities: [{ name: 'Damongo', neighborhoods: [] }] },
      { name: 'North East', cities: [{ name: 'Nalerigu', neighborhoods: [] }] },
    ],
  },
];

/** Cities the agency currently focuses on; used as defaults, not as a restriction. */
export const LAUNCH_CITIES = ['Accra', 'Kumasi'];

export function findCountry(code: string) {
  return COUNTRIES.find((c) => c.code === code) ?? null;
}

export function regionForCity(city: string, countryCode = 'GH'): string | null {
  const country = findCountry(countryCode);
  const match = country?.regions.find((r) => r.cities.some((c) => c.name.toLowerCase() === city.trim().toLowerCase()));
  return match?.name ?? null;
}

export function citiesFor(countryCode: string, region?: string | null): string[] {
  const country = findCountry(countryCode);
  if (!country) return [];
  const regions = region ? country.regions.filter((r) => r.name === region) : country.regions;
  return regions.flatMap((r) => r.cities.map((c) => c.name));
}

export function neighborhoodsFor(city: string, countryCode = 'GH'): string[] {
  const country = findCountry(countryCode);
  for (const region of country?.regions ?? []) {
    const found = region.cities.find((c) => c.name === city);
    if (found) return found.neighborhoods;
  }
  return [];
}

export function countryName(code: string) {
  return findCountry(code)?.name ?? code;
}
