/* Terminal UI — renders output, a bash-style line editor with blinking block
   cursor, history navigation, tab completion, Ctrl shortcuts, secret input,
   and full-screen nano/vi editor overlays. */
'use strict';

class Terminal {
  constructor(container) {
    this.container = container;
    this.outputEl = container.querySelector('.term-output');
    this.screenEl = container.querySelector('.term-screen');
    this.shell = null;

    this.buffer = '';        // current input line
    this.cursor = 0;         // cursor position in buffer
    this.histIndex = -1;     // -1 = live line
    this.histStash = '';
    this.mode = 'input';     // 'input' | 'busy' | 'secret' | 'editor'
    this.secretResolve = null;
    this.secretBuf = '';
    this.lastTabLine = null;

    this.inputLine = document.createElement('div');
    this.inputLine.className = 'term-input-line';
    this.screenEl.appendChild(this.inputLine);

    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('paste', (e) => {
      if (this.mode === 'editor') return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (text && this.mode === 'input') {
        const firstLine = text.split('\n')[0];
        this.buffer = this.buffer.slice(0, this.cursor) + firstLine + this.buffer.slice(this.cursor);
        this.cursor += firstLine.length;
        this.renderInput();
      }
      e.preventDefault();
    });
    this.screenEl.addEventListener('mouseup', () => {
      // keep focus behavior; allow text selection copy
      if (!window.getSelection().toString()) this.screenEl.focus();
    });
    setInterval(() => {
      this.container.querySelectorAll('.cursor').forEach(c => c.classList.toggle('blink-off'));
    }, 530);
  }

  attachShell(shell) {
    this.shell = shell;
    this.renderInput();
  }

  /* ---------- output ---------- */

