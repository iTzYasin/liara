import { describe, expect, it } from "vitest";
import { parseAssistantEntryContext } from "./assistant-entry-context";

describe("parseAssistantEntryContext", () => {
  it("maps the panel source to its fixed return route", () => {
    expect(parseAssistantEntryContext("panel")).toEqual({
      source: "panel",
      returnHref: "/panel",
    });
  });

  it("maps the docs source to its fixed return route", () => {
    expect(parseAssistantEntryContext("docs")).toEqual({
      source: "docs",
      returnHref: "/docs",
    });
  });

  it.each([undefined, null, "", "https://evil.example", "panel<script>"])(
    "falls back safely for %s",
    (source) => {
      expect(parseAssistantEntryContext(source)).toEqual({
        source: "direct",
        returnHref: "/",
      });
    },
  );
});
