/**
 * FlashForge Material Station card.
 *
 * Vector spool presentation adapted from ha-bambulab-cards (ISC license;
 * see THIRD_PARTY_NOTICES.md). FlashForge supplies the four slot colors,
 * material names, and active slot.
 *
 * On the Creator 5 series the four slots *are* the four tool heads, so the
 * card reads as "which filament is in which head" - the one thing the printer
 * reports and the print-start validation checks against.
 *
 * The card holds no state of its own. It bootstraps from the integration's
 * `flashforge/station` websocket command, which also names the entities that
 * carry the live state; from then on the card reads those entities, so what
 * it shows is what the coordinator last fetched. If the entities do not exist
 * yet (a capability reported after setup), the card re-asks the command until
 * they do.
 *
 * Vanilla custom element, same rules as ff-job-card.js: no build step, copy in
 * translations, guarded registration for Home Assistant's custom element
 * registry swap.
 */

const CARD_VERSION = "1.6.4";

console.info(
  `%c FLASHFORGE-MATERIAL-STATION-CARD %c ${CARD_VERSION} `,
  "color: white; background: #f7761f; font-weight: 700;",
  "color: #f7761f; background: white; font-weight: 700;"
);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Escape for interpolation into innerHTML. Material names come from the printer. */
function esc(value) {
  return String(value === null || value === undefined ? "" : value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]
  );
}

/** A CSS color for a swatch, falling back to a muted fill when unknown. */
function swatchColor(hex) {
  return /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "var(--disabled-text-color)";
}

/* ------------------------------------------------------------------ */
/* Strings                                                             */
/* ------------------------------------------------------------------ */

const TRANSLATION_BASE = "/flashforge_frontend/translations";
const FALLBACK_LANGUAGE = "en";

const _tables = new Map();

const RETRY_DELAYS = [500, 2000, 5000];

