// Some models (observed with Gemma in Think mode) don't use QVAC's native
// thinkingDelta/contentDelta split — they emit their reasoning as literal
// text using channel-style tags, e.g.
//   "<|channel>thought\nThinking Process:\n1. ...<channel|>Final answer text"
// llama.cpp has no special token for this in that model's vocab, so it's
// sampled as plain text and QVAC reports it all as contentDelta. Without
// this, the raw tag and the entire reasoning trace render directly in the
// visible answer bubble instead of the collapsible "Thinking..." block.
const CHANNEL_TAG_RE = /<\|?channel\|?>\s*\w*\s*/gi;

export function splitChannelThinking(raw: string): { thought: string; answer: string } {
  if (!raw.includes('channel')) return { thought: '', answer: raw };
  const parts = raw.split(CHANNEL_TAG_RE);
  if (parts.length <= 1) return { thought: '', answer: raw };
  const answerPrefix = parts[0] ?? '';
  const thought = parts[1] ?? '';
  const answerSuffix = parts.slice(2).join('');
  return { thought, answer: answerPrefix + answerSuffix };
}
