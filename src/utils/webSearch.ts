import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_STORAGE = '@scout_tavily_key';

export const getTavilyKey = (): Promise<string | null> =>
  AsyncStorage.getItem(KEY_STORAGE);

export const setTavilyKey = (key: string): Promise<void> =>
  AsyncStorage.setItem(KEY_STORAGE, key.trim());

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export const webSearch = async (query: string): Promise<SearchResult[]> => {
  const key = await getTavilyKey();
  if (!key) return [];

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: 3, search_depth: 'basic' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as SearchResult[];
  } catch {
    return [];
  }
};

export const formatSearchContext = (query: string, results: SearchResult[]): string => {
  if (results.length === 0) return '';
  const snippets = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 400)}`).join('\n\n');
  return `[LIVE WEB SEARCH for: "${query}"]\n${snippets}\n[END WEB CONTEXT]\n\nUse the above web context to answer with current information.`;
};
