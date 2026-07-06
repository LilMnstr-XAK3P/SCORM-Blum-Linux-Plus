/* SCORM 1.2 API wrapper. Finds the LMS-provided API object (Canvas exposes it
   on a parent frame), with graceful no-op fallback + localStorage persistence
   for standalone testing outside an LMS. */
'use strict';

const SCORM = {
  api: null,
  connected: false,
  standalone: false,

  findAPI(win) {
    let tries = 0;
    while (win && tries < 10) {
      if (win.API) return win.API;
      if (win.parent && win.parent !== win) { win = win.parent; tries++; continue; }
      break;
    }
    try {
      if (window.opener && window.opener.API) return window.opener.API;
    } catch (e) { /* cross-origin */ }
    return null;
  },

  init() {
    this.api = this.findAPI(window);
    if (this.api) {
      const ok = this.api.LMSInitialize('');
      this.connected = ok === 'true' || ok === true;
    }
    if (!this.connected) {
      this.standalone = true;
      console.info('[SCORM] No LMS API found — running standalone; progress saved to localStorage.');
    }
    // Mark attempt started
    if (this.connected) {
      const status = this.get('cmi.core.lesson_status');
      if (status === 'not attempted' || status === '') {
        this.set('cmi.core.lesson_status', 'incomplete');
        this.commit();
      }
    }
    return this.connected;
  },

  get(key) {
    if (this.connected) return this.api.LMSGetValue(key);
    try { return localStorage.getItem('scorm:' + key) || ''; } catch (e) { return ''; }
  },

  set(key, value) {
    if (this.connected) return this.api.LMSSetValue(key, String(value));
    try { localStorage.setItem('scorm:' + key, String(value)); } catch (e) { /* ignore */ }
    return 'true';
  },

  commit() {
    if (this.connected) return this.api.LMSCommit('');
    return 'true';
  },

  finish() {
    if (this.connected) {
      this.api.LMSCommit('');
      this.api.LMSFinish('');
      this.connected = false;
    }
  },

  /* -------- convenience for the lab app -------- */

  saveProgress(data) {
    // suspend_data is limited to 4096 chars in SCORM 1.2 — keep payload lean
    const json = JSON.stringify(data);
    this.set('cmi.suspend_data', json.length <= 4096 ? json : JSON.stringify({ ...data, history: [] }));
    this.commit();
  },

  loadProgress() {
    const raw = this.get('cmi.suspend_data');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },

  // score: 0-100; complete: all labs done
  reportScore(raw, complete) {
    this.set('cmi.core.score.min', '0');
    this.set('cmi.core.score.max', '100');
    this.set('cmi.core.score.raw', String(Math.round(raw)));
    this.set('cmi.core.lesson_status', complete ? 'completed' : 'incomplete');
    this.commit();
  },
};

window.SCORM = SCORM;
window.addEventListener('beforeunload', () => SCORM.finish());
