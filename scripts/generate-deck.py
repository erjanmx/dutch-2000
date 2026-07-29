#!/usr/bin/env python3
"""Build the static Dutch 2000 learning deck from open lexical sources.

Inputs are intentionally kept outside the repository:
  /tmp/kaikki-dutch.jsonl  (English Wiktionary extraction by kaikki.org)
  /tmp/taalboost-verbs.html (auxiliary reference for common Dutch verbs)

The generated deck is a derived learning aid. Attribution is shown in the app.
"""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd
from wordfreq import top_n_list, zipf_frequency


ROOT = Path(__file__).resolve().parents[1]
KAIKKI_PATH = Path("/tmp/kaikki-dutch.jsonl")
VERBS_PATH = Path("/tmp/taalboost-verbs.html")
OUTPUT_PATH = ROOT / "app" / "data" / "deck.json"

ALLOWED_POS = {
    "adj",
    "adv",
    "article",
    "conj",
    "det",
    "interj",
    "noun",
    "num",
    "particle",
    "postp",
    "prefix",
    "prep",
    "pron",
    "verb",
}

POS_LABELS = {
    "adj": "adjective",
    "adv": "adverb",
    "article": "article",
    "conj": "conjunction",
    "det": "determiner",
    "interj": "interjection",
    "noun": "noun",
    "num": "number",
    "particle": "particle",
    "postp": "postposition",
    "prefix": "prefix",
    "prep": "preposition",
    "pron": "pronoun",
    "verb": "verb",
}

POS_TIEBREAK = {
    "article": 15,
    "pron": 14,
    "det": 13,
    "prep": 12,
    "conj": 11,
    "verb": 10,
    "noun": 9,
    "adv": 8,
    "adj": 7,
    "particle": 6,
    "num": 5,
    "interj": 4,
    "postp": 3,
    "prefix": 2,
}

POS_OVERRIDES = {
    "aan": "preposition",
    "al": "adverb",
    "als": "conjunction",
    "bij": "preposition",
    "daar": "adverb",
    "dan": "adverb",
    "dat": "pronoun",
    "de": "article",
    "deze": "pronoun",
    "die": "pronoun",
    "dit": "pronoun",
    "door": "preposition",
    "echt": "adjective",
    "een": "article",
    "en": "conjunction",
    "er": "pronoun",
    "haar": "pronoun",
    "hem": "pronoun",
    "hen": "pronoun",
    "het": "article",
    "hij": "pronoun",
    "hoe": "adverb",
    "hun": "pronoun",
    "in": "preposition",
    "jouw": "determiner",
    "maar": "conjunction",
    "me": "pronoun",
    "meer": "adverb",
    "met": "preposition",
    "mij": "pronoun",
    "mijn": "determiner",
    "naar": "preposition",
    "niet": "adverb",
    "nog": "adverb",
    "nu": "adverb",
    "of": "conjunction",
    "om": "preposition",
    "ons": "pronoun",
    "op": "preposition",
    "over": "preposition",
    "te": "preposition",
    "twee": "number",
    "uit": "preposition",
    "van": "preposition",
    "voor": "preposition",
    "waar": "adverb",
    "wat": "pronoun",
    "weer": "adverb",
    "we": "pronoun",
    "wel": "adverb",
    "ze": "pronoun",
    "zij": "pronoun",
    "zo": "adverb",
}

GLOSS_OVERRIDES = {
    "de": "the (common-gender singular and all plurals)",
    "een": "a, an; one",
    "het": "the (neuter singular); it",
    "hun": "their; them",
    "je": "you; your (unstressed)",
    "me": "me; my (unstressed)",
}

BAD_TAGS = {
    "archaic",
    "dated",
    "historical",
    "nonstandard",
    "obsolete",
    "rare",
}


def normalize_word(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace("‐", "-")
        .replace("‑", "-")
        .replace("’", "'")
    )


def is_learning_word(value: str) -> bool:
    return bool(re.fullmatch(r"[a-zà-ÿĳ'’-]+", value, re.IGNORECASE))


def clean_gloss(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"^\([^)]*\)\s*", "", value)
    value = value.replace("Synonym of ", "").replace("Alternative form of ", "")
    return value[:180].rstrip(" ,;:")


