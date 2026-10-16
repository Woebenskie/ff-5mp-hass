"""The card's version constant tracks the manifest.

Two different values do the browser cache-busting for one card:

* `card.py` appends the **manifest** version to the module URL, which is what
  makes a released update reach a browser holding the previous file.
* `ff-job-card.js` appends its own `CARD_VERSION` to the translation files it
  fetches at runtime.

Let those drift and a release ships new JavaScript against translation URLs the
browser already has cached - the card updates, its copy does not, and the
symptom is untranslated or outdated strings that look like a translation bug
and are not. Home Assistant's service worker caches by URL, so the only thing
standing between a user and stale copy is the query string changing.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

COMPONENT = Path(__file__).parents[2] / "custom_components" / "flashforge"

CARD_FILES = [
    COMPONENT / "frontend" / "ff-job-card.js",
    COMPONENT / "frontend" / "ff-material-station-card.js",
    COMPONENT / "frontend" / "ff-print-status-card.js",
]

CARD_IDS = ["job", "material-station", "print-status"]


@pytest.mark.parametrize("source", CARD_FILES, ids=CARD_IDS)
def test_card_version_matches_manifest(source: Path) -> None:
    manifest = json.loads((COMPONENT / "manifest.json").read_text(encoding="utf-8"))
    text = source.read_text(encoding="utf-8")

    match = re.search(r"""const CARD_VERSION = ["']([^"']+)["']""", text)
    assert match, f"CARD_VERSION is not declared in {source.name}"

    assert match.group(1) == manifest["version"], (
        f"{source.name}: CARD_VERSION and manifest.json version disagree; bump "
        "both or the card's translations will be served from a stale browser cache"
    )


@pytest.mark.parametrize("source", CARD_FILES, ids=CARD_IDS)
def test_translations_are_cache_busted(source: Path) -> None:
    """The translation fetch must carry the version, or it is cached forever.

    `card.py` serves `frontend/` with long-lived cache headers, which is only
    safe because every URL under it carries a version that a release changes.
    """
    text = source.read_text(encoding="utf-8")
    assert "?v=${CARD_VERSION}" in text
