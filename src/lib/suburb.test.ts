import { describe, expect, it } from "vitest";
import { suburbOf } from "./shipments";

describe("suburbOf", () => {
  it("reads the suburb out of an Australian address", () => {
    expect(suburbOf("12 Smith St, Fortitude Valley QLD 4006")).toBe("Fortitude Valley");
    expect(suburbOf("Fortitude Valley QLD 4006")).toBe("Fortitude Valley");
    expect(suburbOf("3/45 George Street, sydney NSW 2000, Australia")).toBe("Sydney");
    expect(suburbOf("Unit 2, 8 King Rd, West End, QLD 4101")).toBe("West End");
  });

  it("says nothing when the address doesn't name a state", () => {
    expect(suburbOf("Somewhere out west")).toBeNull();
  });
});
