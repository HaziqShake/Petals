// Fixed logical canvas for the notebook editor.
// Every device renders the same 360 wide by 5600 tall logical page and
// scales it with --notebook-zoom, so positions must be stored in logical
// units, never in screen px and never as a percent of a height that changes
// with text, fonts, or line-height.
//
// Convention (coordVersion 2):
//   x = percent of canvas width, 0-100  (360 logical px = 100)
//   y = logical px from the top of the canvas, 0-5600
//
// Legacy docs (no coordVersion) used a mixed form: new items were stored
// with isPx=true in logical px, old items were stored as percent of width
// AND percent of height. Those are normalised on read only; old docs are
// never rewritten, so existing notes and rooms are unaffected.
import type { Photo, StickerPlacement } from '../../../shared/types';

export const CANVAS_WIDTH = 360;
export const CANVAS_HEIGHT = 5600;

export interface NormalisedPos {
  xPct: number; // 0-100
  yPx: number; // 0-5600
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function normalisePhoto(p: Photo): NormalisedPos {
  if (p.coordVersion === 2) {
    return { xPct: clamp(p.x, 0, 100), yPx: clamp(p.y, 0, CANVAS_HEIGHT) };
  }
  if (p.isPx) {
    return { xPct: clamp((p.x / CANVAS_WIDTH) * 100, 0, 100), yPx: clamp(p.y, 0, CANVAS_HEIGHT) };
  }
  // Legacy percent form: x percent of width, y percent of height.
  return { xPct: clamp(p.x, 0, 100), yPx: clamp((p.y / 100) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT) };
}

export function normaliseSticker(s: StickerPlacement): NormalisedPos {
  if (s.coordVersion === 2) {
    return { xPct: clamp(s.x, 0, 100), yPx: clamp(s.y, 0, CANVAS_HEIGHT) };
  }
  if (s.isPx) {
    return { xPct: clamp((s.x / CANVAS_WIDTH) * 100, 0, 100), yPx: clamp(s.y, 0, CANVAS_HEIGHT) };
  }
  return { xPct: clamp(s.x, 0, 100), yPx: clamp((s.y / 100) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT) };
}

/** Read --notebook-zoom from an element inside the notebook card. */
export function getNotebookZoom(el: Element | null): number {
  if (!el) return 1;
  const z = parseFloat(getComputedStyle(el).getPropertyValue('--notebook-zoom') || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** Convert a screen-pixel drag delta to logical canvas units. */
export function screenDeltaToLogical(dxScreen: number, dyScreen: number, zoom: number): { dx: number; dy: number } {
  return { dx: dxScreen / zoom, dy: dyScreen / zoom };
}

/** Convert a logical drag delta to a normalised position. */
export function moveNormalised(pos: NormalisedPos, dxLogical: number, dyLogical: number): NormalisedPos {
  return {
    xPct: clamp(pos.xPct + (dxLogical / CANVAS_WIDTH) * 100, 0, 100),
    yPx: clamp(pos.yPx + dyLogical, 0, CANVAS_HEIGHT),
  };
}

/**
 * Centre of the visible part of the card, in logical coordinates.
 * Uses the scroll container, not the viewport, so the result does not
 * depend on where the page was scrolled to in screen coordinates.
 * Falls back to the top of the card when no wrapper is available.
 */
export function centreOfVisibleCard(wrapper: HTMLElement | null): NormalisedPos {
  if (!wrapper) return { xPct: 50, yPx: 200 };
  const zoom = getNotebookZoom(wrapper);
  const middleScreenPx = wrapper.scrollTop + wrapper.clientHeight / 2;
  const yPx = clamp(middleScreenPx / zoom, 0, CANVAS_HEIGHT - 100);
  return { xPct: 50, yPx };
}
