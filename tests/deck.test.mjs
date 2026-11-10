import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const deck = JSON.parse(read("../app/data/deck.json"));
const source = JSON.parse(read("../app/data/curated-vocabulary.json"));
const examples = JSON.parse(read("../app/data/examples.json"));
const approved = read("../docs/dutch-2000-book-review.txt").trim().split("\n");
const legacy = JSON.parse(read("./fixtures/legacy-card-ids.json"));
const byWord = new Map(deck.map((card) => [card.word, card]));

test("ships exactly the approved 2,000 words, with no frequency-list substitutions", () => {
  assert.equal(deck.length, 2000);
  assert.equal(new Set(deck.map((card) => card.id)).size, 2000);
  assert.equal(new Set(deck.map((card) => card.word)).size, 2000);
  assert.deepEqual(deck.map((card) => card.word), approved);
  assert.deepEqual(deck.map((card) => card.rank), Array.from({ length: 2000 }, (_, i) => i + 1));
  for (const word of ["ja", "zaterdag", "zes", "twee", "idee", "amerikaanse",
    "actie", "actief", "activiteit", "machine", "manager", "renovatie", "reparatie",
    "repareren", "reserveren", "reservering", "respecteren", "resultaat"]) {
    assert.equal(byWord.has(word), false, word);
  }
});

test("retained cards keep their IDs and new words never inherit retired progress", () => {
  const oldIds = new Set(Object.values(legacy));
  const retained = deck.filter((card) => legacy[card.word]);
  assert.equal(retained.length, 883);
  for (const card of deck) {
    if (legacy[card.word]) assert.equal(card.id, legacy[card.word], card.word);
    else assert.equal(oldIds.has(card.id), false, card.word);
  }
});

test("generated artifacts agree with the reviewed source", () => {
  assert.deepEqual(deck, source.map(({ example, ...card }) => {
    assert.deepEqual(examples[card.id], example, card.word);
    return card;
  }));
});

test("all cards have teaching content, noun articles and complete verb paradigms", () => {
  for (const card of deck) {
    assert.ok(card.english.trim(), card.word);
    assert.doesNotMatch(card.english, /synonym of|inflection of|TODO|TBD/i, card.word);
    assert.ok(card.pos, card.word);
    if (card.pos === "noun") {
      assert.ok(["de", "het", "de/het"].includes(card.article), card.word);
      assert.equal(card.dutch, card.article + " " + card.word);
    } else {
      assert.equal(card.article, undefined, card.word);
    }
    if (card.pos === "verb") {
      const v = card.verb;
      assert.equal(v.infinitive, card.word);
      for (const key of ["present", "past", "participle", "auxiliary", "perfect"]) {
        assert.equal(typeof v[key], "string", card.word);
        assert.ok(v[key].length, card.word);
      }
      assert.ok(["hebben", "zijn", "hebben / zijn"].includes(v.auxiliary));
    } else {
      assert.equal(card.verb, undefined, card.word);
    }
  }
});

test("known dictionary ambiguities teach the everyday meanings", () => {
  assert.equal(byWord.get("saai").pos, "adjective");
  assert.match(byWord.get("saai").english, /boring/);
  assert.equal(byWord.get("blind").pos, "adjective");
  assert.equal(byWord.get("bescheiden").pos, "adjective");
  assert.equal(byWord.get("inkomen").dutch, "het inkomen");
  assert.equal(byWord.get("reden").dutch, "de reden");
  assert.equal(byWord.get("spreekuur").dutch, "het spreekuur");
  assert.equal(byWord.get("standpunt").dutch, "het standpunt");
  assert.equal(byWord.get("gezicht").english, "face");
  assert.match(byWord.get("nuchter").english, /down-to-earth/);
});

test("separable, reflexive and intransitive verb forms are grammatical", () => {
  assert.equal(byWord.get("opstaan").verb.present, "hij staat op");
  assert.equal(byWord.get("uitleggen").verb.past, "hij legde uit");
  assert.equal(byWord.get("aanmelden").verb.present, "hij meldt zich aan");
  assert.equal(byWord.get("afvragen").verb.perfect, "hij heeft zich afgevraagd");
  assert.equal(byWord.get("voorkomen").verb.present, "hij voorkomt");
  assert.equal(byWord.get("afstuderen").verb.perfect, "hij is afgestudeerd");
  assert.equal(byWord.get("ontstaan").verb.perfect, "het is ontstaan");
  assert.equal(byWord.get("tegenkomen").verb.perfect, "hij is tegengekomen");
  assert.equal(byWord.get("verhuizen").verb.perfect, "hij is verhuisd");
  assert.equal(byWord.get("begaan").verb.perfect, "hij heeft begaan");
});

test("textbook references remain attached to the 302 verified words", () => {
  assert.equal(deck.filter((card) => card.bookReferences).length, 302);
  for (const word of ["afdwingen", "beweegreden", "invalshoek", "omstreden", "ontkomen", "waarneming"]) {
    assert.ok(byWord.get(word).bookReferences.length, word);
  }
});
