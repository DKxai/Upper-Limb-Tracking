/**
 * SessionStore - Captures complete training sessions (client-side) and persists
 * them to localStorage, independent of the backend/TimescaleDB.
 *
 * It listens to recording start/stop and accumulates the reduced per-frame data
 * (joint angles + segment orientations) needed for clinical analysis. On stop it
 * builds a SessionRecord (summary + downsampled samples) so a doctor can later
 * select one session and analyze exactly that session's data.
 */

import { eventBus } from '../utils/EventBus.js';
import { Events } from '../utils/Constants.js';
import { SessionData } from '../models/SessionData.js';

const STORAGE_KEY = 'armtrack-sessions';
const MAX_SESSIONS = 12;          // keep the most recent N sessions
const MAX_STORE_SAMPLES = 3000;   // cap samples per session (downsample if longer)

const r2 = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : 0);

export class SessionStore {
  constructor() {
    /** @type {SessionRecord[]} */
    this._sessions = this._load();
    this._capturing = false;
    this._buf = [];
    this._patientName = '';
    this._startedAt = 0;
  }

  init() {
    eventBus.on(Events.RECORDING_STARTED, (info) => this._onStart(info));
    eventBus.on(Events.RECORDING_STOPPED, () => this._onStop());
    eventBus.on(Events.PROCESSED_DATA_READY, (sample) => this._onSample(sample));
  }

  // ── Capture lifecycle ──────────────────────────────────────────

  _onStart(info) {
    this._capturing = true;
    this._buf = [];
    this._patientName = (info && info.patientName) || 'Không rõ';
    this._startedAt = Date.now();
  }

  _onSample(sample) {
    if (!this._capturing || !sample) return;
    // Store only what clinical analysis needs (joint angles + orientations)
    const o = {};
    if (sample.orientation) {
      for (const seg of Object.keys(sample.orientation)) {
        const s = sample.orientation[seg] || {};
        o[seg] = { roll: r2(s.roll), pitch: r2(s.pitch), yaw: r2(s.yaw) };
      }
    }
    const j = {};
    if (sample.jointAngles) {
      for (const k of Object.keys(sample.jointAngles)) j[k] = r2(sample.jointAngles[k]);
    }
    this._buf.push({
      frameIndex: sample.frameIndex,
      timestamp: sample.timestamp,
      jointAngles: j,
      orientation: o,
    });
  }

  _onStop() {
    if (!this._capturing) return;
    this._capturing = false;
    const samples = this._downsample(this._buf, MAX_STORE_SAMPLES);
    this._buf = [];
    if (samples.length < 8) return; // too short to be meaningful

    // Reuse SessionData to compute summary (ROM / duration / rate)
    const sd = this._toSessionData(samples);
    const record = {
      id: 's_' + this._startedAt + '_' + Math.random().toString(36).slice(2, 7),
      patientName: this._patientName,
      startedAt: this._startedAt,
      endedAt: Date.now(),
      durationSec: sd.getDuration(),
      frameCount: samples.length,
      sampleRateHz: sd.getActualSampleRate(),
      rom: sd.getROM(),
      samples,
    };

    this._sessions.unshift(record);
    if (this._sessions.length > MAX_SESSIONS) this._sessions.length = MAX_SESSIONS;
    this._persist();
    eventBus.emit(Events.SESSIONS_CHANGED);
  }

  // ── Public API ─────────────────────────────────────────────────

  /** @returns {SessionRecord[]} newest first */
  list() {
    return this._sessions.slice();
  }

  get(id) {
    return this._sessions.find(s => s.id === id) || null;
  }

  remove(id) {
    this._sessions = this._sessions.filter(s => s.id !== id);
    this._persist();
    eventBus.emit(Events.SESSIONS_CHANGED);
  }

  clear() {
    this._sessions = [];
    this._persist();
    eventBus.emit(Events.SESSIONS_CHANGED);
  }

  /** Rebuild a SessionData from a stored record for clinical analysis. */
  buildSessionData(id) {
    const record = this.get(id);
    if (!record) return null;
    return this._toSessionData(record.samples);
  }

  // ── Internals ──────────────────────────────────────────────────

  _toSessionData(samples) {
    const sd = new SessionData(samples.length + 1); // no trimming
    samples.forEach(s => sd.addSample(s));
    return sd;
  }

  _downsample(arr, cap) {
    if (arr.length <= cap) return arr.slice();
    const step = arr.length / cap;
    const out = [];
    for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._sessions));
    } catch (e) {
      // Quota exceeded → drop oldest sessions and retry; finally drop sample
      // arrays (keep summaries) so the list still works.
      while (this._sessions.length > 1) {
        this._sessions.pop();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._sessions)); return; } catch (_) {}
      }
      try {
        const lite = this._sessions.map(s => ({ ...s, samples: [] }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lite));
        this._sessions = lite;
      } catch (_) { /* give up silently */ }
    }
  }
}

export const sessionStore = new SessionStore();

/**
 * @typedef {Object} SessionRecord
 * @property {string} id
 * @property {string} patientName
 * @property {number} startedAt
 * @property {number} endedAt
 * @property {number} durationSec
 * @property {number} frameCount
 * @property {number} sampleRateHz
 * @property {Object} rom
 * @property {Array<{frameIndex:number,timestamp:number,jointAngles:Object,orientation:Object}>} samples
 */
