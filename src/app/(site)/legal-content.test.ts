import { describe, expect, it } from "vitest";
import { hasZhPage } from "@/lib/i18n";
import { ACL_GUARANTEE, LEGAL, LEGAL_PATH, type LegalKey } from "./legal-content";

const keys = Object.keys(LEGAL) as LegalKey[];
const text = (key: LegalKey, locale: "en" | "zh") => {
  const d = LEGAL[key][locale];
  return [d.intro, ...d.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.list ?? [])])].join("\n");
};

describe("legal pages", () => {
  it("say the same things in both languages", () => {
    for (const key of keys) {
      const [en, zh] = [LEGAL[key].en.sections, LEGAL[key].zh.sections];
      expect(zh.length, key).toBe(en.length);
      en.forEach((s, i) => {
        expect(zh[i].paragraphs?.length, `${key}: ${s.heading}`).toBe(s.paragraphs?.length);
        expect(zh[i].list?.length, `${key}: ${s.heading}`).toBe(s.list?.length);
      });
    }
  });

  it("each have a Chinese address", () => {
    for (const key of keys) expect(hasZhPage(LEGAL_PATH[key]), key).toBe(true);
  });

  it("state the agreed return rules in both languages", () => {
    expect(text("returns", "en")).toContain("within 48 hours");
    expect(text("returns", "en")).toContain("within 7 days of delivery");
    expect(text("returns", "zh")).toContain("48 小时");
    expect(text("returns", "zh")).toContain("7 天");
  });

  it("keep the Australian Consumer Law wording on the terms and returns pages", () => {
    expect(text("terms", "en")).toContain(ACL_GUARANTEE);
    expect(text("returns", "en")).toContain(ACL_GUARANTEE);
  });

  it("keep title with Foodpac until goods are paid for", () => {
    expect(text("terms", "en")).toContain("remain Foodpac's property until they have been paid for in full");
    expect(text("terms", "zh")).toContain("所有权仍归 Foodpac");
  });
});
