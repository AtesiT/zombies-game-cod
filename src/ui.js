// One number for every menu on the screen: how much bigger menus are drawn
// than the design they were laid out on.
//
// The game draws in its own units. On a 800x500 window one unit is one CSS
// pixel, and twelve of them under a row of text is a comfortable caption. On
// a phone the canvas is about 430 CSS pixels wide, so the *same* twelve units
// are the same twelve pixels of glass -- half the apparent size, under a
// thumb that is twice as wide as a mouse pointer. That is why the menus read
// as tiny on a phone even though nothing about them changed.
//
// So menus are drawn through a scale factor: narrow screens get a bigger one,
// wide screens keep the design size. The panel painters scale the canvas and
// keep working in their own units, and every hit-test divides the pointer by
// the same factor before it measures anything, so what you see is what you
// press -- which is the only property that actually matters here.
import { clamp } from './util.js';

/** How many times bigger a menu is than its 800x500 design. 1 on a desktop. */
export function uiScale(w, h) {
  // The short side is what runs out first. `h * 1.6` turns a tall phone into
  // the same measurement as a wide one, so portrait and landscape are not
  // treated as different devices.
  const short = Math.min(w, h * 1.6);
  // 1.5 is the ceiling: 16px of menu text becomes 24px, and the longest
  // headings still fit a 430-pixel-wide phone without wrapping.
  return clamp(800 / Math.max(1, short), 1, 1.5);
}

/** The scale, and the space a menu has once the scale is taken off it. */
export function uiView(w, h) {
  const k = uiScale(w, h);
  return { k, w: Math.max(1, w / k), h: Math.max(1, h / k) };
}
