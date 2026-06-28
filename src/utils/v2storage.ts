import AsyncStorage from '@react-native-async-storage/async-storage';

export interface V2Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;            // visible text (think stripped)
  thinking?: string;          // raw <think> block
  imagePath?: string;
  docName?: string;
  artifactType?: 'html' | 'md';
  artifactSource?: string;    // raw artifact code
  artifactUri?: string;       // saved file URI
  createdAt: string;
}

export interface V2Conversation {
  id: string;
  screen: 'chat' | 'voice';
  title: string;
  modelId?: string;
  createdAt: string;
  updatedAt: string;
}

const CONV_LIST_KEY = 'v2:conv:list';
const convKey = (id: string) => `v2:conv:msgs:${id}`;

// ── Conversations ──────────────────────────────────────────

export async function listConversations(screen?: 'chat' | 'voice'): Promise<V2Conversation[]> {
  const raw = await AsyncStorage.getItem(CONV_LIST_KEY);
  const all: V2Conversation[] = raw ? JSON.parse(raw) : [];
  return screen ? all.filter(c => c.screen === screen) : all;
}

export async function saveConversation(conv: V2Conversation): Promise<void> {
  const all = await listConversations();
  const idx = all.findIndex(c => c.id === conv.id);
  if (idx >= 0) all[idx] = conv; else all.unshift(conv);
  await AsyncStorage.setItem(CONV_LIST_KEY, JSON.stringify(all));
}

export async function deleteConversation(id: string): Promise<void> {
  const all = await listConversations();
  await AsyncStorage.setItem(CONV_LIST_KEY, JSON.stringify(all.filter(c => c.id !== id)));
  await AsyncStorage.removeItem(convKey(id));
}

// ── Messages ───────────────────────────────────────────────

export async function getMessages(convId: string): Promise<V2Message[]> {
  const raw = await AsyncStorage.getItem(convKey(convId));
  return raw ? JSON.parse(raw) : [];
}

export async function appendMessage(convId: string, msg: V2Message): Promise<void> {
  const msgs = await getMessages(convId);
  msgs.push(msg);
  await AsyncStorage.setItem(convKey(convId), JSON.stringify(msgs));
}

export async function updateLastAssistantMessage(convId: string, updates: Partial<V2Message>): Promise<void> {
  const msgs = await getMessages(convId);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') { Object.assign(msgs[i], updates); break; }
  }
  await AsyncStorage.setItem(convKey(convId), JSON.stringify(msgs));
}

// ── Helpers ────────────────────────────────────────────────

export function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Strip <think>...</think> blocks; return visible text + optional thinking content */
export function stripThink(raw: string): { text: string; thinking: string } {
  let thinking = '';
  const text = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    thinking += inner.trim() + '\n';
    return '';
  }).trim();
  return { text, thinking: thinking.trim() };
}

/** Extract first ```html or ```md block from text */
export function detectArtifact(text: string): { type: 'html' | 'md'; source: string } | null {
  const htmlMatch = text.match(/```html\s*([\s\S]*?)```/i);
  if (htmlMatch) return { type: 'html', source: htmlMatch[1].trim() };
  const mdMatch = text.match(/```(?:md|markdown)\s*([\s\S]*?)```/i);
  if (mdMatch) return { type: 'md', source: mdMatch[1].trim() };
  return null;
}
