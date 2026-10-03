import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deck = JSON.parse(readFileSync(new URL("../app/data/deck.json", import.meta.url)));
const examples = JSON.parse(
  readFileSync(new URL("../app/data/examples.json", import.meta.url)),
);

function containsWord(sentence, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`,
    "iu",
  ).test(sentence);
}

test("every card has a short sentence containing its target word", () => {
  assert.equal(Object.keys(examples).length, deck.length);

  for (const card of deck) {
    const example = examples[card.id];
    assert.ok(example, `missing example for ${card.id}`);
    assert.ok(example.text.length <= 88, `example is too long for ${card.id}`);
    assert.ok(
      containsWord(example.text, card.word),
      `example for ${card.id} does not contain ${card.word}`,
    );
  }
});

test("nearly all examples come from the attributed sentence corpus", () => {
  const sourced = Object.values(examples).filter(
    ({ sourceId }) => Number.isInteger(sourceId) && sourceId > 0,
  );
  assert.ok(sourced.length >= 1_900);
});
