import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Keyboard, Animated, Modal, Pressable, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect, StackActions } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError, type Tool, type ToolDialect } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import Markdown from 'react-native-markdown-display';
import { getTheme } from '../theme';
import { fonts } from '../theme/fonts';
import { useTheme } from '../navigation/AppNavigator';
import { IconSend, IconStop, IconBall, IconTactics, IconPlayers, IconTrophy, IconRules, IconMore, IconCamera, IconClose } from '../components/Icons';
import ScreenHeader from '../components/ScreenHeader';
import ModelStatusPill from '../components/ModelStatusPill';
import ModelPickerModal from '../components/ModelPickerModal';
import PhotoSourceSheet from '../components/PhotoSourceSheet';
import { llmManager } from '../utils/modelManager';
import { pickTextCapable, pickVisionCapable } from '../utils/models';
import { syncModelsFromDisk, getGenParams, getSettings, getDefaultModelId, setDefaultModelId, getActiveBzKey, toPath } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { startChatSession, addMessage, getMessages } from '../utils/historyDb';
import { formatFixtureContext } from '../utils/teamStats';
import { fetchBzTeamForm, fetchPlayerStats, formatPlayerStatsContext, fetchBzMatches } from '../utils/bzzoiro';
import { splitChannelThinking } from '../utils/thinkingSplit';
import { getCachedFixturesNow, todayISO } from '../utils/fixtures';
import { logInference } from '../utils/auditLogger';


// Kept minimal on purpose: every system-prompt token costs CPU prompt-
// processing time before the first visible token appears.
//
// BUG FIX: this used to unconditionally describe tool-calling even when
// the loaded model has no tools wired up (vision fallback models like
// Gemma get toolsEnabled=false in Chat — see loadModel()). Told to
// "always call a tool" with no actual tool access, the model either
// parroted the tool descriptions back as prose or fell back to a flat
// "I don't have real-time access" refusal — neither is useful. The
// prompt is now built per-request based on real tool availability.
const BASE_SYSTEM_PROMPT = `You are Scout's AI Coach — a veteran football (association football / soccer) coach, fully on-device.

Every question is about football unless the user explicitly names a different sport. This matters for words football shares with other sports — "handball" is a foul inside football, not the Olympic team sport; "offside" is football's rule, not ice hockey's; "corner", "box", "pitch", "clean sheet", "the back four" etc. are all football terms. Never answer with a different sport's rules just because a word is ambiguous in isolation — read it as football first, always.

Rules: always commit — never refuse or say "I'm not sure"; back opinions with specific players, formations, scorelines; no filler or disclaimers. Style: short paragraphs, **bold** key names, bullets for lists, concise English.`;

// Computed fresh per prompt build, not hardcoded — this is what actually
// grounds "last match", "today", "tomorrow" against the real device clock
// instead of the model guessing from its training cutoff. Verified live:
// without this, asked for a team's "last match played", the model
// fabricated a 2022 World Cup final score from memory and presented it as
// current — it had no anchor for what "last" or "recent" means right now.
const dateContext = (): string => {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().split('T')[0];
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  return ` Today's real date is ${iso(now)} (${weekday}). Yesterday was ${iso(yesterday)}, tomorrow is ${iso(tomorrow)}. Use this to judge what "recent", "last", "this week", "today", or "tomorrow" actually mean — never assume a date from your training data is current, and never treat an old date (e.g. a past World Cup) as if it just happened unless a tool result explicitly returns it as the answer to a "last match" question.`;
};

// BUG FIX: this had grown to ~2600 characters across several rounds of
// one-off patches, on top of BASE_SYSTEM_PROMPT + dateContext() — every
// character here is read by the model on EVERY single completion() call
// (pass 1 AND pass 2), so a bloated system prompt is a real, direct,
// measurable cost on top of an already CPU-bound device, not just noise.
// Consolidated to the same set of rules with far fewer words.
const TOOLS_SYSTEM_SUFFIX = ` Your training data is stale and knows nothing live — never answer from memory, never say "I don't have real-time access." Real, working tools, at most one per question: get_today_fixtures (today's games/scores), get_team_form (a team's recent results), get_player_stats (a player's real goals/assists/minutes/rating, recent matches — not filtered by competition, so call it anyway for a tournament-specific question and just note the numbers are recent overall form, not filtered to that tournament, rather than refusing outright). Calling one actually fetches live data now — not a simulation, never something you "can't execute." The FIFA World Cup 2026 is happening this month, not a future event.

Nothing covers general news/transfers/injuries or anything else — say so plainly rather than guessing. Never fabricate a tool result: no "tool_response", no JSON, no bracketed data block as your own text — that's for the real mechanism only. A real tool result in the conversation (a line like "[RECENT RESULTS — ...]") is data to reason over, never to quote or repeat verbatim.

Only skip tools for pure tactics/history/opinion questions with no time-sensitive facts. When you decide to use a tool, call it through the actual function-calling mechanism only — never write the tool's name, or a sentence describing that you're about to use one, as part of your visible answer text. And never describe your own tools to the user by their internal function names (e.g. "get_today_fixtures") even when directly asked what you can do — describe them in plain English instead (e.g. "I can check today's fixtures or a team's recent results"). When a tool result names a competition/league for a match, mention it in your answer — never just "Team A vs Team B" when you know which tournament it's in.`;

const NO_TOOLS_SYSTEM_SUFFIX = ` This session has no live data tools available. For anything truly current (today's scores, this week's news) say briefly that you're working from general knowledge rather than inventing specific recent numbers — but still commit to a real, useful answer from what you do know. Never say "I don't have real-time access" as a refusal.`;

const buildSystemPrompt = (toolsEnabled: boolean) =>
  BASE_SYSTEM_PROMPT + dateContext() + (toolsEnabled ? TOOLS_SYSTEM_SUFFIX : NO_TOOLS_SYSTEM_SUFFIX);

const SCOUT_TOOLS: Tool[] = [
  {
    type: 'function',
    name: 'get_today_fixtures',
    description: "Get today's football matches and scores from TheSportsDB. Use when the user asks about today's games, fixtures, live scores, or who is playing.",
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'get_team_form',
    description: "Get a football TEAM's recent match results (W/D/L, scores, dates) from TheSportsDB. TEAM-level only — use get_player_stats instead for an individual player's goals/assists/minutes. Use this for a specific team's recent form, results, or performance.",
    parameters: {
      type: 'object',
      properties: {
        team_name: { type: 'string', description: 'Name of the football team' },
      },
      required: ['team_name'],
    },
  },
  {
    type: 'function',
    name: 'get_player_stats',
    description: "Get a football PLAYER's real per-match stats (goals, assists, minutes played, match rating) over their last few appearances, from Bzzoiro Sports. Use for any question about an individual player's goals, assists, or recent performance.",
    parameters: {
      type: 'object',
      properties: {
        player_name: { type: 'string', description: 'Full or partial name of the football player' },
      },
      required: ['player_name'],
    },
  },
];

// The SDK auto-detects tool-call output dialect "from the model name", but
// that auto-detection missed for Gemma — verified live, its RAW special
// tokens leaked straight into the visible answer as literal text:
// "<|tool_call>call:get_player_stats{player_name:<|"|>Messi<|"|>}<tool_call|>"
// — exactly the SDK's own documented "gemma4" dialect shape
// (completion-stream.d.ts), never intercepted/parsed at all. Passing
// toolDialect explicitly, keyed off the actually-loaded model's name
// rather than trusting auto-detect, is the real fix — not another prompt
// tweak or leak-regex, since this isn't narrated text, it's the model's
// genuine native tool-call syntax slipping through unparsed.
// BUG FIX: MedPsy used to fall through to "let the SDK auto-detect" —
// verified against the SDK's own actual detection source
// (dist/server/utils/tools/dialect.js, detectToolDialectFromName): it
// pattern-matches the registry filename against qwen3.5/3.6, gemma-4,
// gpt-oss, and lfm specifically, defaulting to "hermes" for anything that
// doesn't match — which is every model Scout ships except Gemma. Made
// explicit for MedPsy too rather than leaving its correctness resting on
// an implicit fallback nobody had actually verified until now.
function toolDialectForModelName(name: string): ToolDialect | undefined {
  if (/gemma/i.test(name)) return 'gemma4';
  if (/qwen|medpsy/i.test(name)) return 'hermes';
  return undefined;
}

