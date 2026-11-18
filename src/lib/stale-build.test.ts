import { afterEach, describe, expect, it, vi } from "vitest";
import { isStaleBuild, newerBuildLive } from "./stale-build";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const live = (build: string) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ build })));

describe("newerBuildLive", () => {
  it("is true once another version is live than the one the page was loaded with", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD", "abc123");
    live("def456");
    expect(await newerBuildLive()).toBe(true);
    live("abc123");
    expect(await newerBuildLive()).toBe(false);
  });

  it("can't tell locally or offline, so it says no", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD", "dev");
    live("def456");
    expect(await newerBuildLive()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_BUILD", "abc123");
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await newerBuildLive()).toBe(false);
  });
});

describe("isStaleBuild", () => {
  it("recognises the browser failing to load the app's code", () => {
    expect(isStaleBuild(new Error("Loading chunk 123 failed."))).toBe(true);
    expect(isStaleBuild({ name: "ChunkLoadError", message: "x" })).toBe(true);
    expect(isStaleBuild(new Error("An error occurred in the Server Components render."))).toBe(false);
  });
});
