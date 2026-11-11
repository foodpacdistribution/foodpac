import { describe, expect, it } from "vitest";
import { areaOf, clusterPoints, samePlace, UNKNOWN_AREA } from "./customer-map";

describe("areaOf", () => {
  it("reads suburb and postcode from Google's address", () => {
    expect(areaOf("12 Smith St, Sunnybank QLD 4109, Australia")).toEqual({ key: "sunnybank|4109", name: "Sunnybank 4109" });
    expect(areaOf("Shop 3/45 Main Rd, SUNNYBANK HILLS QLD 4109")).toEqual({ key: "sunnybank hills|4109", name: "Sunnybank Hills 4109" });
  });

  it("reads an address that is only the suburb", () => {
    expect(areaOf("Fortitude Valley QLD 4006, Australia")).toEqual({ key: "fortitude valley|4006", name: "Fortitude Valley 4006" });
  });

  it("prefers the geocoder's address, then the typed one", () => {
    expect(areaOf("Shop 1, 2 Logan Rd, Eight Mile Plains QLD 4113, Australia", "2 logan rd eight mile plains")).toEqual({
      key: "eight mile plains|4113",
      name: "Eight Mile Plains 4113",
    });
    expect(areaOf(null, "2 Logan Rd, Eight Mile Plains QLD 4113")).toEqual({ key: "eight mile plains|4113", name: "Eight Mile Plains 4113" });
  });

  it("falls back to the postcode, never a street number", () => {
    expect(areaOf("12, Smith Street, Sunnybank, Brisbane City, Queensland, 4109, Australia")).toEqual({ key: "4109", name: "4109" });
    expect(areaOf("1234 Logan Road Mount Gravatt")).toEqual({ key: UNKNOWN_AREA, name: "Unknown area" });
    expect(areaOf(null, "")).toEqual({ key: UNKNOWN_AREA, name: "Unknown area" });
  });
});

describe("clusterPoints", () => {
  const p = (id: string, lat: number, lng: number) => ({ id, lat, lng });
  // Two shops in Sunnybank (~300 m apart) and one in the CBD (~13 km away).
  const pts = [p("a", -27.5793, 153.0596), p("b", -27.5775, 153.0621), p("c", -27.4698, 153.0251)];

  it("groups nearby customers when zoomed out and splits them when zoomed in", () => {
    const out = clusterPoints(pts, 11);
    expect(out.map((c) => c.points.length).sort()).toEqual([1, 2]);
    expect(clusterPoints(pts, 8)).toHaveLength(1);
    expect(clusterPoints(pts, 17)).toHaveLength(3);
  });

  it("draws a group at the average of its points and keeps every point", () => {
    const [all] = clusterPoints(pts, 6);
    expect(all.points).toHaveLength(3);
    expect(all.lat).toBeCloseTo((-27.5793 - 27.5775 - 27.4698) / 3);
  });

  it("groups the same way whatever order the points come in", () => {
    const keys = (xs: typeof pts) => clusterPoints(xs, 11).map((c) => c.key).sort();
    expect(keys([...pts].reverse())).toEqual(keys(pts));
  });

  it("knows when a group can't be split by zooming", () => {
    expect(samePlace([p("x", -27.5, 153), p("y", -27.50001, 153.00002)])).toBe(true);
    expect(samePlace(pts)).toBe(false);
  });
});