def usable_senses(entry: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for sense in entry.get("senses", []):
        tags = set(sense.get("tags", []))
        if sense.get("form_of") or sense.get("alt_of") or tags.intersection(BAD_TAGS):
            continue
        glosses = [clean_gloss(g) for g in sense.get("glosses", [])]
        glosses = [g for g in glosses if g and not g.startswith("inflection of")]
        if glosses:
            result.append({**sense, "_gloss": glosses[0]})
    return result


def load_auxiliaries() -> dict[str, dict[str, str]]:
    tables = pd.read_html(VERBS_PATH)
    frame = tables[0].iloc[1:].copy()
    frame.columns = [
        "letter",
        "verb",
        "past_singular",
        "past_plural",
        "auxiliary",
        "participle",
        "english",
    ]
    result: dict[str, dict[str, str]] = {}
    for row in frame.fillna("").to_dict("records"):
        verb = normalize_word(str(row["verb"]))
        if not verb or not is_learning_word(verb):
            continue
        auxiliary = normalize_word(str(row["auxiliary"]))
        if "zijn" in auxiliary and "hebben" in auxiliary:
            auxiliary = "hebben / zijn"
        elif "zijn" in auxiliary:
            auxiliary = "zijn"
        else:
            auxiliary = "hebben"
        result[verb] = {
            "auxiliary": auxiliary,
            "english": str(row["english"]).strip(),
        }
    return result


def load_entries() -> tuple[
    dict[str, list[dict[str, Any]]],
    dict[str, set[str]],
]:
    lemmas: dict[str, list[dict[str, Any]]] = defaultdict(list)
    forms_to_lemmas: dict[str, set[str]] = defaultdict(set)

    with KAIKKI_PATH.open("r", encoding="utf-8") as handle:
        for line in handle:
            entry = json.loads(line)
            word = normalize_word(entry.get("word", ""))
            pos = entry.get("pos", "")
            if not word or pos not in ALLOWED_POS:
                continue

            senses = entry.get("senses", [])
            lemma_senses = usable_senses(entry)
            if (
                not lemma_senses
                and word in GLOSS_OVERRIDES
                and POS_LABELS.get(pos) == POS_OVERRIDES.get(word)
            ):
                lemma_senses = [{"_gloss": GLOSS_OVERRIDES[word]}]
            if lemma_senses:
                entry["_usable_senses"] = lemma_senses
                lemmas[word].append(entry)

            for sense in senses:
                for form_of in sense.get("form_of", []):
                    lemma = normalize_word(form_of.get("word", ""))
                    if lemma:
                        forms_to_lemmas[word].add(lemma)

    return lemmas, forms_to_lemmas


def article_for(entry: dict[str, Any]) -> str | None:
    genders: set[str] = set()
    for template in entry.get("head_templates", []):
        if template.get("name") == "nl-noun":
            gender = template.get("args", {}).get("1", "")
            if gender:
                genders.add(gender)
    for sense in entry.get("_usable_senses", []):
        tags = set(sense.get("tags", []))
        if "neuter" in tags:
            genders.add("n")
        if "masculine" in tags or "feminine" in tags or "common" in tags:
            genders.add("c")

    has_neuter = "n" in genders
    has_common = bool(genders.intersection({"m", "f", "c", "mf", "m-p", "f-p"}))
    if has_neuter and has_common:
        return "de/het"
    if has_neuter:
        return "het"
    if has_common:
        return "de"
    return None


def preferred_form(
    entry: dict[str, Any],
    required: set[str],
    forbidden: set[str] | None = None,
) -> str | None:
    forbidden = forbidden or set()
    candidates: list[str] = []
    for item in entry.get("forms", []):
        tags = set(item.get("tags", []))
        form = normalize_word(item.get("form", ""))
        if (
            form
            and required.issubset(tags)
            and not tags.intersection(BAD_TAGS | forbidden)
            and is_learning_word(form)
        ):
            candidates.append(form)
    return candidates[0] if candidates else None


def build_verb_details(
    word: str,
    entry: dict[str, Any],
    auxiliaries: dict[str, dict[str, str]],
) -> dict[str, str] | None:
    if word not in auxiliaries:
        return None

    present = preferred_form(
        entry,
        {"present", "singular", "third-person"},
        {"formal", "Flanders", "majestic", "subjunctive"},
    )
    past = preferred_form(
        entry,
        {"past", "singular", "third-person"},
        {"formal", "Flanders", "majestic", "subjunctive"},
    )
    participle = preferred_form(entry, {"past", "participle"})
    if not present or not past or not participle:
        return None

    auxiliary = auxiliaries[word]["auxiliary"]
    if auxiliary == "zijn":
        perfect_aux = "is"
    elif auxiliary == "hebben / zijn":
        perfect_aux = "heeft / is"
    else:
        perfect_aux = "heeft"

    return {
        "infinitive": word,
        "present": f"hij {present}",
        "past": f"hij {past}",
        "participle": participle,
        "auxiliary": auxiliary,
        "perfect": f"hij {perfect_aux} {participle}",
    }


def candidate_score(entry: dict[str, Any], word: str, auxiliaries: dict[str, Any]) -> float:
    pos = entry.get("pos", "")
    senses = entry.get("_usable_senses", [])
    score = len(senses) * 10 + POS_TIEBREAK.get(pos, 0)
    if pos == "verb" and word in auxiliaries:
        score += 30
    if pos == "noun" and article_for(entry):
        score += 20
    return score


def select_entry(
    word: str,
    entries: list[dict[str, Any]],
    auxiliaries: dict[str, dict[str, str]],
) -> dict[str, Any] | None:
    valid = []
    for entry in entries:
        pos = entry.get("pos")
        if pos == "noun" and not article_for(entry):
            continue
        if pos == "verb" and not build_verb_details(word, entry, auxiliaries):
            continue
        valid.append(entry)
    if not valid:
        return None
    preferred_pos = POS_OVERRIDES.get(word)
    if preferred_pos:
        preferred = [
            entry
            for entry in valid
            if POS_LABELS.get(entry.get("pos", "")) == preferred_pos
        ]
        if preferred:
            valid = preferred
    return max(valid, key=lambda item: candidate_score(item, word, auxiliaries))


def make_card(
    word: str,
    entry: dict[str, Any],
    rank: int,
    auxiliaries: dict[str, dict[str, str]],
) -> dict[str, Any]:
    pos = entry["pos"]
    senses = entry["_usable_senses"]
    glosses: list[str] = []
    for sense in senses:
        gloss = sense["_gloss"]
        if gloss not in glosses:
            glosses.append(gloss)
        if len(glosses) == 2:
            break

    if word in GLOSS_OVERRIDES:
        english = GLOSS_OVERRIDES[word]
    elif pos == "verb" and auxiliaries.get(word, {}).get("english"):
        english = auxiliaries[word]["english"]
        english = re.sub(r"^to\s+", "", english, flags=re.IGNORECASE)
        english = english[:180]
    else:
        english = "; ".join(glosses)

    article = article_for(entry) if pos == "noun" else None
    dutch = f"{article} {word}" if article else word
    card: dict[str, Any] = {
        "id": f"nl-{rank:04d}-{word.replace(' ', '-')}-{pos}",
        "rank": rank,
        "word": word,
        "dutch": dutch,
        "english": english,
        "pos": POS_LABELS[pos],
        "frequency": round(zipf_frequency(word, "nl"), 2),
    }
    if article:
        card["article"] = article
    if pos == "verb":
        card["verb"] = build_verb_details(word, entry, auxiliaries)
    return card


def main() -> None:
    if not KAIKKI_PATH.exists() or not VERBS_PATH.exists():
        raise SystemExit("Required /tmp source files are missing.")

    auxiliaries = load_auxiliaries()
    lemmas, forms_to_lemmas = load_entries()
    ranked_tokens = [normalize_word(word) for word in top_n_list("nl", 14000)]

    lemma_rank: dict[str, int] = {}
    for token_rank, token in enumerate(ranked_tokens, start=1):
        if not is_learning_word(token):
            continue
        candidate_lemmas: set[str] = set()
        mapped_verbs = {
            lemma
            for lemma in forms_to_lemmas.get(token, set())
            if lemma in auxiliaries and lemma in lemmas
        }
        if mapped_verbs:
            candidate_lemmas.add(
                max(mapped_verbs, key=lambda lemma: zipf_frequency(lemma, "nl"))
            )
        elif token in lemmas:
            candidate_lemmas.add(token)
        else:
            candidate_lemmas.update(forms_to_lemmas.get(token, set()))
        for lemma in candidate_lemmas:
            if lemma in lemmas and is_learning_word(lemma):
                lemma_rank[lemma] = min(token_rank, lemma_rank.get(lemma, math.inf))

    cards = []
    for lemma, _source_rank in sorted(lemma_rank.items(), key=lambda item: (item[1], item[0])):
        entry = select_entry(lemma, lemmas[lemma], auxiliaries)
        if not entry:
            continue
        card = make_card(lemma, entry, len(cards) + 1, auxiliaries)
        if not card["english"] or card["english"].lower() == lemma:
            continue
        cards.append(card)
        if len(cards) == 2000:
            break

    if len(cards) != 2000:
        raise SystemExit(f"Expected 2000 cards, generated {len(cards)}")

    noun_count = sum(card["pos"] == "noun" for card in cards)
    verb_count = sum(card["pos"] == "verb" for card in cards)
    if any(card["pos"] == "noun" and "article" not in card for card in cards):
        raise SystemExit("A noun is missing its article")
    if any(card["pos"] == "verb" and not card.get("verb") for card in cards):
        raise SystemExit("A verb is missing its forms")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(cards, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "cards": len(cards),
                "nouns": noun_count,
                "verbs": verb_count,
                "other": len(cards) - noun_count - verb_count,
                "bytes": OUTPUT_PATH.stat().st_size,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
