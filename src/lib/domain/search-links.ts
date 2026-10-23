// Search links the researcher opens in their own browser. Nothing is fetched by the server.
export function manualSearchLinks(name: string, city: string) {
  const q = (s: string) => encodeURIComponent(s);
  return [
    { label: 'Exact name + city', url: `https://www.google.com/search?q=${q(`"${name}" ${city}`)}` },
    { label: 'Name + "website"', url: `https://www.google.com/search?q=${q(`${name} ${city} website`)}` },
    { label: 'Bing', url: `https://www.bing.com/search?q=${q(`"${name}" ${city}`)}` },
    { label: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${q(`"${name}" ${city}`)}` },
    { label: 'Facebook pages', url: `https://www.facebook.com/search/pages/?q=${q(`${name} ${city}`)}` },
    { label: 'Instagram', url: `https://www.google.com/search?q=${q(`site:instagram.com ${name}`)}` },
  ];
}
