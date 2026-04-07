// Built-in sticker registry
// Using Unicode emoji + custom SVG paths as content
// content can be: emoji string, or inline SVG markup

export interface StickerDef {
  id: string;
  label: string;
  content: string; // emoji or SVG string
}

export const BUILT_IN_STICKERS: StickerDef[] = [
  { id: 'heart_filled',   label: 'Heart',         content: '❤️' },
  { id: 'heart_pink',     label: 'Pink Heart',     content: '🩷' },
  { id: 'star_5pt',       label: 'Star',           content: '⭐' },
  { id: 'star_sparkle',   label: 'Sparkle',        content: '✨' },
  { id: 'flower_pink',    label: 'Flower',         content: '🌸' },
  { id: 'flower_yellow',  label: 'Sunflower',      content: '🌻' },
  { id: 'rainbow',        label: 'Rainbow',        content: '🌈' },
  { id: 'butterfly',      label: 'Butterfly',      content: '🦋' },
  { id: 'strawberry',     label: 'Strawberry',     content: '🍓' },
  { id: 'face_smile',     label: 'Smile',          content: '😊' },
  { id: 'face_laugh',     label: 'Laugh',          content: '😂' },
  { id: 'face_love',      label: 'Love',           content: '😍' },
  { id: 'face_wink',      label: 'Wink',           content: '😉' },
  { id: 'face_cool',      label: 'Cool',           content: '😎' },
  { id: 'face_party',     label: 'Party',          content: '🥳' },
  { id: 'face_sob',       label: 'Cry',            content: '😭' },
  { id: 'face_thinking',  label: 'Thinking',       content: '🤔' },
  { id: 'gesture_ok',     label: 'OK',             content: '👌' },
  { id: 'gesture_peace',  label: 'Peace',          content: '✌️' },
  { id: 'gesture_heart',  label: 'Heart Hands',     content: '🫶' },
  { id: 'animal_cat',     label: 'Cat',            content: '🐱' },
  { id: 'animal_dog',     label: 'Dog',            content: '🐶' },
  { id: 'animal_bunny',   label: 'Bunny',          content: '🐰' },
  { id: 'animal_bear',    label: 'Bear',           content: '🐻' },
  { id: 'food_cake',      label: 'Cake',           content: '🍰' },
  { id: 'food_pizza',     label: 'Pizza',          content: '🍕' },
  { id: 'food_coffee',    label: 'Coffee',         content: '☕' },
  { id: 'object_balloon', label: 'Balloon',        content: '🎈' },
  { id: 'object_gift',    label: 'Gift',           content: '🎁' },
  { id: 'object_book',    label: 'Book',           content: '📚' },
  { id: 'object_sparkles',label: 'Sparkles',       content: '✨' },
];
