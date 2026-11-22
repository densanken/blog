import { expect, it } from "vitest";

import { analyticsScripts } from "../../shared/utils/analytics.ts";

it("adds the Google tag only for a valid measurement ID", () => {
  expect(analyticsScripts("")).toEqual([]);
  expect(analyticsScripts('G-123"</script>')).toEqual([]);
  const scripts = analyticsScripts("G-ABC123");
  expect(scripts[0]).toEqual({ src: "https://www.googletagmanager.com/gtag/js?id=G-ABC123", async: true });
  expect(scripts[1]?.innerHTML).toContain("gtag('config',\"G-ABC123\")");
});
