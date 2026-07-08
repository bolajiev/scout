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
import { completion, cancel, InferenceCancelledError, type Tool } from '@qvac/sdk';
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
import { syncModelsFromDisk, getGenParams, getSettings, getDefaultModelId, getActiveBzKey, toPath } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { createSession, addMessage, getMessages } from '../utils/historyDb';
import { formatFixtureContext, fetchTeamForm } from '../utils/teamStats';
import { fetchBzTeamForm } from '../utils/bzzoiro';
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

const TOOLS_SYSTEM_SUFFIX = ` Your training data has a cutoff and does NOT know live scores, current squads, or anything happening now — NEVER answer those from memory, and NEVER say "I don't have real-time access." Tools — use at most one per question: get_today_fixtures for today's games/scores; get_team_form for a team's recent match RESULTS. If a question is about anything happening now or recently, ALWAYS call a tool before answering — guessing from stale training data is worse than checking.

The FIFA World Cup 2026 is happening RIGHT NOW, this month — it is not a future event you lack data on. If asked about it, call get_today_fixtures rather than assuming it "hasn't happened yet."

You do NOT have a tool for individual player statistics (goals scored, assists, cards, minutes played), and no tool for general news, transfers, or injuries — get_team_form only returns TEAM-level match results. If asked something neither tool can answer, say plainly that you don't have a reliable live source for that specific thing rather than guessing. NEVER invent a fake tool result to look like you checked — do not write words like "tool_response", a JSON array, or any bracketed data block as part of your answer; that text is reserved for the real function-calling mechanism only, and writing it yourself is always fabrication, never a real lookup.

Only skip tools for pure tactics/history/opinion questions with no time-sensitive facts. When you decide to use a tool, call it through the actual function-calling mechanism only — never write the tool's name, or a sentence describing that you're about to use one, as part of your visible answer text. And never describe your own tools to the user by their internal function names (e.g. "get_today_fixtures") even when directly asked what you can do — describe them in plain English instead (e.g. "I can check today's fixtures or a team's recent results").`;

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
    description: "Get a football TEAM's recent match results (W/D/L, scores, dates) from TheSportsDB. TEAM-level only — does not include any individual player's stats (goals, assists, cards). Use when asked about a specific team's recent form, results, or performance.",
    parameters: {
      type: 'object',
      properties: {
        team_name: { type: 'string', description: 'Name of the football team' },
      },
      required: ['team_name'],
    },
  },
];

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
const FABRICATED_TOOL_RESPONSE_RE = /\btool[_ ]?response\b\s*:?\s*[\[{]/i;

function detectLeakedToolCall(text: string): { impliedFixturesCall: boolean; fabricated: boolean } {
  const fabricated = FABRICATED_TOOL_RESPONSE_RE.test(text);
  // BUG FIX: this used to strip EVERY occurrence of a tool name from the
  // text unconditionally — verified live, asked "what can you check?", the
  // model legitimately listed its own tool names in a normal sentence, and
  // stripping them left "I only have access to: , and ` .`" with visible
  // holes where the names used to be. A tool name appearing mid-sentence
  // in an otherwise coherent answer is NOT the same failure as narrating a
  // failed call attempt — only the specific no-argument-tool implied-call
  // pattern gets auto-recovered (by actually calling it); every other
  // mention is left completely alone rather than guessed at and mangled.
  const impliedFixturesCall = !fabricated
    && new RegExp(`\\bget_today_fixtures\\b`, 'i').test(text)
    && !new RegExp(`\\bget_team_form\\b`, 'i').test(text);
  return { impliedFixturesCall, fabricated };
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
    const model = pickTextCapable(synced, await getDefaultModelId(), llmManager.getLoadedModelId());
    if (!model) {
      if (mountedRef.current) setNoModel(true);
      return;
    }
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
      const mid = await llmManager.ensure(
        visionModel,
        { ctx_size: 2048, device: 'auto', tools: supportsTools, projectionModelSrc: visionModel.projectionModelSrc },
        pct => { if (mountedRef.current) setLoadPct(Math.round(pct)); },
      );
      modelNameRef.current = visionModel.name;
      toolsEnabledRef.current = supportsTools;
      modelTypeRef.current = 'vision';
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
  const IMAGE_MAX_DIM = 896;
  const prepareImage = async (uri: string): Promise<string> => {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: IMAGE_MAX_DIM } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
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

    try {
      if (!sessionIdRef.current) sessionIdRef.current = createSession('matchai', q);
      addMessage(sessionIdRef.current, 'user', q);
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
      // Vision inference on-device is already the slowest path in the app
      // (image tokens alone add real prompt-processing time on top of
      // generation) — a photo description doesn't need the same length
      // budget as a football analysis, so capping it tighter buys real
      // speed without cutting a normal answer off mid-thought.
      const genParams = {
        predict: image ? 350 : thinkingOn ? gp.maxTokens + 500 : gp.maxTokens,
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
        // Vision + tool-calling together is unreliable on these on-device
        // models (see the supportsTools comment in loadModel) — an image
        // message always skips tools rather than risking the same
        // leaked-tool-call failure mode on top of an already harder task.
        tools: (!image && toolsEnabledRef.current) ? SCOUT_TOOLS : undefined,
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

      let toolCalls = (await run1.toolCalls) ?? [];
      let finalStats = await run1.stats;

      // Recovery path for the leaked-tool-call failure mode (see
      // detectLeakedToolCall) — only auto-recovered for get_today_fixtures
      // since it takes no arguments; get_team_form would need a team name
      // guessed out of garbled prose, which isn't reliable enough to
      // invent on the model's behalf.
      let leakCleanedAnswer: string | null = null;
      if (toolCalls.length === 0 && pass1Answer) {
        const leak = detectLeakedToolCall(pass1Answer);
        if (leak.fabricated) {
          // The data itself is invented, not just the syntax — cleaning up
          // the text would still leave a confident answer built on a fake
          // fact. Replace the whole thing with an honest admission instead.
          leakCleanedAnswer = "I don't have a reliable live source for that specific stat, so I won't guess a number — ask me about a team's recent form or today's fixtures instead, or check a stats site for individual player numbers.";
        } else if (leak.impliedFixturesCall) {
          toolCalls = [{ name: 'get_today_fixtures', arguments: {} } as any];
        }
      }

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
        answerAcc = leakCleanedAnswer ?? pass1Answer;
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
        const finished: Entry = { id: entryId, question: q, image: image ?? undefined, answer: answerAcc, thinking: thoughtAcc || undefined, thinkingMs: thinkMs || undefined, elapsed, toks: finalStats?.generatedTokens, liveSources: [...new Set(liveSources)], liveData: liveDataAcc || undefined };
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
        const finished: Entry = { id: entryId, question: q, image: image ?? undefined, answer: fallback };
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
                  {entry.elapsed}s{entry.toks ? ` · ${Math.round(entry.toks / (entry.elapsed || 1))} tok/s` : ''}
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
        onSelect={loadSpecificModel}
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
