import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Keyboard, Animated, Dimensions,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError, type Tool } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import Markdown from 'react-native-markdown-display';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconSend, IconStop, IconBall } from '../components/Icons';
import ScreenHeader from '../components/ScreenHeader';
import { llmManager } from '../utils/modelManager';
import { pickTextCapable } from '../utils/models';
import { syncModelsFromDisk, getGenParams, getSettings, getDefaultModelId } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { createSession, addMessage, getMessages } from '../utils/historyDb';
import { formatFixtureContext, fetchTeamForm } from '../utils/teamStats';
import { fetchFootballNews, formatNewsContext } from '../utils/footballNews';
import { splitChannelThinking } from '../utils/thinkingSplit';
import { fetchAndCacheFixtures } from '../utils/fixtures';
import { logInference } from '../utils/auditLogger';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - 48) / 2;

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
const BASE_SYSTEM_PROMPT = `You are Scout's AI Coach — a veteran football coach, fully on-device.

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

interface Entry {
  id: string;
  question: string;
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelId, setModelId]           = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [noModel, setNoModel]           = useState(false);
  const [thinkingOn, setThinkingOn]     = useState(false);
  const [thoughtOpen, setThoughtOpen]   = useState<Record<string, boolean>>({});
  const [dataOpen, setDataOpen]         = useState<Record<string, boolean>>({});
  // Card questions rotate automatically while the empty state is visible
  const [catIdx, setCatIdx] = useState(() => Math.floor(Math.random() * 5));

  const scrollRef        = useRef<ScrollView>(null);
  const currentRunRef    = useRef<any>(null);
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
    // Resume a past conversation from History: restore its messages as
    // finished entries and keep writing into the same session
    const resumeId: string | undefined = route.params?.resumeSessionId;
    if (resumeId) {
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
    }
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

  useEffect(() => {
    if (modelLoading && !noModel) {
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
  }, [modelLoading, noModel]);

  const loadModel = async () => {
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
      const mid = await llmManager.ensure(model, { ctx_size: model.modelType === 'vision' ? 2048 : 4096, device: 'auto', tools: supportsTools, projectionModelSrc: model.projectionModelSrc });
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
    } catch {
      if (mountedRef.current) { setNoModel(true); setModelLoading(false); }
    }
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
        if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      });
      showRunningNotification('AI Coach');

      let pass1Answer = '';
      let pass1Raw = '';
      for await (const event of run1.events) {
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
        if (mountedRef.current) { setSlot(s => s ? { ...s, toolStatus: 'Fetching live data...', answer: '' } : s); }

        const toolHistory = [...history, { role: 'assistant' as const, content: pass1Answer }];

        for (const tc of toolCalls) {
          let toolResult = 'No data available.';
          try {
            if (tc.name === 'get_today_fixtures') {
              const { fixtures } = await fetchAndCacheFixtures();
              toolResult = formatFixtureContext(fixtures) || 'No fixtures scheduled today.';
              liveSources.push('TheSportsDB');
            } else if (tc.name === 'get_team_form') {
              const teamName = String(tc.arguments.team_name ?? '');
              const form = await fetchTeamForm(teamName);
              if (form && form.events.length > 0) {
                const lines = form.events.map(e =>
                  `${e.date} vs ${e.opponent}: ${e.score} (${e.result})${e.league ? ' — ' + e.league : ''}`
                );
                toolResult = [
                  `[RECENT RESULTS — ${form.teamName} via TheSportsDB]`,
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
              liveSources.push('TheSportsDB');
            } else if (tc.name === 'get_football_news') {
              const query = String(tc.arguments.query ?? '');
              setSlot(s => s ? { ...s, toolStatus: 'Checking football news...' } : s);
              const news = await fetchFootballNews(query);
              toolResult = formatNewsContext(news, query);
              news.forEach(n => liveSources.push(n.source));
            }
          } catch { toolResult = 'Unable to fetch live data.'; }
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
        const fallback = err instanceof InferenceCancelledError ? (slotRef.current?.answer || '...') : 'Could not get a response. Try again.';
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
          <View style={[styles.userBubble, { backgroundColor: accent }]}>
            <Text style={styles.userText}>{entry.question}</Text>
          </View>
        </View>
        {entry.thinking && renderThoughtBlock(entry.thinking, false, entry.id, entry.thinkingMs)}
        <View style={styles.aiRow}>
          <View style={styles.aiCol}>
            <View style={[styles.aiBubble, { backgroundColor: theme.cardAlt }]}>
              <Markdown style={mdStyles(theme)}>{entry.answer}</Markdown>
            </View>
            <View style={styles.statRow}>
              {entry.liveSources && entry.liveSources.length > 0 && (
                <TouchableOpacity
                  style={[styles.liveChip, { backgroundColor: '#22c55e14' }]}
                  onPress={() => setDataOpen(p => ({ ...p, [entry.id]: !p[entry.id] }))}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <View style={[styles.liveDotSmall, { backgroundColor: '#22c55e' }]} />
                  <Text style={[styles.liveChipText, { color: '#22c55e' }]}>{entry.liveSources.join(' · ')}</Text>
                  {entry.liveData && (
                    <Text style={[styles.liveChipText, { color: '#22c55e' }]}>{dataOpen[entry.id] ? ' ‹' : ' ›'}</Text>
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

  // ── Empty state ────────────────────────────────────────────────────────────
  const renderEmpty = () => (
    <View style={styles.emptyWrap}>
      {/* Brand mark */}
      <Animated.View style={[styles.brandMark, { backgroundColor: accent + '14', opacity: loadPulse }]}>
        <IconBall size={36} color={accent} />
      </Animated.View>

      <Text style={[styles.greeting, { color: theme.textSecondary }]}>{getGreeting()}</Text>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>Your AI Football Coach</Text>

      {/* Status pills row */}
      <View style={styles.pillRow}>
        <View style={[styles.statusPill, { backgroundColor: accent + '14', borderColor: accent + '30' }]}>
          <View style={[styles.pillDot, { backgroundColor: modelId ? accent : theme.textSecondary }]} />
          <Text style={[styles.pillText, { color: modelId ? accent : theme.textSecondary }]}>
            {modelLoading ? 'Loading...' : noModel ? 'No model' : 'On-device AI'}
          </Text>
        </View>

        <View style={[styles.statusPill, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.pillDot, { backgroundColor: accent }]} />
          <Text style={[styles.pillText, { color: theme.textSecondary }]}>Private · No cloud</Text>
        </View>
      </View>

      {noModel ? (
        <View style={[styles.noModelCard, { backgroundColor: theme.card }]}>
          <Text style={[styles.noModelText, { color: theme.textSecondary }]}>No model downloaded — go to Models.</Text>
        </View>
      ) : (
        <>
          {/* Category cards 2×2 — questions auto-rotate every few seconds */}
          <View style={styles.cardGrid}>
            {CATEGORY_POOLS.map((cat) => {
              const q = cat.qs[catIdx % cat.qs.length];
              return (
                <TouchableOpacity
                  key={cat.tag}
                  style={[styles.categoryCard, { backgroundColor: theme.card }]}
                  onPress={() => send(q)}
                  activeOpacity={0.75}
                  disabled={modelLoading || !modelId}
                >
                  <Text style={[styles.cardTag, { color: accent }]}>{cat.tag}</Text>
                  <Animated.Text style={[styles.cardQuestion, { color: theme.text, opacity: cardFade }]} numberOfLines={3}>
                    {q}
                  </Animated.Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      // Android 15 + edge-to-edge ignores adjustResize — the keyboard must
      // be handled in JS or it covers the input bar
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header — shared component so every screen matches exactly */}
      <ScreenHeader
        title="AI Coach"
        subtitle={modelLoading ? 'Loading model...' : noModel ? 'No model' : 'On-device · Private'}
        rightSlot={
          <>
            {(entries.length > 0 || slot) && !isGenerating && (
              <TouchableOpacity
                onPress={() => {
                  setEntries([]);
                  setSlot(null);
                  sessionIdRef.current = null;
                  setThoughtOpen({});
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={[styles.historyBtn, { color: accent }]}>New</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => navigation.navigate('History', { tab: 'matchai' })}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={[styles.historyBtn, { color: theme.textSecondary }]}>History</Text>
            </TouchableOpacity>
          </>
        }
      />

      {/* Feed */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {entries.length === 0 && !slot && renderEmpty()}
        {renderedEntries}

        {/* Active streaming slot */}
        {slot && (
          <View style={styles.entryBlock}>
            <View style={styles.userRow}>
              <View style={[styles.userBubble, { backgroundColor: accent }]}>
                <Text style={styles.userText}>{slot.question}</Text>
              </View>
            </View>
            {slot.toolStatus && (
              <View style={[styles.liveChip, { backgroundColor: '#22c55e14', alignSelf: 'flex-start' }]}>
                <View style={[styles.liveDotSmall, { backgroundColor: '#22c55e' }]} />
                <Text style={[styles.liveChipText, { color: '#22c55e' }]}>{slot.toolStatus}</Text>
              </View>
            )}
            {(slot.thought.length > 0 || slot.isThinking) && renderThoughtBlock(slot.thought, slot.isThinking, slot.id)}
            <View style={styles.aiRow}>
              <View style={[styles.aiBubble, { backgroundColor: theme.cardAlt }]}>
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
      <View style={[styles.composerWrap, { backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={[styles.composer, { backgroundColor: theme.cardAlt }]}>
          <TextInput
            style={[styles.composerInput, { color: theme.text }]}
            placeholder={modelLoading ? 'Loading model...' : 'Ask anything'}
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
              onPress={() => setThinkingOn(v => !v)}
              style={[styles.deepToggle, { backgroundColor: thinkingOn ? accent + '1a' : theme.cardAlt }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[styles.deepDot, { backgroundColor: thinkingOn ? accent : theme.textSecondary }]} />
              <Text style={[styles.deepToggleText, { color: thinkingOn ? accent : theme.textSecondary }]}>
                {thinkingOn ? 'Think · on' : 'Think'}
              </Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            {isGenerating ? (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: '#ef4444' }]}
                onPress={() => { if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {}); }}
              >
                <IconStop size={17} color="#fff" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: accent, opacity: input.trim() && modelId ? 1 : 0.35 }]}
                onPress={() => send()}
                disabled={!input.trim() || !modelId || isGenerating}
              >
                <IconSend size={17} color="#fff" />
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
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, padding: 10,
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

  historyBtn: { fontSize: 13, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 14, paddingTop: 16, gap: 4 },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 2, gap: 14, alignItems: 'center' },
  brandMark: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 14, fontWeight: '500', marginTop: -4 },
  emptyTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', marginTop: -6 },

  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6,
  },
  pillDot: { width: 5, height: 5, borderRadius: 2.5 },
  pillText: { fontSize: 12, fontWeight: '600' },

  noModelCard: { borderRadius: 12, padding: 14, width: '100%', marginTop: 4 },
  noModelText: { fontSize: 13, textAlign: 'center' },

  // Category cards
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%', marginTop: 4 },
  categoryCard: {
    width: CARD_W, borderRadius: 16,
    padding: 16, gap: 8,
  },
  cardTag: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  cardQuestion: { fontSize: 14, fontWeight: '500', lineHeight: 20 },

  // Chip row

  // ── Message blocks ────────────────────────────────────────────────────────
  entryBlock: { marginBottom: 18, gap: 7 },

  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '78%', borderRadius: 20, borderBottomRightRadius: 6,
    paddingHorizontal: 15, paddingVertical: 10,
  },
  userText: { fontSize: 16, lineHeight: 22, fontWeight: '500', color: '#fff' },

  aiRow: { alignItems: 'flex-start' },
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
  deepToggle: {
    height: 34, borderRadius: 17, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  deepToggleText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  deepDot: { width: 6, height: 6, borderRadius: 3 },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
});
