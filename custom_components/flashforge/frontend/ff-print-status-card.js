/**
 * FlashForge print status card. The simple-screen layout is adapted from
 * ha-bambulab-cards (ISC; see THIRD_PARTY_NOTICES.md). All readings and
 * controls are Home Assistant entities resolved by flashforge/status.
 */

const CARD_VERSION = "1.6.6";
const TRANSLATION_BASE = "/flashforge_frontend/translations";
const RETRY_DELAYS = [500, 2000, 5000];
const _tables = new Map();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

function loadTable(language) {
  if (!_tables.has(language)) {
    _tables.set(language, fetch(`${TRANSLATION_BASE}/${language}.json?v=${CARD_VERSION}`)
      .then((response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .catch((err) => { _tables.delete(language); throw err; }));
  }
  return _tables.get(language);
}

async function loadTableWithRetry(language) {
  for (let attempt = 0; ; attempt++) {
    try { return await loadTable(language); }
    catch (err) {
      if (attempt >= RETRY_DELAYS.length) return null;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

async function translatorFor(language) {
  const tag = String(language || "en").toLowerCase().split("-")[0];
  const base = await loadTableWithRetry("en");
  const table = tag === "en" ? base : (await loadTableWithRetry(tag)) || base;
  return (key, vars) => {
    let value = table?.[key] ?? base?.[key] ?? key;
    for (const [name, replacement] of Object.entries(vars || {})) {
      value = value.split(`{${name}}`).join(String(replacement));
    }
    return value;
  };
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  const minutes = Math.ceil(value / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

const STYLES = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  /* Simple-screen geometry adapted from ha-bambulab-cards. */
  .screen {
    box-sizing: border-box; display: flex; gap: 12px; height: 300px;
    padding: 20px; background: #1c1c1c; color: #fff;
  }
  .main { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 5px; }
  .preview {
    position: relative; flex: 1; min-height: 0; display: flex;
    align-items: center; justify-content: center; overflow: hidden;
    background: #252525; border-radius: 4px;
  }
  .preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .preview ha-icon { --mdc-icon-size: 54px; color: #888; }
  .file {
    position: absolute; left: 6px; right: 6px; bottom: 6px;
    padding: 4px 6px; border-radius: 4px; background: rgba(0,0,0,.65);
    font-size: .78em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .progress-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,.1); }
  .progress-fill {
    height: 100%; border-radius: 2px; background: var(--accent-color, #4caf50);
    transition: width .3s ease;
  }
  .progress-fill.paused { background: var(--warning-color, #ff9800); }
  .progress-fill.error { background: var(--error-color, #f44336); }
  .status-line { display: flex; justify-content: space-between; gap: 8px; color: #aaa; font-size: .9em; }
  .status-line span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status-line span:last-child { flex: 0 0 auto; }
  .controls { display: flex; gap: clamp(1px, 1vw, 4px); }
  .control {
    flex: 1; min-width: 0; height: 48px; border: 0; border-radius: 4px;
    background: rgba(255,255,255,.1); color: #fff; cursor: pointer;
  }
  .control:hover:not(:disabled) { background: rgba(255,255,255,.2); }
  .control:disabled { opacity: .45; cursor: not-allowed; }
  .control.on { background: #ffa500; }
  .control.danger:not(:disabled) { background: var(--error-color, #d32f2f); }
  .control ha-icon { --mdc-icon-size: 24px; }
  .sensors {
    box-sizing: border-box; display: flex; flex-direction: column;
    width: 70px; flex: 0 0 70px; padding: 8px; border-radius: 4px;
    background: rgba(255,255,255,.1);
  }
  .sensor {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    justify-content: center; gap: 4px; border-bottom: 1px solid rgba(255,255,255,.1);
    font-size: .87em; overflow: hidden;
  }
  .sensor:last-child { border: 0; }
  .sensor .target { color: #aaa; font-size: .8em; }
  .sensor ha-icon { --mdc-icon-size: 18px; color: #aaa; }
  .sensor button {
    display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0;
    padding: 0; border: 0; background: none; color: inherit; text-align: left; cursor: pointer;
  }
  .sensor button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .message { padding: 20px; color: var(--secondary-text-color); }
  .error-message { color: var(--error-color, #f44336); padding: 0 20px 10px; }
  @media (max-width: 380px) {
    .screen { padding: 12px; gap: 8px; }
    .sensors { width: 62px; flex-basis: 62px; }
  }
`;

class FlashForgePrintStatusCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("ff-print-status-card-editor");
  }

  static getStubConfig() { return { style: "simple" }; }

  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._meta = null;
    this._language = null;
    this._t = (key) => key;
    this._error = "";
    this._pollTimer = null;
  }

  setConfig(config) {
    const previous = this._config.entry_id;
    this._config = config || {};
    if (this._hass && previous !== this._config.entry_id) {
      this._meta = null;
      this._stopPoll();
      this._load();
    }
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    const language = hass?.locale?.language || "en";
    if (language !== this._language) {
      this._language = language;
      this._applyLanguage(language);
    }
    if (first) this._load();
    else this._render();
  }

  getCardSize() { return 5; }
  disconnectedCallback() { this._stopPoll(); }
  connectedCallback() {
    if (this._hass && this._config.entry_id && !this._idsComplete()) this._load();
  }

  async _applyLanguage(language) {
    const t = await translatorFor(language);
    if (language !== this._language) return;
    this._t = t;
    this._render();
  }

  async _load() {
    if (!this._hass || !this._config.entry_id) return;
    const entryId = this._config.entry_id;
    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "flashforge/status", entry_id: entryId,
      });
      if (entryId !== this._config.entry_id) return;
      this._meta = result;
      this._error = "";
      if (this._idsComplete()) this._stopPoll();
      else this._startPoll();
    } catch (err) {
      if (entryId !== this._config.entry_id) return;
      this._error = this._t("status_load_error");
      this._startPoll();
    }
    this._render();
  }

  _idsComplete() {
    const ids = this._meta?.entity_ids;
    return Boolean(ids?.machine_status && ids?.print_progress && ids?.is_online &&
      ids?.remaining_time && ids?.current_file && ids?.nozzle_temperature &&
      ids?.bed_temperature && ids?.pause_print && ids?.resume_print &&
      ids?.cancel_print && ids?.thumbnail && ids?.is_printing && ids?.is_paused);
  }

  _startPoll() {
    if (!this._pollTimer && this.isConnected) {
      this._pollTimer = setInterval(() => this._load(), 15000);
    }
  }

  _stopPoll() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  _entity(key) { return this._meta?.entity_ids?.[key]; }
  _stateObj(key) { return this._hass?.states?.[this._entity(key)]; }
  _state(key) { return this._stateObj(key)?.state; }
  _available(key) {
    const state = this._state(key);
    return state !== undefined && state !== "unknown" && state !== "unavailable";
  }
  _formatted(key) {
    const state = this._stateObj(key);
    if (!this._available(key)) return "—";
    return this._hass?.formatEntityState?.(state) || state.state;
  }
  _moreInfo(key) {
    const entityId = this._entity(key);
    if (entityId) this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  }

  async _press(key) {
    const entity_id = this._entity(key);
    if (!entity_id) return;
    if (key === "cancel_print" && !window.confirm(this._t("status_confirm_cancel"))) return;
    try {
      await this._hass.callService("button", "press", { entity_id });
      this._error = "";
    } catch (err) {
      this._error = this._t("status_action_error");
    }
    this._render();
  }

  async _toggleLed() {
    const entity_id = this._entity("led");
    if (!entity_id) return;
    try {
      await this._hass.callService("switch", "toggle", { entity_id });
      this._error = "";
    } catch (err) {
      this._error = this._t("status_action_error");
    }
    this._render();
  }

  _sensor(icon, title, value, key, target = "") {
    return `<div class="sensor"><button data-info="${key}" title="${esc(title)}">
      <ha-icon icon="${icon}"></ha-icon><span>${esc(value)}</span></button>
      ${target ? `<div class="target">${esc(target)}</div>` : ""}</div>`;
  }

  _body() {
    if (!this._config.entry_id) return `<div class="message">${esc(this._t("status_no_printer"))}</div>`;
    if (!this._meta) return `<div class="message">${esc(this._t("status_loading"))}</div>`;

    const online = this._state("is_online") === "on";
    const printing = this._state("is_printing") === "on";
    const paused = this._state("is_paused") === "on";
    const machineState = this._state("machine_status") || "";
    const progress = printing || paused ? Math.max(0, Math.min(100, Number(this._state("print_progress")) || 0)) : 0;
    const progressClass = paused ? " paused" : machineState === "error" ? " error" : "";
    const remaining = printing || paused ? formatDuration(this._state("remaining_time")) : null;
    const status = online ? this._formatted("machine_status") : this._t("status_offline");
    const layer = Number(this._state("current_layer")) || 0;
    const total = Number(this._state("total_layers")) || 0;
    const statusLine = total > 0 && (printing || paused)
      ? this._t("status_layer", { current: layer, total }) : status;
    const file = this._state("current_file");
    const thumbnail = this._stateObj("thumbnail");
    const picture = thumbnail?.attributes?.entity_picture;
    const pictureUrl = picture && thumbnail?.state
      ? `${picture}${picture.includes("?") ? "&" : "?"}state=${encodeURIComponent(thumbnail.state)}`
      : picture;
    const pauseKey = paused ? "resume_print" : "pause_print";
    const pauseIcon = paused ? "mdi:play" : "mdi:pause";
    const pauseText = this._t(paused ? "status_resume" : "status_pause");
    const canPause = online && (paused || printing) && Boolean(this._entity(pauseKey));
    const canCancel = online && (paused || printing) && Boolean(this._entity("cancel_print"));
    const led = this._state("led") === "on";

    return `<div class="screen"><div class="main">
      <div class="preview" data-info="thumbnail" title="${esc(this._t("status_thumbnail"))}">
        ${pictureUrl ? `<img src="${esc(pictureUrl)}" alt="${esc(this._t("status_thumbnail"))}">`
          : `<ha-icon icon="mdi:image-outline"></ha-icon>`}
        ${file && file !== "None" && file !== "unknown" && file !== "unavailable"
          ? `<div class="file" title="${esc(file)}">${esc(file)}</div>` : ""}
      </div>
      <div class="progress-track"><div class="progress-fill${progressClass}" style="width:${progress}%"></div></div>
      <div class="status-line"><span>${esc(statusLine)}</span><span>${esc(remaining || "—")}</span></div>
      <div class="controls">
        <button class="control${led ? " on" : ""}" data-action="led" title="${esc(this._t("status_light"))}" ${online && this._entity("led") ? "" : "disabled"}><ha-icon icon="mdi:lightbulb"></ha-icon></button>
        <button class="control" data-info="current_file" title="${esc(this._t("status_file"))}" ${this._entity("current_file") ? "" : "disabled"}><ha-icon icon="mdi:file-document-outline"></ha-icon></button>
        <button class="control" data-action="${pauseKey}" title="${esc(pauseText)}" ${canPause ? "" : "disabled"}><ha-icon icon="${pauseIcon}"></ha-icon></button>
        <button class="control danger" data-action="cancel_print" title="${esc(this._t("status_cancel"))}" ${canCancel ? "" : "disabled"}><ha-icon icon="mdi:stop"></ha-icon></button>
        <button class="control" data-info="camera" title="${esc(this._t("status_camera"))}" ${this._entity("camera") ? "" : "disabled"}><ha-icon icon="mdi:camera"></ha-icon></button>
      </div>
    </div><div class="sensors">
      ${this._sensor("mdi:printer-3d-nozzle-heat-outline", this._t("status_nozzle"), this._formatted("nozzle_temperature"), "nozzle_temperature", this._formatted("nozzle_target_temperature"))}
      ${this._sensor("mdi:radiator", this._t("status_bed"), this._formatted("bed_temperature"), "bed_temperature", this._formatted("bed_target_temperature"))}
      ${this._sensor("mdi:speedometer", this._t("status_speed"), this._formatted("print_speed"), "print_speed")}
      ${this._sensor("mdi:fan", this._t("status_fan"), this._formatted("cooling_fan_speed"), "cooling_fan_speed")}
    </div></div>`;
  }

  _render() {
    if (!this._root) this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `<style>${STYLES}</style><ha-card>${this._body()}
      ${this._error ? `<div class="error-message">${esc(this._error)}</div>` : ""}</ha-card>`;
    this._root.querySelectorAll("[data-info]").forEach((element) => {
      element.addEventListener("click", () => this._moreInfo(element.dataset.info));
    });
    this._root.querySelectorAll("[data-action]").forEach((element) => {
      element.addEventListener("click", () => {
        if (element.dataset.action === "led") this._toggleLed();
        else this._press(element.dataset.action);
      });
    });
  }
}

class FlashForgePrintStatusCardEditor extends HTMLElement {
  constructor() {
    super();
    this._t = (key) => key;
    this._language = null;
  }

  setConfig(config) { this._config = { ...config }; this._render(); }
  set hass(hass) {
    this._hass = hass;
    const language = hass?.locale?.language || "en";
    if (language !== this._language) {
      this._language = language;
      translatorFor(language).then((t) => {
        if (language === this._language) { this._t = t; this._render(); }
      });
    }
    this._loadEntries();
  }

  async _loadEntries() {
    if (this._entries || !this._hass) return;
    try {
      const result = await this._hass.connection.sendMessagePromise({ type: "flashforge/entries" });
      this._entries = result.entries || [];
    } catch (err) { this._entries = []; }
    this._render();
  }

  _render() {
    if (!this._root) this._root = this.attachShadow({ mode: "open" });
    const selected = this._config?.entry_id || "";
    this._root.innerHTML = `<style>
      select { width:100%;padding:8px;border-radius:6px;border:1px solid var(--divider-color);
        background:var(--card-background-color);color:var(--primary-text-color); }
      label { display:block;margin-bottom:5px;color:var(--secondary-text-color); }
    </style><label for="entry">${esc(this._t("status_editor_printer"))}</label>
      <select id="entry"><option value="">${esc(this._t("status_editor_select"))}</option>
      ${(this._entries || []).map((entry) => `<option value="${esc(entry.entry_id)}" ${entry.entry_id === selected ? "selected" : ""}>${esc(entry.title)}</option>`).join("")}</select>`;
    this._root.getElementById("entry").addEventListener("change", (event) => {
      this._config = { ...this._config, entry_id: event.target.value || undefined, style: "simple" };
      this.dispatchEvent(new CustomEvent("config-changed", {
        detail: { config: this._config }, bubbles: true, composed: true,
      }));
    });
  }
}

const ELEMENTS = [
  ["ff-print-status-card", FlashForgePrintStatusCard],
  ["ff-print-status-card-editor", FlashForgePrintStatusCardEditor],
];

function defineOnce(name, constructor) {
  if (customElements.get(name)) return;
  try { customElements.define(name, constructor); }
  catch (err) { customElements.define(name, class extends constructor {}); }
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
  type: "ff-print-status-card",
  name: "FlashForge Print Status",
  description: "Show a FlashForge printer's print preview, progress, controls, and live sensors.",
  preview: false,
  documentationURL: "https://github.com/Woebenskie/ff-5mp-hass",
});
