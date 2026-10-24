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
          { name: 'Ashaiman', neighborhoods: [] },
          { name: 'Dodowa', neighborhoods: [] },
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
          { name: 'Ejisu', neighborhoods: [] },
          { name: 'Konongo', neighborhoods: [] },
          { name: 'Mampong', neighborhoods: [] },
          { name: 'Bekwai', neighborhoods: [] },
          { name: 'Offinso', neighborhoods: [] },
        ],
      },
      {
        name: 'Western',
        cities: [
          { name: 'Sekondi-Takoradi', neighborhoods: [] },
          { name: 'Tarkwa', neighborhoods: [] },
          { name: 'Prestea', neighborhoods: [] },
          { name: 'Axim', neighborhoods: [] },
        ],
      },
      {
        name: 'Central',
        cities: [
          { name: 'Cape Coast', neighborhoods: [] },
          { name: 'Kasoa', neighborhoods: [] },
          { name: 'Winneba', neighborhoods: [] },
          { name: 'Agona Swedru', neighborhoods: [] },
          { name: 'Mankessim', neighborhoods: [] },
          { name: 'Elmina', neighborhoods: [] },
        ],
      },
      {
        name: 'Eastern',
        cities: [
          { name: 'Koforidua', neighborhoods: [] },
          { name: 'Nkawkaw', neighborhoods: [] },
          { name: 'Akim Oda', neighborhoods: [] },
          { name: 'Nsawam', neighborhoods: [] },
          { name: 'Aburi', neighborhoods: [] },
          { name: 'Somanya', neighborhoods: [] },
        ],
      },
      {
        name: 'Volta',
        cities: [
          { name: 'Ho', neighborhoods: [] },
          { name: 'Hohoe', neighborhoods: [] },
          { name: 'Keta', neighborhoods: [] },
          { name: 'Aflao', neighborhoods: [] },
          { name: 'Kpando', neighborhoods: [] },
          { name: 'Sogakope', neighborhoods: [] },
        ],
      },
      { name: 'Northern', cities: [{ name: 'Tamale', neighborhoods: [] }, { name: 'Yendi', neighborhoods: [] }, { name: 'Savelugu', neighborhoods: [] }] },
      { name: 'Upper East', cities: [{ name: 'Bolgatanga', neighborhoods: [] }, { name: 'Bawku', neighborhoods: [] }, { name: 'Navrongo', neighborhoods: [] }] },
      { name: 'Upper West', cities: [{ name: 'Wa', neighborhoods: [] }, { name: 'Tumu', neighborhoods: [] }, { name: 'Lawra', neighborhoods: [] }] },
      {
        name: 'Bono',
        cities: [
          { name: 'Sunyani', neighborhoods: [] },
          { name: 'Berekum', neighborhoods: [] },
          { name: 'Dormaa Ahenkro', neighborhoods: [] },
          { name: 'Wenchi', neighborhoods: [] },
        ],
      },
      {
        name: 'Bono East',
        cities: [
          { name: 'Techiman', neighborhoods: [] },
          { name: 'Kintampo', neighborhoods: [] },
          { name: 'Nkoranza', neighborhoods: [] },
          { name: 'Atebubu', neighborhoods: [] },
        ],
      },
      { name: 'Ahafo', cities: [{ name: 'Goaso', neighborhoods: [] }, { name: 'Bechem', neighborhoods: [] }, { name: 'Kenyasi', neighborhoods: [] }] },
      {
        name: 'Western North',
        cities: [
          { name: 'Sefwi Wiawso', neighborhoods: [] },
          { name: 'Bibiani', neighborhoods: [] },
          { name: 'Enchi', neighborhoods: [] },
          { name: 'Juaboso', neighborhoods: [] },
        ],
      },
      {
        name: 'Oti',
        cities: [
          { name: 'Dambai', neighborhoods: [] },
          { name: 'Nkwanta', neighborhoods: [] },
          { name: 'Jasikan', neighborhoods: [] },
          { name: 'Kadjebi', neighborhoods: [] },
          { name: 'Kete Krachi', neighborhoods: [] },
        ],
      },
      {
        name: 'Savannah',
        cities: [
          { name: 'Damongo', neighborhoods: [] },
          { name: 'Bole', neighborhoods: [] },
          { name: 'Salaga', neighborhoods: [] },
          { name: 'Buipe', neighborhoods: [] },
        ],
      },
      { name: 'North East', cities: [{ name: 'Nalerigu', neighborhoods: [] }, { name: 'Walewale', neighborhoods: [] }, { name: 'Gambaga', neighborhoods: [] }] },
    ],
  },
];

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
