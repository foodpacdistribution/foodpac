import { describe, expect, it } from "vitest";
import { darkBars } from "./resize-image";

/** A w×h RGBA picture: white, with `paint` deciding which pixels are black. */
function picture(w: number, h: number, paint: (x: number, y: number) => boolean) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = paint(x, y) ? 5 : 250;
      d.set([v, v, v, 255], i);
    }
  return d;
}

describe("darkBars", () => {
  it("finds black bands above and below a letterboxed photo", () => {
    const d = picture(100, 100, (_x, y) => y < 15 || y >= 85);
    expect(darkBars(d, 100, 100)).toEqual({ top: 15, bottom: 15, left: 0, right: 0 });
  });

  it("finds bands at the sides too", () => {
    const d = picture(100, 80, (x) => x < 10 || x >= 92);
    expect(darkBars(d, 100, 80)).toEqual({ top: 0, bottom: 0, left: 10, right: 8 });
  });

  it("leaves a photo without bars alone", () => {
    expect(darkBars(picture(100, 100, () => false), 100, 100)).toBeNull();
  });

  it("doesn't mistake a dark product touching the edge for a bar", () => {
    // A black tray across the bottom half, but with white either side of it.
    const d = picture(100, 100, (x, y) => y > 50 && x > 20 && x < 80);
    expect(darkBars(d, 100, 100)).toBeNull();
  });

  it("won't cut away most of a mostly black picture", () => {
    expect(darkBars(picture(100, 100, (_x, y) => y < 35 || y >= 65), 100, 100)).toBeNull();
  });

  it("ignores a one-pixel dark edge", () => {
    expect(darkBars(picture(100, 100, (_x, y) => y === 0), 100, 100)).toBeNull();
  });
});
