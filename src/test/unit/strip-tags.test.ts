import { expect, it } from "vitest";

import { stripTags } from "../../../plugins/strip-tags.ts";

it.each([
  ["<b>bold</b> text", "bold text"],
  ['<a href="x">link</a>', "link"],
  ["no tags", "no tags"],
])("removes tags from %s", (input, output) => {
  expect(stripTags(input)).toBe(output);
});

it.each(["<<b>script>alert(1)<</b>/script>", "<scr<b>ipt>x", "<scr<script>ipt>x"])(
  "leaves no complete tag for the nested input %s",
  (input) => {
    expect(stripTags(input)).not.toMatch(/<[^>]*>/);
    expect(stripTags(input)).not.toContain("<script>");
  }
);
