"""The card must register itself in the registry the frontend actually uses.

Home Assistant replaces `window.customElements` with its own scoped registry
while it boots. `card.py` injects the card with `add_extra_js_url`, which puts it
in the document and therefore runs it *before* that swap - so a plain
`customElements.define()` at module scope lands in the native registry, which the
frontend then stops consulting.

That failure is invisible from the outside, which is why it cost a long
debugging session on a real install (HA 2026.7.4, Firefox):

* nothing is logged - `define()` succeeds, it just went to the wrong registry;
* `window.customCards` still lists the card, because that lives on `window`;
* `customElements.get("flashforge-job-card")` returns `undefined`;
* the card picker does not offer it and dashboards using it show
  "custom element doesn't exist";
* re-importing the very same file after boot works, and does *not* raise
  "already defined" - proof that the two definitions live in different
  registries.

These tests are textual, like `test_card_version.py`: there is no JS runtime in
this suite, and what has to be guaranteed is a property of the source.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND = (
    Path(__file__).parents[2]
    / "custom_components"
    / "flashforge"
    / "frontend"
)

CARD_FILES = [FRONTEND / "ff-job-card.js", FRONTEND / "ff-material-station-card.js"]
CARD_IDS = ["job", "material-station"]


@pytest.mark.parametrize("card", CARD_FILES, ids=CARD_IDS)
def test_no_unguarded_top_level_define(card: Path) -> None:
    """A bare `customElements.define(...)` at module scope is the bug itself.

    It runs once, before the frontend swaps the registry, and has no second
    chance. Registration has to go through the guarded helper.
    """
    unguarded = re.findall(r"^customElements\.define\(", card.read_text(encoding="utf-8"), re.MULTILINE)
    assert not unguarded, (
        f"{card.name} defines a custom element at module scope. That runs "
        "before Home Assistant installs its own registry, so the definition is "
        "lost; use the guarded helper instead."
    )


@pytest.mark.parametrize("card", CARD_FILES, ids=CARD_IDS)
def test_registration_is_repeated_when_the_registry_is_exchanged(card: Path) -> None:
    """The definition must be re-applied to the registry the frontend installs."""
    source = card.read_text(encoding="utf-8")

    assert "initialRegistry" in source, (
        f"{card.name} no longer remembers which registry it registered into, "
        "so it cannot notice the frontend exchanging it"
    )
    assert "window.customElements !== initialRegistry" in source, (
        f"{card.name} no longer re-registers after the frontend swaps the registry"
    )


@pytest.mark.parametrize("card", CARD_FILES, ids=CARD_IDS)
def test_registration_is_idempotent(card: Path) -> None:
    """Re-registering must not double-define.

    The watcher can fire on a page where nothing was ever swapped, and the module
    is evaluated twice when someone also adds it as a Lovelace resource.
    """
    source = card.read_text(encoding="utf-8")
    assert "if (customElements.get(name)) return;" in source, (
        f"{card.name}: defineOnce no longer checks whether the element is "
        "already registered"
    )


@pytest.mark.parametrize("card", CARD_FILES, ids=CARD_IDS)
def test_the_registry_watch_gives_up(card: Path) -> None:
    """A page that never swaps must not be left with a polling timer forever."""
    source = card.read_text(encoding="utf-8")
    assert "clearInterval(registryWatch)" in source
    assert "REGISTRY_TIMEOUT_MS" in source
