// Reaction helpers for chat. One reaction per user per message, stored
// as a map on the message doc: reactions: { uid: emoji }.
// Counts are derived client-side from that map, so a reaction never
// rewrites the whole message list.
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '🔥', '👍'] as const;

export const REACTION_GRID = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '😂', '😭', '😮', '😢', '😡', '😍', '🥰', '😘',
  '🔥', '👍', '👎', '👏', '🙏', '🎉', '✨', '💯',
  '😴', '🤔', '😅', '🥺', '😎', '🤗', '💔', '🌸',
] as const;

export type ReactionMap = Record<string, string>;

export function getReactionCounts(reactions?: ReactionMap): { emoji: string; count: number; uids: string[] }[] {
  const byEmoji = new Map<string, string[]>();
  for (const [uid, emoji] of Object.entries(reactions ?? {})) {
    if (!emoji) continue;
    const list = byEmoji.get(emoji) ?? [];
    list.push(uid);
    byEmoji.set(emoji, list);
  }
  return [...byEmoji.entries()]
    .map(([emoji, uids]) => ({ emoji, count: uids.length, uids }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export function getMyReaction(reactions: ReactionMap | undefined, uid: string | null): string | null {
  if (!uid) return null;
  return reactions?.[uid] ?? null;
}

/** Take the first grapheme cluster from free text, so any emoji works. */
export function firstEmoji(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const [first] = Array.from(trimmed);
  return first ?? null;
}