function loadTable(language) {
  if (!_tables.has(language)) {
    _tables.set(
      language,
      fetch(`${TRANSLATION_BASE}/${language}.json?v=${CARD_VERSION}`)
        .then((response) => {
          if (response.status === 404) return null;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .catch((err) => {
          _tables.delete(language);
          throw err;
        })
    );
  }
  return _tables.get(language);
}

async function loadTableWithRetry(language) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await loadTable(language);
    } catch (err) {
      if (attempt >= RETRY_DELAYS.length) {
        console.warn(
          `ff-material-station-card: could not load ${language} translations`,
          err
        );
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

async function translatorFor(language) {
  const tag =
    String(language || "").toLowerCase().split("-")[0] || FALLBACK_LANGUAGE;

  const base = await loadTableWithRetry(FALLBACK_LANGUAGE);
  const table =
    tag === FALLBACK_LANGUAGE ? base : (await loadTableWithRetry(tag)) || base;

  const t = (key, vars) => {
    let text;
    if (table && table[key] !== undefined) text = table[key];
    else if (base && base[key] !== undefined) text = base[key];
    else return key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  };

  return t;
}

function pendingTranslator() {
  return () => "";
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const STYLES = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .station { padding: 5px 0; }

  .info-bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; padding: 0 16px 10px;
  }
  .info-bar.no-title { justify-content: flex-start; }
  .title {
    font-size: 1.1rem; font-weight: 500; color: var(--primary-text-color);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .subtitle { color: var(--secondary-text-color); font-size: 0.78rem; margin-top: 2px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--secondary-background-color); color: var(--primary-text-color);
    border-radius: 8px; padding: 4px 10px; font-size: 0.82rem;
    white-space: nowrap;
  }
  .chip.active { background: rgba(5, 173, 66, 0.18); color: #05ad42; }
  .chip.offline { background: #252527; border: 1px solid #414144; color: #e9e9eb; }
  .chip.offline::before { content: "◉"; font-size: 0.85rem; }
  .chip.active .pulse-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #05ad42;
    animation: station-pulse 1.6s ease-out infinite;
  }

  /* Vector spool geometry and motion adapted from ha-bambulab-cards. */
  .spools {
    display: flex; justify-content: center; align-items: stretch;
    gap: 5px; box-sizing: border-box; width: 100%; padding: 0 5px;
  }
  .spool {
    flex: 0 1 25%; min-width: 0; max-width: 25%; box-sizing: border-box;
    display: flex; flex-direction: column; padding: 0 2px; cursor: pointer;
  }
  .spool-holder {
    box-sizing: border-box; min-height: 105px; flex: 1; width: 100%;
    display: flex; position: relative; overflow: hidden;
    border: 7px solid #808080; border-radius: 0.6em;
    background: linear-gradient(#959595, #626262, #959595);
  }
  .spool.active .spool-holder { border-color: var(--primary-color, #05ad42); }
  .spool-frame {
    box-sizing: border-box; display: flex; align-items: stretch;
    width: 100%; padding: min(15%, 30px) 0;
    border: 2px solid #5a5a5a; border-radius: 3px;
  }
  .spool-side { width: 15%; max-width: 30px; background: #3d3d3d; }
  .roll-wrap {
    flex: 1; min-width: 0; display: flex; align-items: center;
    justify-content: center; overflow: hidden;
  }
  .spool-roll {
    position: relative; width: 100%; height: 95%; overflow: hidden;
    background: var(--filament-color);
  }
  .spool.empty .spool-roll { height: 20%; background: #3d3d3d; }
  .spool-roll:not(.empty-roll)::after {
    content: ""; position: absolute; inset: 0;
    background: repeating-linear-gradient(90deg, transparent 0 2px, rgba(0,0,0,.5) 2px 4px);
  }
  .spool.active.wiggle .roll-wrap { animation: station-wiggle 3s linear infinite; }
  .spool.active.reflection .spool-roll::before {
    content: ""; position: absolute; inset: -100% 0; z-index: 1;
    background: linear-gradient(transparent 25%, rgba(255,255,255,.2) 50%, transparent 75%);
    animation: station-reflection 3s linear infinite;
  }
  .spool-info { display: flex; justify-content: center; margin-top: 7px; }
  .spool-material {
    box-sizing: border-box; display: flex; justify-content: center; align-items: center;
    min-height: 56px; max-width: 100%; padding: 0 10px;
    background: #444; border-radius: .5em; color: white;
    font-size: small; line-height: 1em; text-align: center;
    overflow-wrap: anywhere;
  }

  /* Graphic style: flat discs instead of spool rings. */
  .graphic-disc {
    align-self: center;
    width: 56px; height: 56px; border-radius: 50%;
    border: 3px solid var(--card-background-color, #fff);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  }
  .spool.empty .graphic-disc {
    background: var(--card-background-color, #fff) !important;
    border: 2px dashed var(--disabled-text-color);
    box-shadow: none;
  }

  @media (max-width: 420px) {
    .spools { gap: 2px; padding: 0 5px; }
    .spool { padding: 0 2px; }
    .spool-holder { min-height: 85px; border-width: 5px; }
    .graphic-disc { width: 44px; height: 44px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .chip.active .pulse-dot, .spool.active.wiggle .roll-wrap,
    .spool.active.reflection .spool-roll::before { animation: none; }
  }

  .message {
    padding: 20px 16px; color: var(--secondary-text-color);
    font-size: 0.95rem; text-align: center;
  }

  @keyframes station-pulse {
    0% { box-shadow: 0 0 0 0 rgba(5, 173, 66, 0.45); }
    70% { box-shadow: 0 0 0 7px rgba(5, 173, 66, 0); }
    100% { box-shadow: 0 0 0 0 rgba(5, 173, 66, 0); }
  }
  @keyframes station-wiggle {
    0%, 20%, 40%, 60%, 80%, 100% { transform: skew(0, 0); }
    10%, 50% { transform: skew(2deg, 2deg); }
    30%, 70% { transform: skew(-2deg, -2deg); }
  }
  @keyframes station-reflection {
    0% { transform: translateY(-50%); }
    100% { transform: translateY(50%); }
  }
`;

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

/** Seconds between re-asks while the slot entities do not exist yet. */
const STATION_POLL_MS = 15000;

class FlashForgeMaterialStationCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("ff-material-station-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._language = null;
    this._t = pendingTranslator();
    this._meta = null; // last flashforge/station snapshot
    this._loaded = false;
    this._slots = []; // [{slot_id, material_name, material_color, has_filament}]
    this._activeSlot = 0;
    this._online = null;
    this._pollTimer = null;
  }

  setConfig(config) {
    const previousEntry = this._config.entry_id;
    this._config = config || {};

    if (this._hass && this._config.entry_id !== previousEntry) {
      this._meta = null;
      this._loaded = false;
      this._slots = [];
      this._activeSlot = 0;
      this._online = null;
      this._stopPoll();
      this._render();
      this._load();
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;

    const language = (hass && hass.locale && hass.locale.language) || null;
    if (language !== this._language) {
      this._language = language;
      this._applyLanguage(language);
    }

    if (first) {
      this._render();
      this._load();
    } else {
      this._syncFromEntities();
    }
  }

  getCardSize() {
    return 4;
  }

  disconnectedCallback() {
    this._stopPoll();
  }

  connectedCallback() {
    if (this._hass && this._config.entry_id && !this._entityIdsComplete()) {
      this._refresh();
    }
  }

  async _applyLanguage(language) {
    const t = await translatorFor(language);
    if (language !== this._language) return;
    this._t = t;
    if (this._root) this._render();
  }

  /* -- transport --------------------------------------------------- */

  _send(message) {
    if (!this._hass) return Promise.reject(new Error("not ready"));
    return this._hass.connection.sendMessagePromise({
      ...message,
      entry_id: this._config.entry_id,
    });
  }

  async _load() {
    if (!this._config.entry_id) return;

    this._loaded = false;
    this._render();

    try {
      this._meta = await this._send({ type: "flashforge/station" });
      this._loaded = true;
    } catch (err) {
      this._meta = null;
      this._loaded = true;
      console.warn("ff-material-station-card: station fetch failed", err);
      this._startPoll();
    }

    this._syncFromEntities();
    this._render();
  }

  /**
   * Refresh the snapshot in the background; used only until the slot entities
   * exist, after which entity state is the live source.
   */
  async _refresh() {
    try {
      this._meta = await this._send({ type: "flashforge/station" });
    } catch (err) {
      return;
    }
    this._syncFromEntities();
    this._render();
  }

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _startPoll() {
    if (!this._pollTimer && this.isConnected) {
      this._pollTimer = setInterval(() => this._refresh(), STATION_POLL_MS);
    }
  }

  _entityIdsComplete() {
    if (!this._meta || !this._meta.entity_ids) return false;
    if (!this._meta.entity_ids.active) return false;
    for (let slot = 1; slot <= 4; slot++) {
      if (!this._meta.entity_ids[`slot_${slot}`]) return false;
    }
    return true;
  }

  /**
   * Build the displayed slot state. Entity state when the entities exist (the
   * coordinator is the single source of truth), the command snapshot until
   * they do - re-asking until the capability latch has created them.
   */
  _syncFromEntities() {
    if (!this._meta || !this._hass) return;

    if (this._entityIdsComplete()) {
      this._stopPoll();
      const ids = this._meta.entity_ids;
      const slots = [];
      for (let n = 1; n <= 4; n++) {
        const state = this._hass.states[ids[`slot_${n}`]];
        const attrs = (state && state.attributes) || {};
        slots.push({
          slot_id: n,
          material_name: attrs.material || "",
          material_color: attrs.material_color || "",
          has_filament: Boolean(attrs.has_filament),
        });
      }
      const activeState = this._hass.states[ids.active];
      const active = activeState ? Number(activeState.state) || 0 : 0;
      const onlineState = ids.online && this._hass.states[ids.online];
      const online = onlineState
        ? onlineState.state === "on"
        : Boolean(this._meta.online);
      this._applySnapshot(slots, active, online);
    } else {
      const reported = this._meta.slots || [];
      this._applySnapshot(
        Array.from({ length: 4 }, (_, index) => {
          const slotId = index + 1;
          const slot = reported.find((item) => item.slot_id === slotId);
          return slot
            ? { ...slot, has_filament: !slot.is_empty }
            : { slot_id: slotId, has_filament: false };
        }),
        this._meta.active_slot || 0,
        Boolean(this._meta.online)
      );
      // The entities may simply not have been created yet; keep asking until
      // the capability appears and the live path can take over.
      this._startPoll();
    }
  }

  _applySnapshot(slots, active, online) {
    const next = JSON.stringify({ slots, active, online });
    if (next === this._snapshotKey) return;
    this._snapshotKey = next;
    this._slots = slots;
    this._activeSlot = active;
    this._online = online;
    this._render();
  }

  /* -- rendering ---------------------------------------------------- */

  _spoolMarkup(slot) {
    const filled = slot.has_filament && Boolean(slot.material_name);
    const material = filled
      ? slot.material_name
      : this._t("station_empty");
    const color = filled ? swatchColor(slot.material_color) : "var(--disabled-text-color)";
    const active = slot.slot_id === this._activeSlot ? " active" : "";
    const emptyCls = filled ? "" : " empty";
    const motion = this._config.style === "graphic" ? "" :
      `${this._config.spool_anim_wiggle === false ? "" : " wiggle"}` +
      `${this._config.spool_anim_reflection === false ? "" : " reflection"}`;

    let graphic;
    if (this._config.style === "graphic") {
      graphic = `
        <div class="graphic-disc" style="background: ${esc(color)}"></div>`;
    } else {
      graphic = `
        <div class="spool-holder" style="--filament-color: ${esc(color)}">
          <div class="spool-frame">
            <div class="spool-side"></div>
            <div class="roll-wrap"><div class="spool-roll${filled ? "" : " empty-roll"}"></div></div>
            <div class="spool-side"></div>
          </div>
        </div>`;
    }

    return `
      <div class="spool${active}${emptyCls}${motion}" data-slot="${slot.slot_id}">
        ${graphic}
        ${this._config.show_type === false ? "" : `<div class="spool-info">
          <div class="spool-material" title="${esc(material)}">${esc(material)}</div>
        </div>`}
      </div>`;
  }

  _chipMarkup() {
    if (this._online === false) {
      return `<div class="chip offline">${esc(this._t("station_offline"))}</div>`;
    }
    if (this._activeSlot > 0) {
      return `
        <div class="chip active" title="${esc(this._t("station_active_slot", { slot: this._activeSlot }))}">
          <span class="pulse-dot"></span>
          ${esc(this._t("station_active_slot", { slot: this._activeSlot }))}
        </div>`;
    }
    return `<div class="chip">${esc(this._t("station_idle"))}</div>`;
  }

  _bodyMarkup() {
    if (!this._config.entry_id) return `<div class="message">${esc(this._t("station_no_printer"))}</div>`;
    if (!this._loaded) return `<div class="message">${esc(this._t("station_loading"))}</div>`;
    if (!this._meta || !this._meta.has_material_station) {
      return `<div class="message">${esc(this._t("station_no_station"))}</div>`;
    }

    const title = Object.hasOwn(this._config, "header")
      ? this._config.header
      : (this._config.title || this._t("station_default_title"));
    const subtitle = this._config.subtitle || "";
    return `
      <div class="station">
        <div class="info-bar${title || subtitle ? "" : " no-title"}">
          <div>
            ${title ? `<div class="title">${esc(title)}</div>` : ""}
            ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ""}
          </div>
          ${this._chipMarkup()}
        </div>
        <div class="spools">
          ${this._slots.map((slot) => this._spoolMarkup(slot)).join("")}
        </div>
      </div>`;
  }

  _render() {
    if (!this._root) {
      this._root = this.attachShadow({ mode: "open" });
    }
    this._root.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>${this._bodyMarkup()}</ha-card>`;

    this._root.querySelectorAll("[data-slot]").forEach((element) =>
      element.addEventListener("click", () => {
        const entityId =
          this._meta && this._meta.entity_ids
            ? this._meta.entity_ids[`slot_${element.dataset.slot}`]
            : null;
        if (!entityId) return;
        this.dispatchEvent(
          new CustomEvent("hass-more-info", {
            detail: { entityId },
            bubbles: true,
            composed: true,
          })
        );
      })
    );
  }
}

/* ------------------------------------------------------------------ */
/* Config editor                                                       */
/* ------------------------------------------------------------------ */

class FlashForgeMaterialStationCardEditor extends HTMLElement {
  constructor() {
    super();
    this._language = null;
    this._t = pendingTranslator();
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;

    const language = (hass && hass.locale && hass.locale.language) || null;
    if (language !== this._language) {
      this._language = language;
      this._applyLanguage(language);
    }

    this._loadEntries();
  }

  async _applyLanguage(language) {
    const t = await translatorFor(language);
    if (language !== this._language) return;
    this._t = t;
    if (this._root) this._render();
  }

  async _loadEntries() {
    if (this._entries || !this._hass) return;
    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "flashforge/entries",
      });
      this._entries = result.entries || [];
    } catch (err) {
      this._entries = [];
    }
    this._render();
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _render() {
    if (!this._root) {
      this._root = this.attachShadow({ mode: "open" });
    }
    const entries = this._entries || [];
    const selected = (this._config && this._config.entry_id) || "";
    const style = (this._config && this._config.style) || "vector";
    const showType = this._config ? this._config.show_type !== false : true;

    this._root.innerHTML = `
      <style>
        .field { display: block; margin-bottom: 14px; }
        .label { font-size: 0.85rem; color: var(--secondary-text-color); margin-bottom: 4px; }
        select, input {
          width: 100%; padding: 8px; border-radius: 6px; box-sizing: border-box;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color); color: var(--primary-text-color);
        }
        .check { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: var(--primary-text-color); }
      </style>
      <label class="field">
        <div class="label">${esc(this._t("station_editor_printer"))}</div>
        <select id="entry">
          <option value="">${esc(this._t("station_editor_select"))}</option>
          ${entries
            .map(
              (entry) =>
                `<option value="${esc(entry.entry_id)}" ${
                  entry.entry_id === selected ? "selected" : ""
                }>${esc(entry.title)}</option>`
            )
            .join("")}
        </select>
      </label>
      <label class="field">
        <div class="label">${esc(this._t("station_editor_title"))}</div>
        <input id="title" type="text" value="${esc(
          (this._config && (this._config.header ?? this._config.title)) || ""
        )}">
      </label>
      <label class="field">
        <div class="label">${esc(this._t("station_editor_style"))}</div>
        <select id="style">
          <option value="vector" ${style === "vector" ? "selected" : ""}>
            ${esc(this._t("station_editor_style_vector"))}
          </option>
          <option value="graphic" ${style === "graphic" ? "selected" : ""}>
            ${esc(this._t("station_editor_style_graphic"))}
          </option>
        </select>
      </label>
      <label class="field check">
        <input id="show_type" type="checkbox" ${showType ? "checked" : ""}>
        ${esc(this._t("station_editor_show_type"))}
      </label>`;

    this._root.getElementById("entry").addEventListener("change", (event) => {
      this._emit({ ...this._config, entry_id: event.target.value || undefined });
    });
    this._root.getElementById("title").addEventListener("change", (event) => {
      const title = event.target.value.trim();
      const config = { ...this._config };
      if (title) config.header = title;
      else delete config.header;
      delete config.title;
      this._emit(config);
    });
    this._root.getElementById("style").addEventListener("change", (event) => {
      this._emit({ ...this._config, style: event.target.value });
    });
    this._root.getElementById("show_type").addEventListener("change", (event) => {
      this._emit({ ...this._config, show_type: event.target.checked });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

// Same registry-swap guard as ff-job-card.js: define into whatever registry is
// current, re-define when the frontend exchanges it, and stop watching after a
// minute so a page that never swaps does not poll forever.
const ELEMENTS = [
  ["ff-material-station-card", FlashForgeMaterialStationCard],
  ["ff-material-station-card-editor", FlashForgeMaterialStationCardEditor],
];

function defineOnce(name, constructor) {
  if (customElements.get(name)) return;
  try {
    customElements.define(name, constructor);
  } catch (err) {
    customElements.define(name, class extends constructor {});
  }
}

function registerElements() {
  for (const [name, constructor] of ELEMENTS) defineOnce(name, constructor);
}

registerElements();

const REGISTRY_POLL_MS = 200;
const REGISTRY_TIMEOUT_MS = 60000;
const initialRegistry = window.customElements;
let registryWaited = 0;
const registryWatch = setInterval(() => {
  registryWaited += REGISTRY_POLL_MS;
  if (window.customElements !== initialRegistry) {
    registerElements();
    clearInterval(registryWatch);
  } else if (registryWaited >= REGISTRY_TIMEOUT_MS) {
    clearInterval(registryWatch);
  }
}, REGISTRY_POLL_MS);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ff-material-station-card",
  name: "FlashForge Material Station",
  description:
    "Show the four Material Station slots of a FlashForge printer with their loaded filament color and type, highlighting the slot that is currently in use.",
  preview: false,
  documentationURL: "https://github.com/Woebenskie/ff-5mp-hass",
});
