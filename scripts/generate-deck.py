#!/usr/bin/env python3
"""Build the approved deck from the checked-in, reviewed vocabulary.

No network, frequency ranking, or temporary dictionary dumps are needed.
Edit curated-vocabulary.json deliberately; the approved TXT locks membership.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'app/data/curated-vocabulary.json'
APPROVED = ROOT / 'docs/dutch-2000-book-review.txt'


def main():
    vocabulary = json.loads(SOURCE.read_text(encoding='utf-8'))
    approved = APPROVED.read_text(encoding='utf-8').splitlines()
    words = [card['word'] for card in vocabulary]
    if len(words) != 2000 or len(set(words)) != 2000 or words != approved:
        raise SystemExit('The source must match all 2,000 approved words, in order.')
    if len({card['id'] for card in vocabulary}) != 2000:
        raise SystemExit('Card IDs must be unique and stable.')
    deck = []
    examples = {}
    for rank, source in enumerate(vocabulary, 1):
        card = {key: value for key, value in source.items() if key != 'example'}
        if card['rank'] != rank or not card['english'] or not card['pos']:
            raise SystemExit(f'Incomplete card: {card["word"]}')
        if card['pos'] == 'noun' and not card.get('article'):
            raise SystemExit(f'Missing article: {card["word"]}')
        if card['pos'] == 'verb' and not card.get('verb'):
            raise SystemExit(f'Missing verb forms: {card["word"]}')
        example = source['example']
        if not example.get('text') or example.get('source') not in {'editorial', 'tatoeba'}:
            raise SystemExit(f'Missing reviewed example: {card["word"]}')
        deck.append(card)
        examples[card['id']] = example
    for name, data in [('deck.json', deck), ('examples.json', examples)]:
        (ROOT / 'app/data' / name).write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
    print(f'Built {len(deck):,} approved cards and {len(examples):,} examples.')


if __name__ == '__main__':
    main()
