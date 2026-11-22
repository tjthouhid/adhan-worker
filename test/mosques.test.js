import { describe, it, expect } from "vitest";
import { parseMosques, publicMosque, findMosque, findMosqueByGuid } from "../src/mosques.js";

const RAW =
  '[{"id":"duwt","name":"D","city":"C","guid":"g-1","timezone":"Europe/London"}]';

describe("parseMosques", () => {
  it("parses a valid list", () => {
    expect(parseMosques(RAW)).toHaveLength(1);
  });

  it("returns [] for invalid JSON or missing value", () => {
    expect(parseMosques("not json")).toEqual([]);
    expect(parseMosques(undefined)).toEqual([]);
    expect(parseMosques('{"id":"x"}')).toEqual([]);
  });

  it("drops entries missing id, guid or timezone", () => {
    const raw = JSON.stringify([
      { id: "a", name: "A", guid: "g", timezone: "Europe/London" },
      { id: "b", name: "B", timezone: "Europe/London" },
      { name: "C", guid: "g", timezone: "Europe/London" },
      { id: "d", name: "D", guid: "g" },
    ]);
    expect(parseMosques(raw).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("publicMosque", () => {
  it("never exposes the guid", () => {
    const pub = publicMosque(parseMosques(RAW)[0]);
    expect(pub).toEqual({ id: "duwt", name: "D", city: "C", timezone: "Europe/London" });
    expect("guid" in pub).toBe(false);
  });
});

describe("findMosque / findMosqueByGuid", () => {
  const list = parseMosques(RAW);
  it("finds by id and guid", () => {
    expect(findMosque(list, "duwt").guid).toBe("g-1");
    expect(findMosqueByGuid(list, "g-1").id).toBe("duwt");
  });
  it("returns undefined when absent", () => {
    expect(findMosque(list, "nope")).toBeUndefined();
    expect(findMosqueByGuid(list, "nope")).toBeUndefined();
  });
});
