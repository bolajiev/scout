import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Keyboard, Animated, Modal, Pressable,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError, type Tool } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import Markdown from 'react-native-markdown-display';
import { getTheme } from '../theme';
import { fonts } from '../theme/fonts';
import { useTheme } from '../navigation/AppNavigator';
import { IconSend, IconStop, IconBall, IconTactics, IconPlayers, IconTrophy, IconRules, IconMore } from '../components/Icons';
import ScreenHeader from '../components/ScreenHeader';
import ModelStatusPill from '../components/ModelStatusPill';
import { llmManager } from '../utils/modelManager';
import { pickTextCapable } from '../utils/models';
import { syncModelsFromDisk, getGenParams, getSettings, getDefaultModelId, getActiveBzKey } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { createSession, addMessage, getMessages } from '../utils/historyDb';
import { formatFixtureContext, fetchTeamForm } from '../utils/teamStats';
import { fetchBzTeamForm } from '../utils/bzzoiro';
import { fetchFootballNews, formatNewsContext } from '../utils/footballNews';
import { splitChannelThinking } from '../utils/thinkingSplit';
import { fetchAndCacheFixtures } from '../utils/fixtures';
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

const TOOLS_SYSTEM_SUFFIX = ` Your training data has a cutoff and does NOT know live scores, current squads, current top scorers, or anything happening now — NEVER answer those from memory, and NEVER say "I don't have real-time access." Tools — use at most one per question: get_today_fixtures for today's games/scores; get_team_form for a team's recent match RESULTS; get_football_news for anything else current — transfers, injuries, club news, top scorers, standings, or verifying any claim you're not 100% certain is still true. If a question is about anything happening now or recently, ALWAYS call a tool before answering — guessing from stale training data is worse than checking. Only skip tools for pure tactics/history/opinion questions with no time-sensitive facts.`;

const NO_TOOLS_SYSTEM_SUFFIX = ` This session has no live data tools available. For anything truly current (today's scores, this week's news) say briefly that you're working from general knowledge rather than inventing specific recent numbers — but still commit to a real, useful answer from what you do know. Never say "I don't have real-time access" as a refusal.`;

const buildSystemPrompt = (toolsEnabled: boolean) =>
  BASE_SYSTEM_PROMPT + (toolsEnabled ? TOOLS_SYSTEM_SUFFIX : NO_TOOLS_SYSTEM_SUFFIX);

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
    description: "Get a football team's recent match results from TheSportsDB. Use when asked about a specific team's recent form, results, or performance.",
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
    name: 'get_football_news',
    description: "Get recent football news headlines from BBC Sport. Use this for ANY current-events question you can't answer from get_today_fixtures or get_team_form — transfers, injuries, manager changes, top scorers, standings, tournament stats, current squads, or verifying any claim. Never say you lack real-time access — call this instead.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Player, club, or topic to look for in headlines (e.g. "Mbappe transfer", "Arsenal injury")' },
      },
      required: ['query'],
    },
  },
];

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
  liveSources?: string[];  // deduped source names, e.g. ['TheSportsDB', 'BBC Sport']
  liveData?: string;  // the raw tool result the model actually saw — user-visible on demand
}

