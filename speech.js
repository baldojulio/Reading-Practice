// Web Speech API wrapper for M2

export class SpeechEngine {
  constructor() {
    const SR = (window.SpeechRecognition || window.webkitSpeechRecognition);
    this.supported = !!SR;
    this._SR = SR || null;
    this.rec = null;
    this.running = false;
    this.lang = 'en-GB';
    this.onPartial = null; // (text) => void
    this.onFinal = null;   // (text) => void
    this.onStatus = null;  // (status) => void
    this._autoRestart = true;
  }

  setLanguage(lang) {
    this.lang = lang || 'en-GB';
    if (this.rec) this.rec.lang = this.lang;
  }

  start() {
    if (!this.supported) {
      this._emitStatus('unsupported');
      return;
    }
    if (this.running) return;
    this.rec = new this._SR();
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.lang = this.lang;

    this.rec.onstart = () => {
      this.running = true;
      this._emitStatus('listening');
    };
    this.rec.onend = () => {
      this.running = false;
      this._emitStatus('ended');
      if (this._autoRestart) {
        // Safari/Chrome may end sessions arbitrarily; restart if requested
        try { this.rec && this.rec.start(); } catch (_) {}
      }
    };
    this.rec.onerror = (e) => {
      this._emitStatus(`error: ${e.error || 'unknown'}`);
    };
    this.rec.onresult = (event) => {
      let interim = '';
      let finals = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const txt = res[0] && res[0].transcript ? res[0].transcript : '';
        if (res.isFinal) finals.push(txt);
        else interim += txt;
      }
      if (interim && this.onPartial) this.onPartial(interim.trim());
      if (finals.length && this.onFinal) this.onFinal(finals.join(' ').trim());
    };

    try {
      this.rec.start();
      this._emitStatus('starting');
    } catch (e) {
      this._emitStatus(`error: ${e.message}`);
    }
  }

  stop() {
    this._autoRestart = false;
    try { this.rec && this.rec.stop(); } catch (_) {}
    this.running = false;
    this._emitStatus('stopped');
  }

  _emitStatus(s) {
    if (this.onStatus) this.onStatus(s);
  }
}

