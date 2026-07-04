// Football news via public RSS — no API key, no scraping, no search-engine
// dependency. Keeps the Coach's "verify something" ability inside the same
// on-device-AI-plus-disclosed-source pattern as TheSportsDB fixtures/form,
// rather than opening the model up to arbitrary web content.
import { fetchWithTimeout } from './fixtures';

export interface NewsItem {
  title: string;
  summary: string;
  pubDate: string;
  source: string;
}

const FEEDS: { name: string; url: string }[] = [
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
];

const decodeEntities = (s: string): string =>
  s
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();

const extractTag = (xml: string, tag: string): string => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
};

export const fetchFootballNews = async (query?: string, limit = 5): Promise<NewsItem[]> => {
  const all: NewsItem[] = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetchWithTimeout(feed.url, 6000);
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
      for (const raw of items) {
        const title = extractTag(raw, 'title');
        if (!title) continue;
        all.push({
          title,
          summary: extractTag(raw, 'description').slice(0, 220),
          pubDate: extractTag(raw, 'pubDate'),
          source: feed.name,
        });
      }
    } catch {}
  }
  const q = query?.trim().toLowerCase();
  const filtered = q ? all.filter(i => (i.title + ' ' + i.summary).toLowerCase().includes(q)) : all;
  return (filtered.length > 0 ? filtered : all).slice(0, limit);
};

export const formatNewsContext = (items: NewsItem[], query?: string): string => {
  if (items.length === 0) return `No recent football news found${query ? ` for "${query}"` : ''}.`;
  return [
    `[FOOTBALL NEWS — via ${items[0].source}, use only if directly relevant to the question]`,
    ...items.map(i => `• ${i.title}${i.pubDate ? ` — ${i.pubDate}` : ''}\n  ${i.summary}`),
    '[END NEWS]',
  ].join('\n');
};