interface StreamSlot {
  id: string;
  question: string;
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
              answer: next?.role === 'assistant' ? next.content : '',
              elapsed: next?.meta?.elapsed,
              toks: next?.meta?.toks,
              thinking: next?.meta?.thinking,
              thinkingMs: next?.meta?.thinkingMs,
            });
          }
        }
        if (restored.length > 0) {
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

  const loadModel = async () => {
    setLoadError(null);
    setModelLoading(true);
    setLoadPct(0);
    try {
      const synced = await syncModelsFromDisk();
      const model = pickTextCapable(synced, await getDefaultModelId(), llmManager.getLoadedModelId());
      if (!model) {
        if (mountedRef.current) { setNoModel(true); setModelLoading(false); }
        return;
      }
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

  const send = useCallback(async (question?: string) => {
    abortRef.current = false;
    const q = (question ?? input).trim();
    if (!q || isGenerating || !modelId) return;
    setInput('');
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const entryId = `e-${Date.now()}`;
    entryAnimsRef.current[entryId] = { ty: new Animated.Value(24), op: new Animated.Value(0) };

    try {
      if (!sessionIdRef.current) sessionIdRef.current = createSession('matchai', q);
      addMessage(sessionIdRef.current, 'user', q);
    } catch {}

    // Only the last 4 exchanges go to the model — prompt processing on CPU
    // scales with context, so unbounded history makes every reply slower
    const history: { role: 'user' | 'assistant' | 'tool'; content: string }[] = entries.slice(-4).map(e => [
      { role: 'user' as const, content: e.question },
      { role: 'assistant' as const, content: e.answer },
    ]).flat();
    history.push({ role: 'user', content: q });

    setSlot({ id: entryId, question: q, answer: '', thought: '', isThinking: thinkingOn, toolStatus: null, liveSources: [], liveData: '' });
    setIsGenerating(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

    let liveSources: string[] = [];
    let liveDataAcc = '';
    let answerAcc = '';
    let thoughtAcc = '';
    let lastFlush = 0;
    let thinkStart = 0;
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
      const genParams = {
        predict: thinkingOn ? gp.maxTokens + 500 : gp.maxTokens,
        temp: gp.temp,
        top_k: gp.top_k,
        top_p: gp.top_p,
        repeat_penalty: gp.repeat_penalty,
        reasoning_budget: thinkingOn ? -1 as -1 : 0 as 0,
      };
      const t0 = Date.now();

      // ── Pass 1: completion with tools available ─────────────────────────
      const run1 = completion({
        modelId,
        history: [{ role: 'system', content: buildSystemPrompt(toolsEnabledRef.current) }, ...history],
        stream: true,
        tools: toolsEnabledRef.current ? SCOUT_TOOLS : undefined,
        captureThinking: thinkingOn,
        generationParams: genParams,
      });
      currentRunRef.current = run1;
      registerInferenceCancel(() => {
        abortRef.current = true;
        if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      });
      showRunningNotification('AI Coach');

      let pass1Answer = '';
      let pass1Raw = '';
      for await (const event of run1.events) {
        if (abortRef.current) break;
        if (event.type === 'thinkingDelta') {
          if (!thinkStart) thinkStart = Date.now();
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
          if (split.thought) {
            if (!thinkStart) thinkStart = Date.now();
            thoughtAcc = split.thought;
          }
          if (split.answer && thinkStart && !thinkMs) thinkMs = Date.now() - thinkStart;
          pass1Answer = split.answer;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 100) {
            lastFlush = now;
            setSlot(s => s ? { ...s, answer: pass1Answer, thought: thoughtAcc, isThinking: !!split.thought && !split.answer } : s);
            throttledScroll();
          }
        }
      }

      const toolCalls = (await run1.toolCalls) ?? [];
      let finalStats = await run1.stats;

      if (toolCalls.length > 0 && mountedRef.current) {
        // ── Tool execution ──────────────────────────────────────────────────
        if (mountedRef.current) { setSlot(s => s ? { ...s, toolStatus: 'Fetching data...', answer: '' } : s); }

        const toolHistory = [...history, { role: 'assistant' as const, content: pass1Answer }];

        for (const tc of toolCalls) {
          let toolResult = 'No data available.';
          try {
            if (tc.name === 'get_today_fixtures') {
              setSlot(s => s ? { ...s, toolStatus: "Checking today's fixtures..." } : s);
              const { fixtures } = await fetchAndCacheFixtures();
              toolResult = formatFixtureContext(fixtures) || 'No fixtures scheduled today.';
              liveSources.push('TheSportsDB');
            } else if (tc.name === 'get_team_form') {
              const teamName = String(tc.arguments.team_name ?? '');
              setSlot(s => s ? { ...s, toolStatus: `Checking ${teamName || 'team'}'s recent form...` } : s);
              const bzKey = await getActiveBzKey().catch(() => '');
              const bzForm = bzKey ? await fetchBzTeamForm(bzKey, teamName, 5).catch(() => null) : null;
              const form = bzForm ?? await fetchTeamForm(teamName);
              const source = bzForm ? 'Bzzoiro Sports' : 'TheSportsDB';
              if (form && form.events.length > 0) {
                const lines = form.events.map(e =>
                  `${e.date} vs ${e.opponent}: ${e.score} (${e.result})${e.league ? ' — ' + e.league : ''}`
                );
                toolResult = [
                  `[RECENT RESULTS — ${form.teamName} via ${source}]`,
                  `Form (most recent last): ${form.form.join(' ')}`,
                  ...lines,
                  '[END RESULTS]',
                ].join('\n');
              } else {
                // Fall back to today's fixtures involving the team
                const { fixtures } = await fetchAndCacheFixtures();
                const teamFix = fixtures.filter(f =>
                  f.strHomeTeam?.toLowerCase().includes(teamName.toLowerCase()) ||
                  f.strAwayTeam?.toLowerCase().includes(teamName.toLowerCase())
                );
                toolResult = teamFix.length > 0 ? formatFixtureContext(teamFix) : `No recent data found for ${teamName}.`;
              }
              liveSources.push(source);
            } else if (tc.name === 'get_football_news') {
              const query = String(tc.arguments.query ?? '');
              setSlot(s => s ? { ...s, toolStatus: 'Checking football news...' } : s);
              const news = await fetchFootballNews(query);
              toolResult = formatNewsContext(news, query);
              news.forEach(n => liveSources.push(n.source));
            }
          } catch { toolResult = 'Unable to fetch data.'; }
          toolHistory.push({ role: 'tool', content: toolResult });
          liveDataAcc += (liveDataAcc ? '\n\n' : '') + toolResult;
        }

        if (!mountedRef.current) return;
        setSlot(s => s ? { ...s, toolStatus: null, answer: '', liveSources: [...new Set(liveSources)], liveData: liveDataAcc } : s);

        // ── Pass 2: final answer incorporating tool results ─────────────────
        const run2 = completion({
          modelId,
          history: [{ role: 'system', content: buildSystemPrompt(toolsEnabledRef.current) }, ...toolHistory],
          stream: true,
          captureThinking: false,
          generationParams: { ...genParams, reasoning_budget: 0 as 0 },
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
      } else {
        answerAcc = pass1Answer;
      }

      if (mountedRef.current) {
        setSlot(s => s ? { ...s, answer: answerAcc, thought: thoughtAcc, isThinking: false } : s);
        throttledScroll();
      }

      currentRunRef.current = null;
      clearNotification();

      const totalMs = Date.now() - t0;
      logInference('matchai', modelNameRef.current, finalStats?.timeToFirstToken ?? 0, totalMs, finalStats?.generatedTokens ?? 0).catch(() => {});

      const elapsed = Math.round(totalMs / 100) / 10;
      if (thinkStart && !thinkMs) thinkMs = Date.now() - thinkStart;
      if (sessionIdRef.current && answerAcc) {
        addMessage(sessionIdRef.current, 'assistant', answerAcc, {
          elapsed, toks: finalStats?.generatedTokens,
          thinking: thoughtAcc || undefined, thinkingMs: thinkMs || undefined,
        });
      }

      if (mountedRef.current) {
        const finished: Entry = { id: entryId, question: q, answer: answerAcc, thinking: thoughtAcc || undefined, thinkingMs: thinkMs || undefined, elapsed, toks: finalStats?.generatedTokens, liveSources: [...new Set(liveSources)], liveData: liveDataAcc || undefined };
        setSlot(null);
        setEntries(prev => [...prev, finished]);
        setIsGenerating(false);
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
        const finished: Entry = { id: entryId, question: q, answer: fallback };
        setSlot(null);
        setEntries(prev => [...prev, finished]);
        setIsGenerating(false);
        setTimeout(() => springEntry(entryId), 20);
      }
    }
  }, [input, isGenerating, modelId, entries, thinkingOn]);

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
            {isStreaming ? 'Thinking...' : doneLabel}
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
              <Markdown style={mdStyles(theme)}>{entry.answer}</Markdown>
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
                  {entry.elapsed}s{entry.toks ? ` · ${Math.round(entry.toks / (entry.elapsed || 1))} tok/s` : ''} · on-device
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
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
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
              onPress={() => { setMenuOpen(false); navigation.navigate('History', { tab: 'matchai' }); }}
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
        onLoad={loadModel}
        onStop={stopModel}
        onGetModel={() => navigation.navigate('Models')}
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
              <View style={[styles.aiBubble, { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]}>
                {slot.answer.length > 0 ? (
                  <Text style={[styles.aiText, { color: theme.text }]}>{slot.answer}</Text>
                ) : (
                  <TypingDots color={accent} />
                )}
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
                style={[styles.sendBtn, { backgroundColor: accent, opacity: input.trim() && modelId ? 1 : 0.35 }]}
                onPress={() => send()}
                disabled={!input.trim() || !modelId || isGenerating}
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
});

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

  aiRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  aiAvatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  aiCol: { alignItems: 'flex-start', gap: 5, maxWidth: '90%' },
  aiBubble: {
    borderRadius: 20, borderBottomLeftRadius: 6,
    paddingHorizontal: 15, paddingVertical: 11, gap: 6,
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
  modeToggle: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  modeBtn: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  modeBtnText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.2 },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
});