// Small/quantized on-device models sometimes narrate the tool-calling
// decision as plain text instead of actually invoking the SDK's structured
// mechanism — verified live: a real response was "I need to check today's
// fixtures... get_today_fixtures" with nothing after it, shown to the user
// as the FINAL answer since toolCalls came back empty. Reports whether this
// looks like a get_today_fixtures attempt specifically — the one tool with
// no arguments, so it's the one case worth recovering automatically (by
// actually calling it) rather than guessing at arguments from garbled prose.
// A worse variant of the same failure: instead of just narrating a tool
// name, the model fabricates an entire fake "tool_response" block —
// verified live, asked for a team's last match, it invented
// `tool_response\n[{"match": "...", "date": "2022-12-18", "score": "0-0"}]`
// wholesale (that shape matches none of this app's real tool-result
// formats) and then answered off its own made-up data. Cosmetically
// stripping the JSON isn't enough here — the DATA itself is fake, so the
// whole answer built on it has to be discarded, not just cleaned up.
// Broadened after a second live fabrication: the model wrapped the same
// invented data in its OWN bracket tag — "[tool_response]\n{...}\n
// [/tool_response]" — which the original pattern (requiring "tool_response"
// to be immediately followed by "[" or "{") never matched, since a "]"
// closing the opening tag sits in between. Matches either shape now.
const FABRICATED_TOOL_RESPONSE_RE = /\[\/?\s*tool[_ ]?response\s*\]|\btool[_ ]?response\b\s*:?\s*[\[{]/i;

// Defense-in-depth backstop for the raw-token leak fixed by passing
// toolDialect explicitly above — if a dialect mismatch ever slips through
// again for some other model/version, this recovers the REAL call from
// Gemma's own documented raw shape rather than just discarding it:
// "<|tool_call>call:NAME{key:<|"|>val<|"|>,...}<tool_call|>"
const GEMMA_RAW_TOOL_CALL_RE = /call:(\w+)\{([^}]*)\}/;
function parseGemmaRawToolCall(text: string): { name: string; arguments: Record<string, string> } | null {
  const m = text.match(GEMMA_RAW_TOOL_CALL_RE);
  if (!m) return null;
  const args: Record<string, string> = {};
  for (const pair of m[2].split(',')) {
    const [key, ...rest] = pair.split(':');
    if (!key || rest.length === 0) continue;
    const value = rest.join(':').replace(/<\|"?\|?>/g, '').trim();
    args[key.trim()] = value;
  }
  return { name: m[1], arguments: args };
}

// Same backstop, for the OTHER dialect Scout actually ships models in —
// Qwen and MedPsy both resolve to "hermes" (see toolDialectForModelName
// above), whose raw shape is a JSON payload wrapped in a tag:
// "<tool_call>\n{\"name\": \"get_team_form\", \"arguments\": {...}}\n</tool_call>"
// The Gemma backstop only matches gemma4's own distinct call:NAME{...}
// syntax, so a hermes-dialect leak would have slipped past it entirely —
// this was a real gap, not just Gemma-specific insurance.
const HERMES_RAW_TOOL_CALL_RE = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/i;
function parseHermesRawToolCall(text: string): { name: string; arguments: Record<string, any> } | null {
  const m = text.match(HERMES_RAW_TOOL_CALL_RE);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (parsed && typeof parsed.name === 'string') {
      return { name: parsed.name, arguments: parsed.arguments ?? {} };
    }
  } catch { /* malformed JSON in the leaked tag — nothing safe to recover */ }
  return null;
}

// Verified live (Think mode): the model's own reasoning explicitly stated
// "Since I cannot actually execute the tool here, I must state that I am
// checking the form" — it doesn't believe its tool access is real, so it
// narrates a confident-sounding status line and then produces nothing
// further, a dead end with no recovery. The exact phrasing varies too
// much to catch reliably ("checking the team form for Argentina...", "I
// am checking Messi's last few match statistics now.", "I need to check
// his recent match statistics for that." — the last one doesn't even
// name the player, it's in the PREVIOUS message) — so the primary source
// for the entity name is the user's own question, not the narration.
// People reliably capitalize a name even in casual, lowercase-everything-
// else text (verified in the same screenshots), which is a much stronger
// signal than trying to parse the model's inconsistent prose.
const STOPWORDS = new Set(['I', 'How', 'What', 'Who', 'When', 'Where', 'Why', 'Ok', 'Is', 'Are', 'Do', 'Does', 'Can', 'Will', 'The', 'A', 'An']);
function extractProperNoun(text: string): string | null {
  const matches = [...text.matchAll(/\b([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){0,2})\b/g)]
    .map(m => m[1])
    .filter(name => !STOPWORDS.has(name.split(' ')[0]));
  return matches[0] ?? null;
}
const PLAYER_HINT_RE = /\b(goal|goals|assist|score|scored|player)\b/i;
const TEAM_HINT_RE = /\b(form|result|results|performance|team)\b/i;

// Defensive backstop for pass 2 (the answer after a REAL tool call ran) —
// unlike pass 1, nothing sanitized this path before. get_today_fixtures/
// get_team_form/get_player_stats all feed their raw result back as a
// `[LABEL — source]\n...\n[END LABEL]`-shaped tool message; a small model
// can plausibly echo those exact header/footer lines back verbatim
// instead of writing its own sentence. Strips only the marker lines
// themselves (not the prose around them), so a genuine slip never shows
// the internal formatting even though the system prompt now also tells
// the model directly not to do this.
// Header and footer labels aren't symmetric ("[RECENT RESULTS — ...]" ends
// with "[END RESULTS]", not "[END RECENT RESULTS]") — matched exactly as
// each formatter in teamStats.ts/MatchAIScreen.tsx/bzzoiro.ts actually
// emits them, not guessed.
const DATA_MARKER_LINE_RE = /^\[(?:RECENT RESULTS|LIVE FIXTURES|PLAYER STATS)[^\]]*\]$|^\[END (?:RESULTS|FIXTURES|PLAYER STATS)\]$/gm;
const stripLeakedDataMarkers = (text: string): string =>
  text.replace(DATA_MARKER_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trim();

function detectLeakedToolCall(text: string, thinking: string, userQuestion: string): {
  impliedFixturesCall: boolean;
  impliedTeamForm: string | null;
  impliedPlayerStats: string | null;
  fabricated: boolean;
} {
  const fabricated = FABRICATED_TOOL_RESPONSE_RE.test(text);
  // BUG FIX: this used to strip EVERY occurrence of a tool name from the
  // text unconditionally — verified live, asked "what can you check?", the
  // model legitimately listed its own tool names in a normal sentence, and
  // stripping them left "I only have access to: , and ` .`" with visible
  // holes where the names used to be. A tool name appearing mid-sentence
  // in an otherwise coherent answer is NOT the same failure as narrating a
  // failed call attempt — only the specific implied-call patterns below get
  // auto-recovered (by actually calling the tool); every other mention is
  // left completely alone rather than guessed at and mangled.
  const impliedFixturesCall = !fabricated
    && new RegExp(`\\bget_today_fixtures\\b`, 'i').test(text)
    && !new RegExp(`\\bget_team_form\\b`, 'i').test(text);
  // The dead-end pattern: toolCalls is already empty (checked by the
  // caller) and the answer itself is just a stalled "checking..." status
  // line rather than a real answer — that combination is the actual
  // signal something's stuck, independent of exact wording.
  const looksStuck = !fabricated && !impliedFixturesCall
    && /\b(check(?:ing)?|need to|going to|let me|i'll)\b/i.test(text);
  const combined = `${text}\n${thinking}`;
  let impliedTeamForm: string | null = null;
  let impliedPlayerStats: string | null = null;
  if (looksStuck) {
    const isPlayer = PLAYER_HINT_RE.test(combined) || PLAYER_HINT_RE.test(userQuestion);
    const isTeam = TEAM_HINT_RE.test(combined) || TEAM_HINT_RE.test(userQuestion);
    // Explicit "for X" in the model's own narration is the highest-
    // confidence source when present; the user's actual question is the
    // fallback, since it reliably names the subject even when the
    // narration doesn't (verified: "I need to check his recent match
    // statistics for that." never names Messi at all — only the
    // question two turns back does).
    const name = combined.match(/\bfor\s+([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,2})/)?.[1]
      ?? extractProperNoun(userQuestion)
      ?? extractProperNoun(combined);
    if (name) {
      // A player question beats a team one when both hint patterns are
      // present (e.g. "how many goals for Argentina" mentions both
      // "goals" and a country) — asking about goals/assists is asking
      // about a person's stat far more often than a team's.
      if (isPlayer || !isTeam) impliedPlayerStats = name;
      else impliedTeamForm = name;
    }
  }
  return {
    impliedFixturesCall,
    impliedTeamForm,
    impliedPlayerStats,
    fabricated,
  };
}

// Four fixed category cards whose questions rotate automatically —
// fresh suggestions every few seconds, no manual "More" needed
const CATEGORY_POOLS = [
  { tag: 'TACTICS', qs: [
    'How does a high press work in modern football?',
    'How do you break down a low block?',
    'Compare 4-3-3 vs 4-2-3-1 formations.',
    'Explain gegenpressing in simple terms.',
    'What is a false nine and when do you use one?',
  ]},
  { tag: 'PLAYERS', qs: [
    'What makes Mbappe the fastest player right now?',
    'Best striker in Champions League history?',
    'What makes a great defensive midfielder?',
    'Box-to-box vs holding midfielder — the difference?',
    'How do clubs scout young players?',
  ]},
  { tag: 'WC 2026', qs: [
    'Who are the top favorites for FIFA World Cup 2026?',
    'Greatest World Cup final ever played?',
    'Best World Cup goals of all time?',
    'Which dark horse could surprise at WC 2026?',
    'How does the 48-team World Cup format work?',
  ]},
  { tag: 'RULES', qs: [
    'Explain the offside rule with a simple example.',
    'How does VAR actually work?',
    'What counts as a handball now?',
    'How does penalty shootout psychology work?',
    'When is a tackle a red card?',
  ]},
];

// Animated three-dot typing indicator (the static one looked frozen)
function TypingDots({ color }: { color: string }) {
  const dots = useRef([new Animated.Value(0.25), new Animated.Value(0.25), new Animated.Value(0.25)]).current;
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 160),
        Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(d, { toValue: 0.25, duration: 320, useNativeDriver: true }),
        Animated.delay((2 - i) * 160),
      ])),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 3 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, opacity: d }} />
      ))}
    </View>
  );
}

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Morning, coach';
  if (h < 17) return 'Afternoon, coach';
  return 'Evening, coach';
};

const CAT_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  'TACTICS': IconTactics,
  'PLAYERS': IconPlayers,
  'WC 2026': IconTrophy,
  'RULES': IconRules,
};

interface Entry {
  id: string;
  question: string;
  // A Coach message is text, or image + text: `image` is a local photo URI
  // attached to the question. Unused at launch (no camera in the input bar
  // yet) but defined NOW so vision can return as an upgrade to Coach — a
  // camera icon in the input bar feeding a multimodal model — without a
  // data-shape refactor. This one optional field is the whole
  // forward-compat contract; do not remove it as "dead".
  image?: string;
  answer: string;
  thinking?: string;
  thinkingMs?: number;
  elapsed?: number;
  toks?: number;
  device?: 'cpu' | 'gpu';  // which backend actually ran this — real, on-device inference proof
  liveSources?: string[];  // deduped source names, e.g. ['TheSportsDB', 'Bzzoiro Sports']
  liveData?: string;  // the raw tool result the model actually saw — user-visible on demand
}

