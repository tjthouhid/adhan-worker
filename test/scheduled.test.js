import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

const fixture = readFileSync(new URL("./fixtures/mymasjid-sample.json", import.meta.url), "utf8");
const env = () => ({
  TIMEZONE: "Europe/London",
  MASJID_GUID: "g-1",
  DEVICE: "adhan-x",
  VM_TOKEN: "t",
  MOSQUES: '[{"id":"duwt","name":"D","city":"C","guid":"g-1","timezone":"Europe/London"}]',
  TIMES: { get: async () => null, put: async () => {} },
});

describe("scheduled()", () => {
  let fetchMock;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async (url) =>
      String(url).includes("voicemonkey") ? new Response("ok") : new Response(fixture)
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("at a prayer minute, triggers Alexa and does not start a KV refresh", async () => {
    vi.setSystemTime(new Date("2026-11-22T17:40:10Z")); // Isha 17:40 in the fixture
    const ctx = { waitUntil: vi.fn() };
    await worker.scheduled({ cron: "* * * * *" }, env(), ctx);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("voicemonkey"))).toBe(true);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("outside prayer minutes, starts the KV refresh", async () => {
    vi.setSystemTime(new Date("2026-11-22T17:41:10Z"));
    const ctx = { waitUntil: vi.fn() };
    await worker.scheduled({ cron: "* * * * *" }, env(), ctx);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("voicemonkey"))).toBe(false);
  });
});
