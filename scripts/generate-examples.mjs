import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corpusPath = process.argv[2];
if (!corpusPath) {
  throw new Error("Usage: node scripts/generate-examples.mjs <nld_sentences_detailed.tsv>");
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const deck = JSON.parse(readFileSync(resolve(root, "app/data/deck.json"), "utf8"));
const rows = readFileSync(corpusPath, "utf8")
  .split("\n")
  .map((line) => line.split("\t"))
  .filter((fields) => fields.length >= 4);

const deckWords = new Set(deck.map(({ word }) => word.toLocaleLowerCase("nl-NL")));
const blockedWords = new Set([
  "fuck",
  "godverdomme",
  "hoer",
  "klootzak",
  "kut",
  "lul",
  "neuken",
]);

function words(text) {
  return (text.toLocaleLowerCase("nl-NL").match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?/gu) ?? []);
}

function isUsable(text, tokens) {
  return (
    text.length >= 8 &&
    text.length <= 88 &&
    tokens.length >= 3 &&
    tokens.length <= 11 &&
    !/[{}<>\[\]|\\/@]/u.test(text) &&
    !/https?:|www\./iu.test(text) &&
    !tokens.some((token) => blockedWords.has(token))
  );
}

const tokenFrequency = new Map();
const sentences = [];

for (const [id, , text, author] of rows) {
  const tokens = words(text);
  if (!isUsable(text, tokens)) continue;

  sentences.push({ id: Number(id), text, author, tokens });
  for (const token of new Set(tokens)) {
    tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
  }
}

const best = new Map();

for (const sentence of sentences) {
  const targets = new Set(sentence.tokens.filter((token) => deckWords.has(token)));
  if (!targets.size) continue;

  const properNamePenalty = (sentence.text.match(/(?<![.!?]\s)[A-ZÀ-ÖØ-Þ][\p{L}\p{M}-]+/gu) ?? []).length * 4;
  const rareWordPenalty = sentence.tokens.reduce((sum, token) => {
    const frequency = tokenFrequency.get(token) ?? 0;
    return sum + (frequency < 30 ? 2 : frequency < 150 ? 0.5 : 0);
  }, 0);
  const punctuationPenalty = (sentence.text.match(/[,:;!?]/g) ?? []).length * 0.35;
  const lengthPenalty = Math.abs(sentence.tokens.length - 6) * 0.8;
  const score =
    rareWordPenalty +
    properNamePenalty +
    punctuationPenalty +
    lengthPenalty +
    sentence.text.length / 200;

  for (const target of targets) {
    const existing = best.get(target);
    if (!existing || score < existing.score) {
      best.set(target, { ...sentence, score });
    }
  }
}

const examples = Object.fromEntries(
  deck.map((card) => {
    const match = best.get(card.word.toLocaleLowerCase("nl-NL"));
    return [
      card.id,
      match
        ? {
            text: match.text,
            sourceId: match.id,
            author: match.author,
          }
        : {
            text: `Vandaag leer ik “${card.word}”.`,
            sourceId: null,
            author: null,
          },
    ];
  }),
);

writeFileSync(
  resolve(root, "app/data/examples.json"),
  `${JSON.stringify(examples)}\n`,
);

const sourced = Object.values(examples).filter(({ sourceId }) => sourceId !== null).length;
console.log(`Generated ${deck.length} examples (${sourced} sourced, ${deck.length - sourced} fallbacks).`);