  // supports color escape markers from ls: \x01class\x02text\x03
  write(text) {
    if (!text) return;
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < text.length) {
      const start = text.indexOf('\x01', i);
      if (start === -1) {
        frag.appendChild(document.createTextNode(text.slice(i)));
        break;
      }
      if (start > i) frag.appendChild(document.createTextNode(text.slice(i, start)));
      const mid = text.indexOf('\x02', start);
      const end = text.indexOf('\x03', mid);
      if (mid === -1 || end === -1) {
        frag.appendChild(document.createTextNode(text.slice(start)));
        break;
      }
      const span = document.createElement('span');
      span.className = 'c-' + text.slice(start + 1, mid);
      span.textContent = text.slice(mid + 1, end);
      frag.appendChild(span);
      i = end + 1;
    }
    this.outputEl.appendChild(frag);
    this.scrollToBottom();
  }

  writeln(text) { this.write(text + '\n'); }

  writeHTML(html) {
    const div = document.createElement('span');
    div.innerHTML = html;
    this.outputEl.appendChild(div);
    this.scrollToBottom();
  }

  clear() {
    this.outputEl.textContent = '';
  }

  scrollToBottom() {
    this.screenEl.scrollTop = this.screenEl.scrollHeight;
  }

  /* ---------- prompt / input rendering ---------- */

  promptHTML() {
    const p = this.shell.promptText();
    const cls = p.user === 'root' ? 'prompt-root' : 'prompt-user';
    return `<span class="${cls}">${p.user}@${p.host}</span>:<span class="prompt-dir">${this.esc(p.dir)}</span>${p.sym} `;
  }

  esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  renderInput() {
    if (this.mode === 'busy' || this.mode === 'editor') {
      this.inputLine.innerHTML = '';
      return;
    }
    let html;
    if (this.mode === 'secret') {
      html = `<span class="secret-prompt">${this.esc(this.secretPrompt || '')}</span><span class="cursor"> </span>`;
    } else {
      const b = this.buffer;
      const before = this.esc(b.slice(0, this.cursor));
      const at = b[this.cursor] !== undefined ? this.esc(b[this.cursor]) : ' ';
      const after = b[this.cursor] !== undefined ? this.esc(b.slice(this.cursor + 1)) : '';
      html = this.promptHTML() + before + `<span class="cursor">${at}</span>` + after;
    }
    this.inputLine.innerHTML = html;
    this.scrollToBottom();
  }

  /* ---------- key handling ---------- */

  async onKey(e) {
    if (this.mode === 'editor') return; // editor overlay handles its own keys
    if (e.metaKey) return;              // let browser handle Cmd+C etc.

    if (this.mode === 'secret') {
      e.preventDefault();
      if (e.key === 'Enter') {
        this.write((this.secretEcho ? this.secretBuf : '') + '\n');
        const val = this.secretBuf;
        this.secretBuf = '';
        this.mode = 'busy';
        this.renderInput();
        const r = this.secretResolve; this.secretResolve = null;
        r(val);
      } else if (e.key === 'Backspace') {
        this.secretBuf = this.secretBuf.slice(0, -1);
        this.renderSecretLine();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        this.write('\n');
        const r = this.secretResolve; this.secretResolve = null;
        this.mode = 'busy';
        r('\x03');
      } else if (e.key.length === 1 && !e.ctrlKey) {
        this.secretBuf += e.key;
        this.renderSecretLine();
      }
      return;
    }

    if (this.mode === 'busy') {
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        if (!this.shell.interruptForeground()) this.write('^C\n');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.shell.suspendForeground();
      }
      return;
    }

    // input mode
    if (e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === 'c') {
        e.preventDefault();
        this.write(this.promptTextPlain() + this.buffer + '^C\n');
        this.buffer = ''; this.cursor = 0; this.histIndex = -1;
        this.renderInput();
        return;
      }
      if (k === 'l') { e.preventDefault(); this.clear(); this.renderInput(); return; }
      if (k === 'a') { e.preventDefault(); this.cursor = 0; this.renderInput(); return; }
      if (k === 'e') { e.preventDefault(); this.cursor = this.buffer.length; this.renderInput(); return; }
      if (k === 'u') {
        e.preventDefault();
        this.buffer = this.buffer.slice(this.cursor); this.cursor = 0;
        this.renderInput(); return;
      }
      if (k === 'k') {
        e.preventDefault();
        this.buffer = this.buffer.slice(0, this.cursor);
        this.renderInput(); return;
      }
      if (k === 'w') {
        e.preventDefault();
        const before = this.buffer.slice(0, this.cursor).replace(/\S+\s*$/, '');
        this.buffer = before + this.buffer.slice(this.cursor);
        this.cursor = before.length;
        this.renderInput(); return;
      }
      if (k === 'd') { e.preventDefault(); return; }
      return; // other ctrl combos: ignore
    }

    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        const line = this.buffer;
        this.write(this.promptTextPlain() + line + '\n');
        this.buffer = ''; this.cursor = 0; this.histIndex = -1; this.lastTabLine = null;
        this.mode = 'busy';
        this.renderInput();
        try {
          await this.shell.execLine(line);
        } catch (err) {
          this.writeln('bash: unexpected error: ' + err.message);
        }
        this.mode = 'input';
        this.renderInput();
        break;
      }
      case 'Backspace':
        e.preventDefault();
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
          this.renderInput();
        }
        break;
      case 'Delete':
        e.preventDefault();
        this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
        this.renderInput();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (this.cursor > 0) { this.cursor--; this.renderInput(); }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (this.cursor < this.buffer.length) { this.cursor++; this.renderInput(); }
        break;
      case 'Home':
        e.preventDefault(); this.cursor = 0; this.renderInput(); break;
      case 'End':
        e.preventDefault(); this.cursor = this.buffer.length; this.renderInput(); break;
      case 'ArrowUp': {
        e.preventDefault();
        const h = this.shell.history;
        if (!h.length) break;
        if (this.histIndex === -1) { this.histStash = this.buffer; this.histIndex = h.length - 1; }
        else if (this.histIndex > 0) this.histIndex--;
        this.buffer = h[this.histIndex];
        this.cursor = this.buffer.length;
        this.renderInput();
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        const h = this.shell.history;
        if (this.histIndex === -1) break;
        if (this.histIndex < h.length - 1) {
          this.histIndex++;
          this.buffer = h[this.histIndex];
        } else {
          this.histIndex = -1;
          this.buffer = this.histStash;
        }
        this.cursor = this.buffer.length;
        this.renderInput();
        break;
      }
      case 'Tab':
        e.preventDefault();
        this.tabComplete();
        break;
      default:
        if (e.key.length === 1) {
          e.preventDefault();
          this.buffer = this.buffer.slice(0, this.cursor) + e.key + this.buffer.slice(this.cursor);
          this.cursor++;
          this.renderInput();
        }
    }
  }

  promptTextPlain() {
    const p = this.shell.promptText();
    return `${p.user}@${p.host}:${p.dir}${p.sym} `;
  }

  /* ---------- tab completion ---------- */

  tabComplete() {
    const upToCursor = this.buffer.slice(0, this.cursor);
    const m = upToCursor.match(/(?:^|[\s|;&<>])([^\s|;&<>]*)$/);
    if (!m) return;
    const word = m[1];
    const wordStart = this.cursor - word.length;
    const isFirstWord = upToCursor.slice(0, wordStart).trim() === '' ||
                        /[|;&]\s*$/.test(upToCursor.slice(0, wordStart));

    let candidates = [];
    let prefixDir = '';
    if (isFirstWord && !word.includes('/')) {
      candidates = Object.keys(window.Commands)
        .concat(Object.keys(this.shell.aliases))
        .filter(c => c.startsWith(word)).sort();
    } else {
      // path completion
      const slash = word.lastIndexOf('/');
      prefixDir = slash === -1 ? '' : word.slice(0, slash + 1);
      const partial = slash === -1 ? word : word.slice(slash + 1);
      const dirPath = this.shell.fs.norm(prefixDir || '.', this.shell.cwd, this.shell.env.HOME);
      const dir = this.shell.fs.lookup(dirPath);
      if (dir && dir.type === 'dir') {
        candidates = Object.keys(dir.children)
          .filter(n => n.startsWith(partial) && (partial.startsWith('.') || !n.startsWith('.')))
          .sort()
          .map(n => prefixDir + n + (dir.children[n].type === 'dir' ? '/' : ''));
      }
    }

    if (!candidates.length) return;
    if (candidates.length === 1) {
      let completion = candidates[0];
      if (!completion.endsWith('/')) completion += ' ';
      this.buffer = this.buffer.slice(0, wordStart) + completion + this.buffer.slice(this.cursor);
      this.cursor = wordStart + completion.length;
      this.renderInput();
      return;
    }
    // common prefix
    let common = candidates[0];
    for (const c of candidates) {
      while (!c.startsWith(common)) common = common.slice(0, -1);
    }
    if (common.length > word.length) {
      this.buffer = this.buffer.slice(0, wordStart) + common + this.buffer.slice(this.cursor);
      this.cursor = wordStart + common.length;
      this.renderInput();
    } else {
      // double-tab: list candidates
      if (this.lastTabLine === this.buffer) {
        this.write(this.promptTextPlain() + this.buffer + '\n');
        const names = candidates.map(c => c.replace(prefixDir, ''));
        const w = Math.max(...names.map(n => n.length)) + 2;
        const cols = Math.max(1, Math.floor(80 / w));
        for (let i = 0; i < names.length; i += cols) {
          this.write(names.slice(i, i + cols).map(n => n.padEnd(w)).join('') + '\n');
        }
      }
      this.lastTabLine = this.buffer;
    }
  }

  /* ---------- secret input (passwords) ---------- */

  readSecret(prompt) {
    return new Promise((resolve) => {
      this.mode = 'secret';
      this.secretEcho = false;
      this.secretPrompt = prompt;
      this.secretBuf = '';
      this.write(prompt);
      this.inputLine.innerHTML = '<span class="cursor"> </span>';
      this.scrollToBottom();
      this.secretResolve = resolve;
    });
  }

  // like readSecret but echoes typed characters (fdisk prompts, boot menus, rm -i)
  readLine(prompt) {
    return new Promise((resolve) => {
      this.mode = 'secret';
      this.secretEcho = true;
      this.secretPrompt = prompt;
      this.secretBuf = '';
      this.write(prompt);
      this.renderSecretLine();
      this.secretResolve = resolve;
    });
  }

  renderSecretLine() {
    if (this.mode !== 'secret' || !this.secretEcho) return;
    this.inputLine.innerHTML = this.esc(this.secretBuf) + '<span class="cursor"> </span>';
    this.scrollToBottom();
  }

  /* ---------- editor overlays (nano / vi) ---------- */

  openEditor(kind, filename, content, canWrite) {
    return new Promise((resolve) => {
      this.mode = 'editor';
      this.renderInput();
      const overlay = document.createElement('div');
      overlay.className = 'editor-overlay';
      const isNano = kind === 'nano';

      const header = document.createElement('div');
      header.className = 'editor-header';
      header.textContent = isNano
        ? `  GNU nano 6.2                    ${filename}${canWrite ? '' : '  [Read-only]'}`
        : '';

      const ta = document.createElement('textarea');
      ta.className = 'editor-textarea';
      ta.value = content;
      ta.spellcheck = false;
      if (!canWrite) ta.readOnly = true;

      const footer = document.createElement('div');
      footer.className = 'editor-footer';

      const status = document.createElement('div');
      status.className = 'editor-status';

      overlay.appendChild(header);
      overlay.appendChild(ta);
      overlay.appendChild(status);
      overlay.appendChild(footer);
      this.container.appendChild(overlay);

      const close = (saved, text) => {
        overlay.remove();
        this.mode = 'busy';
        resolve({ saved, content: text });
      };

      if (isNano) {
        footer.innerHTML =
          '<span><b>^O</b> Write Out</span><span><b>^X</b> Exit</span>' +
          '<span><b>^K</b> Cut</span><span><b>^U</b> Paste</span>' +
          '<span><b>^W</b> Where Is</span><span><b>^G</b> Help</span>';
        let saved = false;
        let savedContent = content;
        ta.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            if (!canWrite) { status.textContent = `[ Error writing ${filename}: Permission denied ]`; return; }
            saved = true;
            savedContent = ta.value;
            const lines = ta.value.split('\n').length;
            status.textContent = `[ Wrote ${lines} line${lines === 1 ? '' : 's'} ]`;
          } else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
            e.preventDefault();
            if (ta.value !== savedContent && canWrite) {
              // nano asks; keep it simple: save on exit prompt via confirm-like status
              const ok = window.confirm(`Save modified buffer to ${filename}?`);
              if (ok) { saved = true; savedContent = ta.value; }
            }
            close(saved, savedContent);
          } else if (e.ctrlKey && e.key.toLowerCase() === 'g') {
            e.preventDefault();
            status.textContent = '[ Ctrl+O saves the file, Ctrl+X exits. Other nano features are simplified. ]';
          }
        });
      } else {
        // vi emulation: modes
        let viMode = 'normal'; // normal | insert | cmdline
        let cmdBuf = '';
        ta.readOnly = true; // normal mode: no typing
        const setStatus = () => {
          if (viMode === 'insert') status.textContent = '-- INSERT --';
          else if (viMode === 'cmdline') status.textContent = ':' + cmdBuf;
          else status.textContent = `"${filename}"${canWrite ? '' : ' [readonly]'} ${content.split('\n').length}L`;
        };
        setStatus();
        footer.innerHTML = '<span>vi: press <b>i</b> to insert &nbsp;·&nbsp; <b>Esc</b> then <b>:wq</b> save &amp; quit &nbsp;·&nbsp; <b>:q!</b> quit without saving</span>';
        ta.addEventListener('keydown', (e) => {
          if (viMode === 'insert') {
            if (e.key === 'Escape') {
              e.preventDefault();
              viMode = 'normal';
              ta.readOnly = true;
              setStatus();
            }
            return;
          }
          if (viMode === 'cmdline') {
            e.preventDefault();
            if (e.key === 'Enter') {
              const cmd = cmdBuf;
              cmdBuf = '';
              viMode = 'normal';
              if (cmd === 'wq' || cmd === 'x' || cmd === 'wq!') {
                if (!canWrite) { status.textContent = `E45: 'readonly' option is set`; return; }
                close(true, ta.value);
              } else if (cmd === 'w') {
                if (!canWrite) { status.textContent = `E45: 'readonly' option is set`; return; }
                content = ta.value;
                status.textContent = `"${filename}" written`;
              } else if (cmd === 'q!') {
                close(false, content);
              } else if (cmd === 'q') {
                if (ta.value !== content) status.textContent = 'E37: No write since last change (add ! to override)';
                else close(false, content);
              } else {
                status.textContent = `E492: Not an editor command: ${cmd}`;
              }
            } else if (e.key === 'Escape') {
              cmdBuf = ''; viMode = 'normal'; setStatus();
            } else if (e.key === 'Backspace') {
              cmdBuf = cmdBuf.slice(0, -1); setStatus();
            } else if (e.key.length === 1) {
              cmdBuf += e.key; setStatus();
            }
            return;
          }
          // normal mode
          if (e.key === 'i' || e.key === 'a' || e.key === 'o' || e.key === 'A' || e.key === 'O') {
            e.preventDefault();
            viMode = 'insert';
            ta.readOnly = false;
            if (e.key === 'o') {
              const pos = ta.value.indexOf('\n', ta.selectionStart);
              const at = pos === -1 ? ta.value.length : pos;
              ta.value = ta.value.slice(0, at) + '\n' + ta.value.slice(at);
              ta.selectionStart = ta.selectionEnd = at + 1;
            }
            setStatus();
          } else if (e.key === ':') {
            e.preventDefault();
            viMode = 'cmdline';
            cmdBuf = '';
            setStatus();
          } else if (e.key === 'Escape') {
            e.preventDefault();
          } else if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
            e.preventDefault();
          }
        });
      }

      ta.focus();
    });
  }
}

window.Terminal = Terminal;
