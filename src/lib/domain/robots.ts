// Minimal robots.txt evaluation (RFC 9309): the group for our product token, else "*"; longest
// matching rule wins and Allow wins a tie; "*" and "$" wildcards. Used before automated page fetches.

export const ROBOTS_PRODUCT_TOKEN = 'DigitalOpportunityFinder';

interface Rule {
  allow: boolean;
  pattern: string;
}

function parseGroups(text: string) {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.slice(0, 500_000).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function matches(pattern: string, path: string) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(`^${body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return regex.test(path);
}

/** Whether our agent may fetch `path` under these robots.txt rules. */
export function robotsAllows(text: string, path: string, token = ROBOTS_PRODUCT_TOKEN): boolean {
  const groups = parseGroups(text);
  const own = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(own));
  const rules = (specific.length ? specific : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}