interface StreamSlot {
  id: string;
  question: string;
  image?: string;
  answer: string;
  thought: string;
  isThinking: boolean;
  toolStatus: string | null;  // non-null while a tool call is executing
  liveSources: string[];
  liveData: string;
}

export default function MatchAIScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();
  const accent = theme.accent;

  const [entries, setEntries]           = useState<Entry[]>([]);
  const [slot, setSlot]                 = useState<StreamSlot | null>(null);
  const [input, setInput]               = useState('');
  // Staged photo for the next message — the `Entry.image` field this feeds
  // was defined at launch specifically for this, see its own comment.
  const [pendingImage, setPendingImage]  = useState<string | null>(null);
  const [pickingImage, setPickingImage]  = useState(false);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  // The composer docks directly above the floating tab bar. When the
  // keyboard opens the tab bar hides itself (see TabBar.tsx), so the
  // composer's bottom padding collapses and it pins to the keyboard.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const [isGenerating, setIsGenerating] = useState(false);
  // Live ticking counter from the moment send() actually fires — the
  // "Thinking..." label used to sit static with no number for however
  // long prompt processing took (tens of seconds on-device, before the
  // model emits even its first reasoning token), which read as frozen
  // rather than working. Ticks every second while a request is in flight.
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null);
  const [liveElapsedS, setLiveElapsedS] = useState(0);
  useEffect(() => {
    if (genStartedAt == null) { setLiveElapsedS(0); return; }
    const id = setInterval(() => setLiveElapsedS(Math.floor((Date.now() - genStartedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [genStartedAt]);
  const [modelId, setModelId]           = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [noModel, setNoModel]           = useState(false);
  // Distinct from noModel: a model IS downloaded but ensure() threw (low
  // RAM, corrupted file, native crash). Conflating this with "no model
  // downloaded" — the bug this replaces — told users to go re-download a
  // model they already had, with no way to just retry the load.
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [loadPct, setLoadPct]           = useState(0);
  const [menuOpen, setMenuOpen]         = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickableModels, setPickableModels] = useState<import('../types').DownloadedModel[]>([]);
  const [thinkingOn, setThinkingOn]     = useState(false);
  const [thoughtOpen, setThoughtOpen]   = useState<Record<string, boolean>>({});
  const [dataOpen, setDataOpen]         = useState<Record<string, boolean>>({});
  // Card questions rotate automatically while the empty state is visible
  const [catIdx, setCatIdx] = useState(() => Math.floor(Math.random() * 5));

  const scrollRef        = useRef<ScrollView>(null);
  const currentRunRef    = useRef<any>(null);
  // Hard-stop flag: cancel() can take seconds to propagate into llama.cpp,
  // so the stream loops also bail out locally the moment this is set —
  // the Stop button must FEEL instant.
  const abortRef         = useRef(false);
  // Guards the notification-based cancel path against acting on a stale
  // registration — see the requestId/token check in send() below.
  const activeSendTokenRef = useRef(0);
  const mountedRef       = useRef(true);
  const prefillFiredRef  = useRef(false);
  const prefillRef       = useRef<string | null>(null);
  const sessionIdRef     = useRef<string | null>(null);
  const loadPulse        = useRef(new Animated.Value(0.4)).current;
  const loadLoopRef      = useRef<Animated.CompositeAnimation | null>(null);
  const entryAnimsRef    = useRef<Record<string, { ty: Animated.Value; op: Animated.Value }>>({});
  const slotRef          = useRef<typeof slot>(null);
  const modelNameRef     = useRef<string>('');
  const toolsEnabledRef  = useRef(false);
  const modelTypeRef     = useRef<'text' | 'vision'>('text');
  const toolDialectRef   = useRef<ToolDialect | undefined>(undefined);
  const lastScrollRef    = useRef(0);

  // Streaming fires ~25 flushes/sec — scrolling on each one janks the UI
  // while llama.cpp is already saturating the CPU. Cap scrolls to 4/sec.
  const throttledScroll = () => {
    const now = Date.now();
    if (now - lastScrollRef.current > 250) {
      lastScrollRef.current = now;
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  };

  useEffect(() => { slotRef.current = slot; }, [slot]);

  // Auto-rotate the category card questions while the empty state is
  // visible. Fades out, swaps the text, fades back in — an instant text
  // swap every few seconds read as "jumpy"; this reads as a calm update.
  const cardFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (entries.length > 0 || slot) return;
    const t = setInterval(() => {
      Animated.timing(cardFade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setCatIdx(i => i + 1);
        Animated.timing(cardFade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      });
    }, 10000);
    return () => clearInterval(t);
  }, [entries.length, !!slot]);

  useEffect(() => {
    mountedRef.current = true;
    loadModel();
    // Sync Think mode default from global settings
    getSettings().then(s => {
      if (mountedRef.current) setThinkingOn(s.deepReasoning ?? false);
    }).catch(() => {});
    return () => {
      mountedRef.current = false;
      clearNotification();
      loadLoopRef.current?.stop();
      if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
    };
  }, []);

  // BUG FIX: this used to be a mount-once effect, but React Navigation
  // reuses an already-mounted 'MatchAI' screen instance instead of always
  // remounting it (same issue found in History) — resuming a conversation,
  // leaving without fully unmounting the screen, then resuming again (or
  // any re-focus that doesn't recreate the component) meant this restore
  // logic never ran a second time, so the chat looked wiped even though
  // the messages were safely saved in SQLite the whole time. Re-sync on
  // every focus instead, guarded so it only reloads when the target
  // session actually changes (never clobbers an active conversation).
  const lastResumedIdRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const resumeId: string | undefined = route.params?.resumeSessionId;
      if (!resumeId || resumeId === lastResumedIdRef.current) return;
      lastResumedIdRef.current = resumeId;
      try {
        const msgs = getMessages(resumeId);
        const restored: Entry[] = [];
        for (let i = 0; i < msgs.length; i++) {
          if (msgs[i].role === 'user') {
            const next = msgs[i + 1];
            restored.push({
              id: `r-${msgs[i].id}`,
              question: msgs[i].content,
              image: msgs[i].meta?.image,
              answer: next?.role === 'assistant' ? next.content : '',
              elapsed: next?.meta?.elapsed,
              toks: next?.meta?.toks,
              thinking: next?.meta?.thinking,
              thinkingMs: next?.meta?.thinkingMs,
            });
          }
        }
        if (restored.length > 0) {
          // BUG FIX: resuming a DIFFERENT session while a generation from
          // the previous one is still streaming used to leave that
          // generation's live bubble (slot/isGenerating) rendering on top
          // of the just-restored, unrelated conversation — the in-flight
          // reply keeps going in the background (it still saves correctly
          // to ITS OWN session, see mySessionId in send()) but has no
          // business appearing in THIS view anymore.
          if (sessionIdRef.current !== resumeId) setSlot(null);
          setEntries(restored);
          sessionIdRef.current = resumeId;
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 120);
        }
      } catch {}
    }, [route.params?.resumeSessionId])
  );

  // Predictor and Coach each track their own modelId, but there's only
  // one resident model app-wide — if the model was stopped from the OTHER
  // tab (or evicted for any reason) while this one wasn't focused, its
  // local modelId would otherwise stay stale and the pill would keep
  // claiming "Model ready" for a model that no longer exists.
  useFocusEffect(useCallback(() => {
    if (modelId && llmManager.getLoadedQvacId() !== modelId) {
      setModelId(null);
    }
  }, [modelId]));

  // Repurposed for the tool-status dot below (was driven by modelLoading
  // before that state moved to the small header pill) — a live pulse on
  // "Checking today's fixtures..." reads as active progress instead of a
  // label that might as well be frozen, which is the whole point of
  // surfacing tool calls in the first place.
  useEffect(() => {
    if (slot?.toolStatus) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(loadPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(loadPulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
      ]));
      loadLoopRef.current = loop;
      loop.start();
    } else {
      loadLoopRef.current?.stop();
      Animated.timing(loadPulse, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
  }, [slot?.toolStatus]);

  const loadSpecificModel = async (model: import('../types').DownloadedModel) => {
    setLoadError(null);
    setModelLoading(true);
    setLoadPct(0);
    try {
      // Text models get tools by default; vision fallback models need an
      // explicit supportsTools: true (see models.ts) since most multimodal
      // chat templates don't reliably support function-calling — Gemma is
      // marked true as an active experiment, SmolVLM2 is not.
      const supportsTools = model.supportsTools ?? model.modelType === 'text';
      const mid = await llmManager.ensure(
        model,
        { ctx_size: model.modelType === 'vision' ? 2048 : 4096, device: 'auto', tools: supportsTools, projectionModelSrc: model.projectionModelSrc },
        pct => { if (mountedRef.current) setLoadPct(Math.round(pct)); },
      );
      modelNameRef.current = model.name;
      toolsEnabledRef.current = supportsTools;
      modelTypeRef.current = model.modelType === 'vision' ? 'vision' : 'text';
      toolDialectRef.current = toolDialectForModelName(model.name);
      if (mountedRef.current) {
        setModelId(mid);
        setModelLoading(false);
        const prefill = route.params?.prefill;
        if (prefill && !prefillFiredRef.current) {
          prefillFiredRef.current = true;
          prefillRef.current = prefill; // fired via useEffect once modelId is set
        }
      }
    } catch (e: any) {
      // A model exists but failed to load — NOT the same as "no model
      // downloaded". Surface a real message + retry button instead of
      // silently pointing the user at Models to re-download something
      // they already have.
      if (mountedRef.current) {
        setLoadError(e?.message || 'Could not load the model. Close other apps to free memory and try again.');
        setModelLoading(false);
      }
    }
  };

  // Default "Load Model" tap — auto-picks the same way it always has when
  // there's nothing to choose between; opens the picker instead when
  // multiple text models are downloaded (see rightSlot's onLoad override).
  const loadModel = async () => {
    const synced = await syncModelsFromDisk();
    const defaultId = await getDefaultModelId();
    // BUG FIX: this used to always silently auto-pick — a user with
    // several downloaded models never got asked which one they actually
    // wanted; they'd only discover the choice existed at all by noticing
    // the "wrong" one had loaded and manually hitting Load Model/Try
    // Again. Ask up front, once, the first time there's a real choice and
    // no preference has ever been recorded — not on every tab visit (the
    // already-loaded-model check keeps it from interrupting a switch
    // between Coach/Predictor once something's resident).
    const textModels = synced.filter(m => m.modelType === 'text');
    if (textModels.length > 1 && !defaultId && !llmManager.getLoadedModelId()) {
      setPickableModels(textModels);
      setModelPickerOpen(true);
      return;
    }
    const model = pickTextCapable(synced, defaultId, llmManager.getLoadedModelId());
    if (!model) {
      if (mountedRef.current) setNoModel(true);
      return;
    }
    await loadSpecificModel(model);
  };

  // Picking from the modal (either the proactive first-load prompt above
  // or a manual "Load Model" re-pick) sets that choice as the ongoing
  // default too — otherwise every single future load (including the
  // silent auto-pick path above) would go right back to asking, or worse,
  // silently reverting to whatever pickTextCapable's own fallback prefers.
  const selectModel = async (model: import('../types').DownloadedModel) => {
    await setDefaultModelId(model.id).catch(() => {});
    await loadSpecificModel(model);
  };

  // What the pill's "Load Model"/"Try Again" actually calls — only shows
  // the picker when there's a real choice to make (2+ text models
  // downloaded); otherwise behaves exactly like before, no extra tap.
  const handleLoadPress = async () => {
    const synced = await syncModelsFromDisk();
    const textModels = synced.filter(m => m.modelType === 'text');
    if (textModels.length > 1) {
      setPickableModels(textModels);
      setModelPickerOpen(true);
      return;
    }
    await loadModel();
  };

  // On-demand switch for the image-upload flow — Coach normally loads a
  // text model (loadModel above); attaching a photo needs a vision model
  // resident instead. Returns false when no vision model is downloaded at
  // all, so the caller can prompt the user to get one.
  const ensureVisionModel = async (): Promise<boolean> => {
    if (modelId && modelTypeRef.current === 'vision') return true;
    const synced = await syncModelsFromDisk();
    const visionModel = pickVisionCapable(synced, llmManager.getLoadedModelId());
    if (!visionModel) return false;
    setModelLoading(true);
    setLoadError(null);
    setLoadPct(0);
    try {
      const supportsTools = visionModel.supportsTools ?? false;
      // BUG FIX: 'auto' deferred to the global CPU-default accelerator
      // setting — every vision load ran on CPU only unless the user had
      // separately opted into GPU in Settings, which nobody would think
      // to do just to read a photo. Image encoding is exactly the
      // workload GPU acceleration helps most; explicitly requesting it
      // here (with modelManager's now-unconditional CPU fallback on
      // failure, see modelManager.ts) is the real lever for "why is this
      // so much slower than other apps running the same model."
      const mid = await llmManager.ensure(
        visionModel,
        { ctx_size: 2048, device: 'gpu', tools: supportsTools, projectionModelSrc: visionModel.projectionModelSrc },
        pct => { if (mountedRef.current) setLoadPct(Math.round(pct)); },
      );
      modelNameRef.current = visionModel.name;
      toolsEnabledRef.current = supportsTools;
      modelTypeRef.current = 'vision';
      toolDialectRef.current = toolDialectForModelName(visionModel.name);
      if (mountedRef.current) { setModelId(mid); setModelLoading(false); }
      return true;
    } catch (e: any) {
      if (mountedRef.current) {
        setLoadError(e?.message || 'Could not load the vision model. Close other apps to free memory and try again.');
        setModelLoading(false);
      }
      return false;
    }
  };

  // Frees the resident model so the small status pill's Stop control does
  // something real — Coach and Predictor are separate tab instances that
  // each track their own modelId, so stopping from one leaves the other's
  // local state stale until it notices (see the focus check below).
  const stopModel = async () => {
    await llmManager.release();
    setModelId(null);
  };

  const springEntry = (id: string) => {
    const anim = entryAnimsRef.current[id];
    if (!anim) return;
    Animated.parallel([
      Animated.spring(anim.ty, { toValue: 0, friction: 9, tension: 90, useNativeDriver: true }),
      Animated.timing(anim.op, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  // Upload icon in the composer — the vision upgrade promised since Lens
  // was pulled out as a standalone tab. Text-only model loaded (or no
  // vision model downloaded at all) gets a real prompt instead of silently
  // failing or sending an attachment the model can't see.
  const pickImage = async () => {
    if (isGenerating || pickingImage) return;
    setPickingImage(true);
    try {
      const synced = await syncModelsFromDisk();
      if (!pickVisionCapable(synced, llmManager.getLoadedModelId())) {
        Alert.alert(
          'Vision model needed',
          'Attaching a photo needs a vision model, which isn\'t downloaded yet. Get one from Models?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Go to Models', onPress: () => navigation.navigate('Models') },
          ],
        );
        return;
      }
      setPhotoSheetOpen(true);
    } finally {
      setPickingImage(false);
    }
  };

  // Vision models are slow to begin with — a large source photo (12MP+ phone
  // cameras) means more image tokens for the encoder to chew through before
  // the model can say a word. Downscaling to a sane chat-image size cuts
  // that cost without a visible quality loss for "what is this" questions.
  // Pushed down further from 896 — vision inference is still the slowest
  // path in the app by a wide margin (100s+ observed), and identifying a
  // jersey/badge/scoreboard doesn't need much resolution to work.
  const IMAGE_MAX_DIM = 640;
  const prepareImage = async (uri: string): Promise<string> => {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: IMAGE_MAX_DIM } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG },
      );
      return result.uri;
    } catch {
      return uri;
    }
  };

  const handleCamera = async () => {
    setPhotoSheetOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!res.canceled && res.assets[0]) await stageImage(await prepareImage(res.assets[0].uri));
  };

  const handleGallery = async () => {
    setPhotoSheetOpen(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (!res.canceled && res.assets[0]) await stageImage(await prepareImage(res.assets[0].uri));
  };

  // Loads the vision model NOW (rather than waiting until send) so the
  // thumbnail preview and the actual switch happen together — attaching a
  // photo and then hitting send on a stale text model would otherwise
  // silently ignore the image.
  const stageImage = async (uri: string) => {
    setPendingImage(uri);
    const ok = await ensureVisionModel();
    if (!ok && mountedRef.current) {
      setPendingImage(null);
      Alert.alert('Could not load vision model', 'Close other apps to free memory and try again.');
    }
  };

  const send = useCallback(async (question?: string) => {
    abortRef.current = false;
    // BUG FIX: registerInferenceCancel's closure reads currentRunRef fresh
    // each time it's invoked, which is correct WITHIN one send() call (it
    // needs to follow along from pass-1 to pass-2) — but Android can
    // redeliver a "Stop" notification action late (e.g. after the app was
    // backgrounded and resumed), and that stale tap has no way to know its
    // own message already finished. Verified live: a message rendered
    // "..." — the app's own fallback text for a cancelled request with no
    // answer yet — even though nothing in that conversation looked
    // deliberately stopped. This token scopes a registration to the exact
    // send() call that created it; a later call bumping the token
    // invalidates any stale registration regardless of timing.
    const mySendToken = ++activeSendTokenRef.current;
    // Captured and cleared immediately — the composer's thumbnail preview
    // shouldn't linger once the message carrying it has been sent.
    const image = pendingImage;
    // A photo with no typed text is a completely normal thing to send
    // ("what am I looking at?") — only block on empty when there's also no
    // image, rather than forcing everyone to type something first.
    const q = (question ?? input).trim() || (image ? 'What do you see in this photo?' : '');
    if (!q || isGenerating || !modelId) return;
    setPendingImage(null);
    setInput('');
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const entryId = `e-${Date.now()}`;
    entryAnimsRef.current[entryId] = { ty: new Animated.Value(24), op: new Animated.Value(0) };

    // BUG FIX: this send() call must keep writing to THE SESSION IT
    // STARTED IN, even if the user navigates to History and resumes a
    // DIFFERENT past conversation while this generation is still running
    // in the background — sessionIdRef.current is a shared mutable ref
    // that resume's useFocusEffect reassigns, so re-reading it at
    // completion time (rather than using the value captured here, right
    // now) could write this reply into whatever OTHER session happens to
    // be active when the model finally finishes, appending it to the
    // wrong conversation both on screen and in SQLite.
    let mySessionId = sessionIdRef.current;
    try {
      if (!mySessionId) {
        // BUG FIX: this used to be createSession() + addMessage() as two
        // separate statements in one try/catch — if the message insert
        // failed after the session insert succeeded, the assistant reply
        // (added later, unconditionally) still attached fine, leaving a
        // session with an assistant turn but no user turn: it still
        // showed up in History (has a message) but opened into a chat
        // with nothing to restore. startChatSession does both in one
        // transaction, same fix as Predictor's createPredictionSession.
        mySessionId = startChatSession('matchai', q, q, image ? { image } : undefined);
        sessionIdRef.current = mySessionId;
      } else {
        addMessage(mySessionId, 'user', q, image ? { image } : undefined);
      }
    } catch {}

    // Only the last 4 exchanges go to the model — prompt processing on CPU
    // scales with context, so unbounded history makes every reply slower
    const history: any[] = entries.slice(-4).map(e => [
      { role: 'user' as const, content: e.question },
      { role: 'assistant' as const, content: e.answer },
    ]).flat();
    const userMsg: any = { role: 'user', content: q };
    if (image) userMsg.attachments = [{ path: toPath(image) }];
    history.push(userMsg);

    setSlot({ id: entryId, question: q, image: image ?? undefined, answer: '', thought: '', isThinking: thinkingOn, toolStatus: null, liveSources: [], liveData: '' });
    setIsGenerating(true);
    setGenStartedAt(Date.now());
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

    let liveSources: string[] = [];
    let liveDataAcc = '';
    let answerAcc = '';
    let thoughtAcc = '';
    let lastFlush = 0;
    // BUG FIX: thinkMs used to measure from the first thinking TOKEN, not
    // from send — silently excluding prompt-processing time (loading the
    // system prompt + tool schemas + history before the model emits
    // anything), which can be tens of seconds on-device. "Thought for
    // X.Xs" now reflects the true wait from the moment the request was
    // actually sent, matching what the user watched the clock do.
    let thinkingStarted = false;
    let thinkMs = 0;

    try {
      const gp = await getGenParams();
      // BUG FIX: thinking and the final answer share ONE token budget for
      // models without native reasoning support (Gemma emits its "thinking"
      // as regular text, not a cheaper separate channel). At the default
      // 384-token cap, a long think (observed: 119s, hundreds of tokens)
      // left almost nothing for the actual answer, cutting it off mid-
      // sentence. Give Think mode a bigger ceiling so the answer still gets
      // its normal full budget after thinking concludes.
      // Vision inference on-device is already the slowest path in the app
      // (image tokens alone add real prompt-processing time on top of
      // generation) — a photo description doesn't need the same length
      // budget as a football analysis, so capping it tighter buys real
      // speed without cutting a normal answer off mid-thought.
      const genParams = {
        predict: image ? 220 : thinkingOn ? gp.maxTokens + 500 : gp.maxTokens,
        temp: gp.temp,
        top_k: gp.top_k,
        top_p: gp.top_p,
        repeat_penalty: gp.repeat_penalty,
        reasoning_budget: thinkingOn ? -1 as -1 : 0 as 0,
      };
      const t0 = Date.now();

      // ── Pass 1: completion with tools available ─────────────────────────
      // BUG FIX: this used to always reflect the GLOBAL tools toggle, even
      // for an image message — where `tools:` itself (below) is already
      // forced off. The model still saw "you have working tools, call one"
      // in its own system prompt with no structured mechanism actually
      // available for this turn, and would narrate/attempt a tool call
      // anyway — exactly the vision+tool-calling failure mode this was
      // supposed to avoid. Must match the real `tools:` value below.
      const toolsActiveThisTurn = !image && toolsEnabledRef.current;
      const run1 = completion({
        modelId,
        history: [{ role: 'system', content: buildSystemPrompt(toolsActiveThisTurn) }, ...history],
        stream: true,
        // Scout never used this before — every turn re-sent and re-processed
        // the ENTIRE system prompt + full history from scratch, every time.
        // Per the SDK's own docs: "When cache exists, only the last message
        // is sent to the model" — a real, sizeable prompt-processing cost
        // eliminated from turn 2 onward in a conversation, not just a
        // generation-speed tweak. Keyed per session so switching
        // conversations doesn't cross-contaminate caches.
        kvCache: mySessionId ?? true,
        // Vision + tool-calling together is unreliable on these on-device
        // models (see the supportsTools comment in loadModel) — an image
        // message always skips tools rather than risking the same
        // leaked-tool-call failure mode on top of an already harder task.
        tools: toolsActiveThisTurn ? SCOUT_TOOLS : undefined,
        // BUG FIX: auto-detected dialect missed Gemma — its raw tool-call
        // special tokens leaked into the visible answer as literal text
        // instead of being parsed into a real ToolCall. Explicit per the
        // loaded model, see toolDialectForModelName above.
        toolDialect: toolDialectRef.current,
        captureThinking: thinkingOn,
        generationParams: genParams,
      });
      currentRunRef.current = run1;
      registerInferenceCancel(() => {
        if (activeSendTokenRef.current !== mySendToken) return;
        abortRef.current = true;
        if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      });
      showRunningNotification('AI Coach');

      let pass1Answer = '';
      let pass1Raw = '';
      for await (const event of run1.events) {
        if (abortRef.current) break;
        if (event.type === 'thinkingDelta') {
          thinkingStarted = true;
          thoughtAcc += event.text;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 100) {
            lastFlush = now;
            setSlot(s => s ? { ...s, thought: thoughtAcc, isThinking: true } : s);
            throttledScroll();
          }
        } else if (event.type === 'contentDelta') {
          // Some models (Gemma in Think mode) don't use QVAC's thinkingDelta
          // channel at all — they emit reasoning as literal
          // "<|channel>thought...channel|>" text inside contentDelta itself.
          // Split it client-side so it never renders as the visible answer.
          pass1Raw += event.text;
          const split = splitChannelThinking(pass1Raw);
          // BUG FIX: Fast mode sets reasoning_budget: 0, but a model can
          // ignore that and emit "<|channel>thought...channel|>" text
          // anyway — this used to surface as a "Thought for X.Xs" block
          // regardless of mode, defeating the entire point of Fast mode
          // ("no thinking, ever"). Only track/show it in Think mode; the
          // split still runs either way so leaked thinking text never
          // pollutes the visible answer.
          if (thinkingOn && split.thought) {
            thinkingStarted = true;
            thoughtAcc = split.thought;
          }
          if (split.answer && thinkingStarted && !thinkMs) thinkMs = Date.now() - t0;
          pass1Answer = split.answer;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 100) {
            lastFlush = now;
            setSlot(s => s ? { ...s, answer: pass1Answer, thought: thoughtAcc, isThinking: thinkingOn && !!split.thought && !split.answer } : s);
            throttledScroll();
          }
        }
      }

      // BUG FIX: Stop only broke out of the streaming loop above — nothing
      // stopped the pipeline from then reading toolCalls, running the
      // live network tool-fetch loop, and kicking off an entirely NEW
      // Pass-2 completion() anyway. Throwing here (rather than a bare
      // return) routes through the SAME catch block below that already
      // knows how to clean up a cancelled run correctly — a bare return
      // would skip that and leave isGenerating/slot stuck forever.
      if (abortRef.current) throw new InferenceCancelledError(run1.requestId, { text: pass1Answer });

      let toolCalls = (await run1.toolCalls) ?? [];
      let finalStats = await run1.stats;
      if (abortRef.current) throw new InferenceCancelledError(run1.requestId, { text: pass1Answer });

      // Recovery path for the leaked-tool-call failure mode (see
      // detectLeakedToolCall) — get_today_fixtures needs no arguments so
      // it's always recoverable; get_team_form/get_player_stats only
      // recover when a confident entity name could be pulled from the
      // model's own narration/thinking, since guessing wrong is worse
      // than the honest fallback.
      let leakCleanedAnswer: string | null = null;
      // BUG FIX: neither recovery block used to check `image` — an image
      // turn always has `toolsActiveThisTurn` false (no structured tool
      // mechanism was ever offered this turn), but if the model still
      // narrated a stuck-sounding "let me check..." line, this would
      // recover it into a REAL tool call + pass-2 anyway, exactly the
      // vision+tool-calling combination `tools: undefined` above was
      // supposed to rule out.
      if (toolsActiveThisTurn && toolCalls.length === 0 && pass1Answer) {
        // Highest-priority recovery: this is the model's REAL, structured
        // tool-call attempt (raw dialect tokens), not a hallucination or
        // narration — trust its name/arguments directly rather than
        // falling through to the fuzzier narration-based recovery below.
        // Tries both dialects Scout actually loads models in — Gemma's
        // call:NAME{...} shape and hermes's <tool_call>{...}</tool_call>
        // JSON shape (Qwen/MedPsy) — only acted on if the name matches a
        // real tool, so unrelated bracket/tag-ish text can't misfire this.
        const rawCall = parseGemmaRawToolCall(pass1Answer) ?? parseHermesRawToolCall(pass1Answer);
        if (rawCall && SCOUT_TOOLS.some(t => t.name === rawCall.name)) {
          toolCalls = [{ name: rawCall.name, arguments: rawCall.arguments } as any];
        }
      }
      if (toolsActiveThisTurn && toolCalls.length === 0 && pass1Answer) {
        // Includes the last couple questions, not just the current one —
        // verified live: "I need to check his recent match statistics for
        // that." doesn't name anyone at all; "his" refers to a name the
        // user gave two messages earlier, not this one.
        const recentQuestions = [...entries.slice(-2).map(e => e.question), q].join('\n');
        const leak = detectLeakedToolCall(pass1Answer, thoughtAcc, recentQuestions);
        if (leak.fabricated) {
          // The data itself is invented, not just the syntax — cleaning up
          // the text would still leave a confident answer built on a fake
          // fact. Replace the whole thing with an honest admission instead.
          leakCleanedAnswer = "I don't have a reliable live source for that specific thing, so I won't guess a number — try asking again, or ask about a player's recent stats, a team's form, or today's fixtures instead.";
        } else if (leak.impliedFixturesCall) {
          toolCalls = [{ name: 'get_today_fixtures', arguments: {} } as any];
        } else if (leak.impliedTeamForm) {
          toolCalls = [{ name: 'get_team_form', arguments: { team_name: leak.impliedTeamForm } } as any];
        } else if (leak.impliedPlayerStats) {
          toolCalls = [{ name: 'get_player_stats', arguments: { player_name: leak.impliedPlayerStats } } as any];
        }
      }

      if (toolCalls.length > 0 && mountedRef.current) {
        // ── Tool execution ──────────────────────────────────────────────────
        if (mountedRef.current) { setSlot(s => s ? { ...s, toolStatus: 'Fetching data...', answer: '' } : s); }

        const toolHistory = [...history, { role: 'assistant' as const, content: pass1Answer }];

        for (const tc of toolCalls) {
          if (abortRef.current) throw new InferenceCancelledError(run1.requestId, { text: pass1Answer });
          let toolResult = 'No data available.';
          try {
            if (tc.name === 'get_today_fixtures') {
              setSlot(s => s ? { ...s, toolStatus: "Checking today's fixtures..." } : s);
              // BUG FIX: this used to always run a full fetchAndCacheFixtures()
              // — a live Bzzoiro call PLUS 4 separate TheSportsDB HTTP calls —
              // on every single fixtures question, even when the Matches tab
              // had already fetched (and cached) the exact same data moments
              // earlier. Verified live: one of these calls alone took 238.6s.
              // Reads the cache first (instant); only reaches for a live call
              // — Bzzoiro only, no TheSportsDB — when nothing's cached yet.
              let fixtures = getCachedFixturesNow();
              if (fixtures.length === 0) {
                const bzKey = await getActiveBzKey().catch(() => '');
                fixtures = bzKey ? await fetchBzMatches(bzKey, todayISO(), todayISO()).catch(() => []) : [];
              }
              toolResult = formatFixtureContext(fixtures) || 'No fixtures scheduled today.';
              liveSources.push('Bzzoiro Sports');
            } else if (tc.name === 'get_team_form') {
              const teamName = String(tc.arguments.team_name ?? '');
              setSlot(s => s ? { ...s, toolStatus: `Checking ${teamName || 'team'}'s recent form...` } : s);
              const bzKey = await getActiveBzKey().catch(() => '');
              const form = bzKey ? await fetchBzTeamForm(bzKey, teamName, 5).catch(() => null) : null;
              if (form && form.events.length > 0) {
                const lines = form.events.map(e =>
                  `${e.date} vs ${e.opponent}: ${e.score} (${e.result})${e.league ? ' — ' + e.league : ''}`
                );
                toolResult = [
                  `[RECENT RESULTS — ${form.teamName} via Bzzoiro Sports]`,
                  `Form (most recent last): ${form.form.join(' ')}`,
                  ...lines,
                  '[END RESULTS]',
                ].join('\n');
              } else {
                // BUG FIX: this used to fall back to a live
                // fetchAndCacheFixtures() (Bzzoiro + TheSportsDB) filtered
                // for the team — another full multi-source round trip when
                // Bzzoiro itself already came up empty. Checks the cache
                // (instant) and otherwise says so honestly rather than
                // reaching for a different source silently.
                const teamFix = getCachedFixturesNow().filter(f =>
                  f.strHomeTeam?.toLowerCase().includes(teamName.toLowerCase()) ||
                  f.strAwayTeam?.toLowerCase().includes(teamName.toLowerCase())
                );
                toolResult = teamFix.length > 0 ? formatFixtureContext(teamFix) : `No recent data found for ${teamName}.`;
              }
              liveSources.push('Bzzoiro Sports');
            } else if (tc.name === 'get_player_stats') {
              const playerName = String(tc.arguments.player_name ?? '');
              setSlot(s => s ? { ...s, toolStatus: `Checking ${playerName || 'player'}'s recent stats...` } : s);
              const bzKey = await getActiveBzKey().catch(() => '');
              const stats = bzKey ? await fetchPlayerStats(bzKey, playerName, 5).catch(() => null) : null;
              toolResult = stats ? formatPlayerStatsContext(stats) : `No recent stats found for ${playerName}.`;
              liveSources.push('Bzzoiro Sports');
            }
          } catch { toolResult = 'Unable to fetch data.'; }
          toolHistory.push({ role: 'tool', content: toolResult });
          liveDataAcc += (liveDataAcc ? '\n\n' : '') + toolResult;
        }

        if (!mountedRef.current) return;
        if (abortRef.current) throw new InferenceCancelledError(run1.requestId, { text: pass1Answer });
        setSlot(s => s ? { ...s, toolStatus: null, answer: '', liveSources: [...new Set(liveSources)], liveData: liveDataAcc } : s);

        // ── Pass 2: final answer incorporating tool results ─────────────────
        const run2 = completion({
          modelId,
          history: [{ role: 'system', content: buildSystemPrompt(toolsActiveThisTurn) }, ...toolHistory],
          stream: true,
          // Separate key from pass-1 — toolHistory has a different shape
          // (includes the tool result message), so it needs its own cache
          // entry rather than colliding with pass-1's under the same key.
          kvCache: mySessionId ? `${mySessionId}:tools` : true,
          captureThinking: false,
          // BUG FIX: this used to inherit genParams.predict unchanged — in
          // Fast mode that's gp.maxTokens (384 for the default "short"
          // length), the SAME cap a bare opinion answer gets. But pass-2's
          // job is specifically to reference real tool data (a multi-
          // fixture list, a team's last 5 results) — a genuinely more
          // token-hungry answer than "no tools needed" prose, and it was
          // getting cut off mid-sentence at exactly the moment it needed
          // more room, not less. Floors pass-2's budget regardless of
          // Fast/Think mode.
          generationParams: { ...genParams, predict: Math.max(genParams.predict, 600), reasoning_budget: 0 as 0 },
        });
        currentRunRef.current = run2;

        let pass2Raw = '';
        answerAcc = '';
        lastFlush = 0;
        for await (const event of run2.events) {
          if (abortRef.current) break;
          if (event.type === 'contentDelta') {
            pass2Raw += event.text;
            const split = splitChannelThinking(pass2Raw);
            answerAcc = split.answer;
            if (split.thought) thoughtAcc = split.thought;
            const now = Date.now();
            if (mountedRef.current && now - lastFlush > 100) {
              lastFlush = now;
              setSlot(s => s ? { ...s, answer: answerAcc } : s);
              throttledScroll();
            }
          }
        }
        finalStats = await run2.stats;
        // BUG FIX: pass-2 had ZERO fabrication check — verified live, fed a
        // REAL toolResult (today's actual TheSportsDB fixtures) in its own
        // history, the model still invented its own "[tool_response]" block
        // with entirely different, made-up fixtures and answered off THAT
        // instead of the real data it was given. Unlike pass-1's fabrication
        // (where no real data exists at all), the real result is already
        // sitting in liveDataAcc/liveSources and gets its own card below —
        // so the fallback here points at that instead of a blanket "no
        // source" apology, which would be actively misleading.
        if (FABRICATED_TOOL_RESPONSE_RE.test(answerAcc)) {
          answerAcc = "I mixed that up — the real data I found is shown below.";
        } else if (!answerAcc.trim()) {
          // BUG FIX: verified live (Think mode) — pass-2 can ALSO ignore
          // reasoning_budget: 0 and burn its entire token budget on hidden
          // reasoning-shaped text, leaving nothing for a real answer and
          // showing as a blank bubble even though the real tool result
          // came back fine. That result is already sitting in
          // liveDataAcc/liveSources with its own card below, so this
          // points at that instead of showing nothing.
          answerAcc = "Here's what I found — see the data below.";
        }
      } else {
        answerAcc = leakCleanedAnswer ?? pass1Answer;
      }
      // Applied once here, covering both the pass-2 (real tool result) and
      // pass-1-fallback paths in one place, right before the answer is
      // ever stored or shown as final — see stripLeakedDataMarkers above.
      answerAcc = stripLeakedDataMarkers(answerAcc);

      if (mountedRef.current) {
        setSlot(s => s ? { ...s, answer: answerAcc, thought: thoughtAcc, isThinking: false } : s);
        throttledScroll();
      }

      currentRunRef.current = null;
      clearNotification();

      const totalMs = Date.now() - t0;
      logInference('matchai', modelNameRef.current, finalStats?.timeToFirstToken ?? 0, totalMs, finalStats?.generatedTokens ?? 0).catch(() => {});

      const elapsed = Math.round(totalMs / 100) / 10;
      if (thinkingStarted && !thinkMs) thinkMs = totalMs;
      // mySessionId, not sessionIdRef.current — see the capture above.
      if (mySessionId && answerAcc) {
        addMessage(mySessionId, 'assistant', answerAcc, {
          elapsed, toks: finalStats?.generatedTokens,
          thinking: thoughtAcc || undefined, thinkingMs: thinkMs || undefined,
        });
      }

      if (mountedRef.current) {
        const finished: Entry = { id: entryId, question: q, image: image ?? undefined, answer: answerAcc, thinking: thoughtAcc || undefined, thinkingMs: thinkMs || undefined, elapsed, toks: finalStats?.generatedTokens, device: finalStats?.backendDevice, liveSources: [...new Set(liveSources)], liveData: liveDataAcc || undefined };
        setSlot(null);
        // Only append to the visible chat if we're still looking at the
        // conversation this reply actually belongs to — see mySessionId
        // above. It's already saved to its own session's row regardless,
        // so switching back to that conversation later still shows it.
        if (mySessionId === sessionIdRef.current) setEntries(prev => [...prev, finished]);
        setIsGenerating(false);
        setGenStartedAt(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => springEntry(entryId), 20);
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        const fallback = err instanceof InferenceCancelledError
          ? (slotRef.current?.answer || '...')
          : 'Could not get a response. Try again.\n\n[Report a bug](https://github.com/bolajiev/scout/issues/new)';
        const finished: Entry = { id: entryId, question: q, image: image ?? undefined, answer: fallback };
        setSlot(null);
        setEntries(prev => [...prev, finished]);
        setIsGenerating(false);
        setGenStartedAt(null);
        setTimeout(() => springEntry(entryId), 20);
      }
    }
  // BUG FIX: pendingImage was missing here — send() reads it at the top
  // (`const image = pendingImage`) but the callback only got recreated
  // when the other deps changed. Attaching a photo while a vision model
  // was ALREADY resident (ensureVisionModel returns early, modelId never
  // changes) meant send's closure still had the OLD pendingImage value —
  // verified: send a second photo with no typed text right after the
  // first reply and hit Send immediately, and it silently no-ops because
  // `image` was stale-null and `q` came back empty.
  }, [input, isGenerating, modelId, entries, thinkingOn, pendingImage]);

  // Fire prefill after send() is memoized with the real modelId
  useEffect(() => {
    if (modelId && prefillRef.current) {
      const q = prefillRef.current;
      prefillRef.current = null;
      setTimeout(() => send(q), 80);
    }
  }, [modelId, send]);

  // Claude-style thinking block: streams the thought live while the model
  // reasons, then collapses to a tappable "Thought for Xs" row.
  const renderThoughtBlock = (thought: string, isStreaming: boolean, entryId: string, thinkingMs?: number) => {
    // While streaming, render even before the first thinking token arrives —
    // the amber "Thinking..." header is the user's sign that work is happening
    if (!thought && !isStreaming) return null;
    const isOpen = isStreaming || thoughtOpen[entryId];
    const doneLabel = thinkingMs
      ? `Thought for ${(thinkingMs / 1000).toFixed(1)}s`
      : 'Thought process';
    return (
      <TouchableOpacity
        activeOpacity={isStreaming ? 1 : 0.7}
        onPress={() => !isStreaming && setThoughtOpen(p => ({ ...p, [entryId]: !p[entryId] }))}
        style={[
          styles.thoughtBlock,
          isStreaming
            ? { backgroundColor: '#1a1200' }
            : { backgroundColor: theme.cardAlt },
        ]}
      >
        <View style={styles.thoughtHeader}>
          <View style={[styles.thoughtDot, { backgroundColor: isStreaming ? '#f59e0b' : '#78716c' }]} />
          <Text style={[styles.thoughtLabel, { color: isStreaming ? '#f59e0b' : '#78716c' }]}>
            {isStreaming ? `Thinking... ${liveElapsedS}s` : doneLabel}
          </Text>
          {!isStreaming && (
            <Text style={[styles.thoughtChevron, { color: '#78716c' }]}>{isOpen ? '‹' : '›'}</Text>
          )}
        </View>
        {isOpen && thought.length > 0 && (
          <Text style={styles.thoughtText}>
            {thought}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderEntry = (entry: Entry) => {
    const anim = entryAnimsRef.current[entry.id];
    return (
      <Animated.View
        key={entry.id}
        style={[styles.entryBlock, anim ? { opacity: anim.op, transform: [{ translateY: anim.ty }] } : undefined]}
      >
        <View style={styles.userRow}>
          {entry.image && <Image source={{ uri: entry.image }} style={styles.userImage} />}
          <View style={[styles.userBubble, { backgroundColor: theme.cardAlt }]}>
            <Text style={styles.userText}>{entry.question}</Text>
          </View>
        </View>
        {entry.thinking && renderThoughtBlock(entry.thinking, false, entry.id, entry.thinkingMs)}
        <View style={styles.aiRow}>
          <View style={[styles.aiAvatar, { backgroundColor: accent }]}>
            <IconBall size={12} color={theme.accentFg} />
          </View>
          <View style={styles.aiCol}>
            <View style={[styles.aiBubble, { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]}>
              <Markdown style={mdStyles(theme)} rules={mdRules}>{entry.answer}</Markdown>
            </View>
            <View style={styles.statRow}>
              {entry.liveSources && entry.liveSources.length > 0 && (
                <TouchableOpacity
                  style={[styles.liveChip, { backgroundColor: 'rgba(198,245,58,0.14)' }]}
                  onPress={() => setDataOpen(p => ({ ...p, [entry.id]: !p[entry.id] }))}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <View style={[styles.liveDotSmall, { backgroundColor: '#C6F53A' }]} />
                  <Text style={[styles.liveChipText, { color: '#C6F53A' }]}>{entry.liveSources.join(' · ')}</Text>
                  {entry.liveData && (
                    <Text style={[styles.liveChipText, { color: '#C6F53A' }]}>{dataOpen[entry.id] ? ' ‹' : ' ›'}</Text>
                  )}
                </TouchableOpacity>
              )}
              {entry.elapsed != null && (
                <Text style={[styles.stat, { color: theme.textSecondary }]}>
                  {entry.elapsed}s{entry.toks ? ` · ${Math.round(entry.toks / (entry.elapsed || 1))} tok/s` : ''}{entry.device ? ` · ${entry.device.toUpperCase()}` : ''}
                </Text>
              )}
              <TouchableOpacity
                onPress={() => {
                  Clipboard.setStringAsync(entry.answer).catch(() => {});
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.copyBtn, { color: theme.textSecondary }]}>Copy</Text>
              </TouchableOpacity>
            </View>
            {/* Raw data the model actually saw — collapsed by default so the
                chat stays clean, but never hidden: the user asked for exactly
                this, since "TheSportsDB" alone doesn't say what was fetched */}
            {entry.liveSources && entry.liveSources.length > 0 && entry.liveData && dataOpen[entry.id] && (
              <View style={[styles.liveDataBlock, { backgroundColor: theme.cardAlt }]}>
                <Text style={[styles.liveDataText, { color: theme.textSecondary }]} selectable>
                  {entry.liveData}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Animated.View>
    );
  };

  // Finished entries re-render only when the list or theme changes — NOT on
  // every 40ms streaming flush. Markdown parsing is expensive; without this
  // memo a long chat would re-parse every bubble on each token batch.
  const renderedEntries = useMemo(
    () => entries.map(renderEntry),
    [entries, thoughtOpen, dataOpen, themeMode],
  );

  // ── Empty state — category chips, then a horizontal rail of question
  // cards. Everything is a one-tap question.
  // Simple, single-column suggestion rows — one per category, eyebrow tag +
  // question + chevron, straight to send() on tap. No chips, no horizontal
  // rails, no separate "insight" card — just four clear things to tap.
  // Model state now lives in the small persistent pill under the header —
  // this just always shows the suggestions, dimmed and untappable until
  // ready rather than swapping in a separate status card.
  const ready = !modelLoading && !!modelId;
  const renderEmpty = () => (
    <View style={styles.emptyWrap}>
      <Text style={[styles.greeting, { color: theme.textSecondary }]}>{getGreeting()}</Text>
      <View style={[styles.sugList, { opacity: ready ? 1 : 0.5 }]}>
        {CATEGORY_POOLS.map((cat) => {
          const q = cat.qs[catIdx % cat.qs.length];
          const Icon = CAT_ICONS[cat.tag] ?? IconBall;
          return (
            <TouchableOpacity
              key={cat.tag}
              style={[styles.sugRow, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => send(q)}
              activeOpacity={0.75}
              disabled={!ready}
            >
              <Icon size={15} color={theme.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.sugTag, { color: theme.textTertiary }]}>{cat.tag}</Text>
                <Animated.Text style={[styles.sugQuestion, { color: theme.text, opacity: cardFade }]} numberOfLines={2}>
                  {q}
                </Animated.Text>
              </View>
              <Text style={[styles.sugChevron, { color: theme.textTertiary }]}>›</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      // Android 15 + edge-to-edge ignores adjustResize — the keyboard must
      // be handled in JS or it covers the input bar
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header — Coach is full-screen chat: the tab bar hides while this
          tab is focused (see TabBar.tsx), so the back button here is the
          only way out. It returns to the Matches tab, not a stack pop —
          there's nothing on the stack to pop. */}
      <ScreenHeader
        title="AI Coach"
        centered
        onBack={() => navigation.navigate('Home')}
        rightSlot={
          <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <IconMore size={22} color={theme.text} />
          </TouchableOpacity>
        }
      />

      {/* New Chat / History — a single dropdown instead of two competing
          header links, so the header row stays clean and centered. */}
      {/* BUG FIX: navigationBarTranslucent was the ACTUAL source of the
          repeatedly-reported white strip, not the fix for it — verified in
          react-native's own ReactModalHostView.kt: when this prop is true,
          it calls `dialogWindow.enableEdgeToEdge()` on the Modal's OWN
          separate native window, which unconditionally forces
          isNavigationBarContrastEnforced back to true for that window —
          completely bypassing the Activity-level theme fix in styles.xml
          (android:enforceNavigationBarContrast), which only re-applies in
          MainActivity's onCreate, never for a Modal's dialog window.
          statusBarTranslucent alone (kept) doesn't trigger that code path. */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menuPanel, { top: insets.top + 52, backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
            <TouchableOpacity
              style={styles.menuRow}
              disabled={isGenerating}
              onPress={() => {
                setMenuOpen(false);
                setEntries([]);
                setSlot(null);
                sessionIdRef.current = null;
                setThoughtOpen({});
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Text style={[styles.menuRowText, { color: isGenerating ? theme.textTertiary : theme.text }]}>New Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                setMenuOpen(false);
                // dispatch(StackActions.push(...)) rather than
                // navigation.push(...) directly — Coach is nested inside
                // the bottom-tab navigator, which has no push method of
                // its own; StackActions.push bubbles up to the outer stack
                // that actually owns 'History' and always mounts a fresh
                // instance, avoiding the reused-instance param-sync bugs
                // that came from relying on navigate() + a focus effect.
                navigation.dispatch(StackActions.push('History', { tab: 'matchai' }));
              }}
            >
              <Text style={[styles.menuRowText, { color: theme.text }]}>History</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <ModelStatusPill
        noModel={noModel}
        modelLoading={modelLoading}
        loadError={loadError}
        modelId={modelId}
        loadPct={loadPct}
        onLoad={handleLoadPress}
        onStop={stopModel}
        onGetModel={() => navigation.navigate('Models')}
      />

      <ModelPickerModal
        visible={modelPickerOpen}
        models={pickableModels}
        currentModelId={modelId}
        onSelect={selectModel}
        onClose={() => setModelPickerOpen(false)}
      />

      <PhotoSourceSheet
        visible={photoSheetOpen}
        onCamera={handleCamera}
        onGallery={handleGallery}
        onClose={() => setPhotoSheetOpen(false)}
      />

      {/* Feed */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {entries.length === 0 && !slot && renderEmpty()}
        {renderedEntries}

        {/* Active streaming slot */}
        {slot && (
          <View style={styles.entryBlock}>
            <View style={styles.userRow}>
              {slot.image && <Image source={{ uri: slot.image }} style={styles.userImage} />}
              <View style={[styles.userBubble, { backgroundColor: theme.cardAlt }]}>
                <Text style={styles.userText}>{slot.question}</Text>
              </View>
            </View>
            {slot.toolStatus && (
              <View style={[styles.liveChip, { backgroundColor: 'rgba(198,245,58,0.14)', alignSelf: 'flex-start' }]}>
                <Animated.View style={[styles.liveDotSmall, { backgroundColor: '#C6F53A', opacity: loadPulse }]} />
                <Text style={[styles.liveChipText, { color: '#C6F53A' }]}>{slot.toolStatus}</Text>
              </View>
            )}
            {(slot.thought.length > 0 || slot.isThinking) && renderThoughtBlock(slot.thought, slot.isThinking, slot.id)}
            <View style={styles.aiRow}>
              <View style={[styles.aiAvatar, { backgroundColor: accent }]}>
                <IconBall size={12} color={theme.accentFg} />
              </View>
              {/* BUG FIX: this bubble used to sit directly in aiRow with no
                  width cap, unlike the finished-entry render path below —
                  a long unbroken streaming line pushed the whole row past
                  the screen edge while generating. aiCol's maxWidth: 90%
                  is what the finished bubbles already rely on. */}
              <View style={styles.aiCol}>
                <View style={[styles.aiBubble, { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]}>
                  {slot.answer.length > 0 ? (
                    <Text style={[styles.aiText, { color: theme.text }]}>{slot.answer}</Text>
                  ) : (
                    <TypingDots color={accent} />
                  )}
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Composer — one rounded card: text on top, controls inside at the
          bottom (Think toggle left, send right) */}
      {/* No tab bar on this screen, so the composer sits right at the
          bottom safe area instead of reserving pill space */}
      <View style={[styles.composerWrap, { backgroundColor: theme.background, paddingBottom: keyboardUp ? 10 : Math.max(insets.bottom, 12) }]}>
        <View style={[styles.composer, { backgroundColor: theme.cardAlt }]}>
          {pendingImage && (
            <View style={styles.stagedImageRow}>
              <Image source={{ uri: pendingImage }} style={styles.stagedImage} />
              <TouchableOpacity
                style={[styles.stagedImageRemove, { backgroundColor: theme.background }]}
                onPress={() => setPendingImage(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <IconClose size={12} color={theme.text} />
              </TouchableOpacity>
            </View>
          )}
          <TextInput
            style={[styles.composerInput, { color: theme.text }]}
            placeholder={modelLoading ? 'Loading model...' : noModel ? 'No model downloaded' : loadError ? 'Model load failed' : 'Ask anything'}
            placeholderTextColor={theme.textSecondary}
            value={input}
            onChangeText={setInput}
            multiline
            editable={!isGenerating && !modelLoading && !!modelId}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => { if (input.trim()) send(); }}
          />
          <View style={styles.composerRow}>
            <TouchableOpacity
              onPress={pickImage}
              disabled={isGenerating || pickingImage}
              style={[styles.uploadBtn, { backgroundColor: theme.cardHot, opacity: isGenerating ? 0.4 : 1 }]}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            >
              <IconCamera size={16} color={theme.textSecondary} />
            </TouchableOpacity>
            {/* ONE mode chip — shows the current mode, tap to switch.
                "Fast" ⇄ "Think", not two side-by-side buttons. */}
            <TouchableOpacity
              onPress={() => setThinkingOn(v => !v)}
              style={[styles.modeBtn, { backgroundColor: thinkingOn ? 'rgba(198,245,58,0.14)' : theme.cardHot }]}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            >
              <Text style={[styles.modeBtnText, { color: thinkingOn ? accent : theme.textSecondary }]}>
                {thinkingOn ? 'Think' : 'Fast'}
              </Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            {isGenerating ? (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: theme.error }]}
                onPress={() => { abortRef.current = true; if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {}); }}
              >
                <IconStop size={15} color="#0b0b0b" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: accent, opacity: (input.trim() || pendingImage) && modelId ? 1 : 0.35 }]}
                onPress={() => send()}
                disabled={(!input.trim() && !pendingImage) || !modelId || isGenerating}
              >
                <IconSend size={15} color={theme.accentFg} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// Markdown styling for finished AI answers — matches the bubble typography.
// Streaming text stays plain <Text> for performance; markdown renders on completion.
const mdStyles = (theme: ReturnType<typeof getTheme>) => ({
  body: { color: theme.text, fontSize: 16, lineHeight: 24 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  strong: { fontWeight: '700' as const },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 3 },
  heading1: { fontSize: 18, fontWeight: '800' as const, marginBottom: 6, color: theme.text },
  heading2: { fontSize: 17, fontWeight: '700' as const, marginBottom: 5, color: theme.text },
  heading3: { fontSize: 16, fontWeight: '700' as const, marginBottom: 4, color: theme.text },
  code_inline: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4,
    paddingHorizontal: 4, fontSize: 14, color: theme.text,
  },
  fence: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 10,
    borderWidth: 0, fontSize: 13, color: theme.text, marginBottom: 8,
  },
  blockquote: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderLeftWidth: 3,
    borderLeftColor: theme.accent, paddingLeft: 10, marginBottom: 8,
  },
  hr: { backgroundColor: theme.border, marginVertical: 8 },
  table: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, marginBottom: 8 },
  thead: { backgroundColor: 'rgba(255,255,255,0.06)' },
  th: { padding: 8, fontWeight: '700' as const, color: theme.text },
  td: { padding: 8, color: theme.textSecondary },
  tr: { borderBottomWidth: 1, borderColor: theme.border, flexDirection: 'row' as const },
});

// A wide table forced the whole message bubble to overflow past the
// screen edge instead of staying inside it (verified live — the library's
// default table render has no horizontal scroll of its own). Wrapping just
// the table in its own horizontal ScrollView keeps the bubble's own width
// intact; a wide table scrolls internally instead.
const mdRules = {
  table: (node: any, children: any, _parent: any, mdStyle: any) => (
    <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator={false}>
      <View style={mdStyle.table}>{children}</View>
    </ScrollView>
  ),
};

const styles = StyleSheet.create({
  root: { flex: 1 },

  menuBackdrop: { flex: 1 },
  menuPanel: {
    position: 'absolute', right: 16, borderRadius: 12, borderWidth: 1,
    paddingVertical: 4, minWidth: 128,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  menuRow: { paddingVertical: 9, paddingHorizontal: 14 },
  menuRowText: { fontSize: 13, fontFamily: fonts.bodySemiBold },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 14, paddingTop: 16, gap: 4 },

  // ── Empty state — v3: insight hero, category chips, question cards ──────
  emptyWrap: { paddingHorizontal: 2, paddingTop: 4, gap: 12 },


  greeting: { fontSize: 14, fontFamily: fonts.bodyMedium, marginLeft: 4, marginBottom: 2 },
  sugList: { gap: 8 },
  sugRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 12, minHeight: 56,
  },
  sugTag: { fontSize: 9.5, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 1 },
  // Several of the actual questions run 45-55 characters — too long for
  // one line at this size, and numberOfLines={1} was truncating them
  // mid-word instead of wrapping. Two lines + real line-height fixes it.
  sugQuestion: { fontSize: 13.5, lineHeight: 18, fontFamily: fonts.bodyMedium, marginTop: 3 },
  sugChevron: { fontSize: 18, fontWeight: '600' },

  // ── Message blocks ────────────────────────────────────────────────────────
  entryBlock: { marginBottom: 18, gap: 7 },

  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '78%', borderRadius: 20, borderBottomRightRadius: 6,
    paddingHorizontal: 15, paddingVertical: 10,
  },
  userText: { fontSize: 16, lineHeight: 22, fontWeight: '500', color: '#f5f5f5' },
  userImage: { width: 160, height: 160, borderRadius: 16, marginBottom: 6 },

  aiRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  aiAvatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  aiCol: { alignItems: 'flex-start', gap: 5, maxWidth: '90%', flexShrink: 1 },
  aiBubble: {
    borderRadius: 20, borderBottomLeftRadius: 6,
    paddingHorizontal: 15, paddingVertical: 11, gap: 6,
    alignSelf: 'stretch', overflow: 'hidden',
  },
  aiText: { fontSize: 16, lineHeight: 24 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  stat: { fontSize: 10, fontWeight: '500' },
  copyBtn: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  liveDotSmall: { width: 4, height: 4, borderRadius: 2 },
  liveChipText: { fontSize: 10, fontWeight: '700' },
  liveDataBlock: { borderRadius: 10, padding: 10, marginTop: 6 },
  liveDataText: { fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },


  // Thought block
  thoughtBlock: {
    borderRadius: 12, padding: 11, marginRight: 30, gap: 6,
  },
  thoughtHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thoughtChevron: { fontSize: 14, fontWeight: '700', marginLeft: 'auto' },
  thoughtDot: { width: 5, height: 5, borderRadius: 2.5 },
  thoughtLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  thoughtText: { fontSize: 12, lineHeight: 18, color: '#a8a29e', fontStyle: 'italic' },

  // Composer — one rounded card, Grok-style: multiline text on top,
  // controls row inside at the bottom
  composerWrap: { paddingHorizontal: 12, paddingTop: 8 },
  composer: {
    borderRadius: 24,
    paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10,
  },
  composerInput: {
    fontSize: 16, lineHeight: 22, maxHeight: 120, minHeight: 44,
    paddingTop: 10, paddingBottom: 6, textAlignVertical: 'top',
  },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  uploadBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stagedImageRow: { flexDirection: 'row', paddingTop: 8 },
  stagedImage: { width: 56, height: 56, borderRadius: 10 },
  stagedImageRemove: {
    position: 'absolute', top: -6, left: 46, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  modeToggle: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  modeBtn: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  modeBtnText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.2 },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
});
