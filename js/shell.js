/* Shell — bash-like parser/executor: quoting, $VAR expansion, globs, pipes,
   redirection (>, >>, 2>, <), chaining (;, &&, ||), aliases, history,
   background jobs (&, Ctrl+Z, jobs/bg/fg/kill), and a small script
   interpreter (variables, $(cmd), $[ arith ], for/while loops) so students
   can write and run real shell scripts. */
'use strict';

class Shell {
  constructor(fs, term) {
    this.fs = fs;
    this.term = term;
    this.user = 'student';
    this.env = {
      USER: 'student', LOGNAME: 'student', HOME: '/home/student',
      HOSTNAME: 'linuxlab', SHELL: '/bin/bash', TERM: 'xterm-256color',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      PWD: '/home/student', OLDPWD: '/home/student', LANG: 'en_US.UTF-8',
      WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland',
    };
    this.cwd = '/home/student';
    this.aliases = { ll: 'ls -alF', la: 'ls -A', l: 'ls -CF' };
    this.history = [];
    this.lastExit = 0;
    this.startTime = Date.now();
    this.onCommandExecuted = null;   // hook: labs check progress here

    // ---- users & groups ----
    this.userdb = {
      root: { pw: 'root' },
      student: { pw: 'student' },
    };
    this.userStack = [];             // su pushes; exit pops
    this.fs.groupLookup = (u) => this.groupsOf(u);

    // ---- jobs ----
    this.jobs = [];                  // {id, pid, cmd, status, ctrl, promise}
    this.jobCounter = 0;
    this.nextPid = 2000 + Math.floor(Math.random() * 500);
    this.fgCtrl = null;
    this.fgLine = '';
    this.fgDetach = null;
    this.fgPromise = null;

    // ---- output capture stack (for $(command substitution)) ----
    this.sinkStack = [];

    // ---- container session (docker exec) ----
    this.containerCtx = null;

    // ---- simulated system state (used by labs) ----
    this.sys = this.defaultSysState();
    this.ensureDeviceNodes();
  }

  defaultSysState() {
    const boot = Date.now() - 4523 * 1000;
    const ts = () => `[${((Date.now() - boot) / 1000).toFixed(6).padStart(12)}]`;
    return {
      runlevelPrev: 'N',
      runlevel: '5',
      systemLocale: 'LANG=en_US.UTF-8',
      usb: {
        present: true,
        device: 'sdb',
        model: 'Cruzer Blade',
        vendor: 'SanDisk Corp.',
        size: '7.5G',
        partitions: [{ num: 1, fs: 'vfat', size: '7.5G', label: 'USBDATA' }],
        mountedAt: '/media/student/USBDATA',
        luks: { formatted: false, opened: false, pass: null, mapper: null },
      },
      dmesgLog: [
        `${ts()} usb 1-1: new high-speed USB device number 3 using xhci_hcd`,
        `${ts()} usb 1-1: New USB device found, idVendor=0781, idProduct=5567, bcdDevice= 1.00`,
        `${ts()} usb 1-1: Product: Cruzer Blade`,
        `${ts()} usb 1-1: Manufacturer: SanDisk`,
        `${ts()} usb-storage 1-1:1.0: USB Mass Storage device detected`,
        `${ts()} scsi host2: usb-storage 1-1:1.0`,
        `${ts()} scsi 2:0:0:0: Direct-Access     SanDisk  Cruzer Blade     1.00 PQ: 0 ANSI: 6`,
        `${ts()} sd 2:0:0:0: [sdb] 15633408 512-byte logical blocks: (8.00 GB/7.45 GiB)`,
        `${ts()} sd 2:0:0:0: [sdb] Write Protect is off`,
        `${ts()}  sdb: sdb1`,
        `${ts()} sd 2:0:0:0: [sdb] Attached SCSI removable disk`,
      ],
      journal: [],
      packages: new Set(['bash', 'coreutils', 'grep', 'nano', 'vim', 'tar', 'gzip',
        'sudo', 'openssh-server', 'systemd', 'apt', 'dpkg', 'libc6', 'python3',
        'ubuntu-minimal', 'netbase', 'iproute2', 'net-tools', 'rsyslog', 'cron']),
      dockerInstalled: false,
      docker: { pulled: new Set(), containers: {} },
    };
  }

  // create/remove /dev/sdb* nodes to match USB state
  ensureDeviceNodes() {
    const dev = this.fs.lookup('/dev');
    if (!dev) return;
    for (const name of Object.keys(dev.children)) {
      if (name.startsWith('sdb')) delete dev.children[name];
    }
    const usb = this.sys.usb;
    if (usb.present) {
      this.fs.writeFile('/dev/sdb', '', { mode: 0o660, group: 'disk' });
      for (const p of usb.partitions) {
        this.fs.writeFile('/dev/sdb' + p.num, '', { mode: 0o660, group: 'disk' });
      }
    }
    if (!this.fs.exists('/dev/mapper')) this.fs.mkdir('/dev/mapper', {});
    const mapper = this.fs.lookup('/dev/mapper');
    for (const name of Object.keys(mapper.children)) delete mapper.children[name];
    if (usb.present && usb.luks.opened && usb.luks.mapper) {
      this.fs.writeFile('/dev/mapper/' + usb.luks.mapper, '', { mode: 0o660, group: 'disk' });
    }
    // auto-mounted media dir
    if (usb.present && usb.mountedAt && !this.fs.exists(usb.mountedAt)) {
      const parts = usb.mountedAt.split('/').filter(Boolean);
      let cur = '';
      for (const p of parts) {
        cur += '/' + p;
        if (!this.fs.exists(cur)) this.fs.mkdir(cur, { owner: 'student', group: 'student' });
      }
    }
  }

  /* ---------- users & groups ---------- */

  groupsOf(user) {
    const groups = [];
    let primaryGid = null;
    const passwd = this.fs.lookup('/etc/passwd');
    if (passwd && passwd.content) {
      for (const l of passwd.content.split('\n')) {
        const f = l.split(':');
        if (f[0] === user) primaryGid = f[3];
      }
    }
    const groupF = this.fs.lookup('/etc/group');
    if (groupF && groupF.content) {
      for (const l of groupF.content.split('\n')) {
        const f = l.split(':');
        if (!f[0]) continue;
        const members = (f[3] || '').trim().split(',').filter(Boolean);
        if (members.includes(user) || (primaryGid !== null && f[2] === primaryGid)) {
          if (!groups.includes(f[0])) groups.push(f[0]);
        }
      }
    }
    return groups;
  }

  homeOf(user) {
    const passwd = this.fs.lookup('/etc/passwd');
    if (passwd && passwd.content) {
      for (const l of passwd.content.split('\n')) {
        const f = l.split(':');
        if (f[0] === user && f[5]) return f[5];
      }
    }
    return user === 'root' ? '/root' : '/home/' + user;
  }

  becomeUser(user) {
    this.user = user;
    this.env.USER = user;
    this.env.LOGNAME = user;
    this.env.HOME = this.homeOf(user);
  }

  /* ---------- prompt ---------- */
  promptText() {
    if (this.containerCtx) {
      return { user: 'root', host: this.containerCtx.id.slice(0, 12), dir: this.cwd, sym: '#' };
    }
    const dir = this.cwd === this.env.HOME ? '~'
      : this.cwd.startsWith(this.env.HOME + '/') ? '~' + this.cwd.slice(this.env.HOME.length)
      : this.cwd;
    const sym = this.user === 'root' ? '#' : '$';
    return { user: this.user, host: this.env.HOSTNAME, dir, sym };
  }

  /* ---------- output sink (command substitution capture) ---------- */
  emit(s) {
    if (this.sinkStack.length) this.sinkStack[this.sinkStack.length - 1](s);
    else this.term.write(s);
  }

  /* ---------- signals / job control ---------- */

  newCtrl() {
    return {
      killed: false, paused: false, _resumers: [],
      waitResume() {
        if (!this.paused) return Promise.resolve();
        return new Promise(r => this._resumers.push(r));
      },
      resume() {
        this.paused = false;
        this._resumers.splice(0).forEach(r => r());
      },
      kill() {
        this.killed = true;
        this.resume(); // wake anything paused so it can exit
      },
    };
  }

  addJob(cmd, ctrl, status = 'Running') {
    const job = { id: ++this.jobCounter, pid: this.nextPid++, cmd, ctrl, status };
    this.jobs.push(job);
    return job;
  }

  finishJob(job, code) {
    if (job.status === 'Done' || job.status === 'Killed') return;
    const killed = job.ctrl.killed;
    job.status = killed ? 'Killed' : 'Done';
    job.exitCode = code;
    const label = killed ? 'Killed' : (code === 0 ? 'Done' : `Exit ${code}`);
    this.term.write(`[${job.id}]${this.jobMarker(job)}  ${label.padEnd(22)} ${job.cmd}\n`);
    if (this.term.renderInput) this.term.renderInput();
    setTimeout(() => { this.jobs = this.jobs.filter(j => j !== job); }, 100);
  }

  jobMarker(job) {
    const live = this.jobs.filter(j => j.status === 'Running' || j.status === 'Stopped');
    if (live.length && live[live.length - 1] === job) return '+';
    if (live.length > 1 && live[live.length - 2] === job) return '-';
    return live.includes(job) ? ' ' : '+';
  }

  findJob(spec) {
    if (!spec) {
      const stopped = this.jobs.filter(j => j.status === 'Stopped');
      if (stopped.length) return stopped[stopped.length - 1];
      const live = this.jobs.filter(j => j.status === 'Running');
      return live[live.length - 1] || null;
    }
    const s = String(spec).replace(/^%/, '');
    return this.jobs.find(j => String(j.id) === s || String(j.pid) === s) || null;
  }

  // Ctrl+Z from the terminal while a foreground command runs
  suspendForeground() {
    if (!this.fgCtrl || !this.fgDetach) return false;
    const ctrl = this.fgCtrl;
    ctrl.paused = true;
    const job = this.addJob(this.fgLine, ctrl, 'Stopped');
    if (this.fgPromise) {
      const fp = this.fgPromise;
      job.promise = fp.then(code => this.finishJob(job, code));
    }
    this.term.write(`^Z\n[${job.id}]+  Stopped                 ${job.cmd}\n`);
    const detach = this.fgDetach;
    this.fgDetach = null; this.fgCtrl = null; this.fgPromise = null;
    detach({ detached: true, job });
    return true;
  }

  // Ctrl+C from the terminal while a foreground command runs
  interruptForeground() {
    if (!this.fgCtrl) return false;
    this.term.write('^C\n');
    this.fgCtrl.kill();
    return true;
  }

  /* ---------- tokenizer ---------- */

  tokenize(line) {
    const tokens = [];
    let i = 0, cur = '', quoted = false, hasTok = false;
    const push = () => { if (hasTok) tokens.push({ value: cur, quoted }); cur = ''; quoted = false; hasTok = false; };
    while (i < line.length) {
      const c = line[i];
      if (c === "'") {
        const end = line.indexOf("'", i + 1);
        if (end === -1) throw new Error('bash: unexpected EOF while looking for matching `\'\'');
        cur += line.slice(i + 1, end); quoted = true; hasTok = true; i = end + 1;
      } else if (c === '"') {
        const end = this.findClosingDQ(line, i + 1);
        if (end === -1) throw new Error('bash: unexpected EOF while looking for matching `"\'');
        cur += this.expandVars(line.slice(i + 1, end)); quoted = true; hasTok = true; i = end + 1;
      } else if (c === '\\' && i + 1 < line.length) {
        cur += line[i + 1]; hasTok = true; i += 2;
      } else if (c === ' ' || c === '\t') {
        push(); i++;
      } else if (c === '#' && !hasTok) {
        break;
      } else {
        const two = line.slice(i, i + 2);
        if (two === '&&' || two === '||' || two === '>>' || two === '2>') {
          push(); tokens.push({ op: two }); i += 2;
        } else if (c === '|' || c === ';' || c === '>' || c === '<') {
          push(); tokens.push({ op: c }); i++;
        } else if (c === '&') {
          push(); tokens.push({ op: '&' }); i++;
        } else {
          cur += c; hasTok = true; i++;
        }
      }
    }
    push();
    return tokens;
  }

  findClosingDQ(line, from) {
    for (let i = from; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === '"') return i;
    }
    return -1;
  }

  expandVars(str) {
    return str.replace(/\$\{(\w+)\}|\$(\w+|\?|\$)/g, (m, braced, plain) => {
      const name = braced || plain;
      if (name === '?') return String(this.lastExit);
      if (name === '$') return String(this.nextPid);
      return this.env[name] !== undefined ? this.env[name] : '';
    });
  }

  expandGlob(word, quoted) {
    if (quoted || !/[*?]/.test(word)) return [word];
    const abs = word.startsWith('/');
    const base = word.includes('/') ? word.slice(0, word.lastIndexOf('/')) : '';
    const pattern = word.slice(word.lastIndexOf('/') + 1);
    const dirPath = this.fs.norm(base || '.', this.cwd, this.env.HOME);
    const dir = this.fs.lookup(dirPath);
    if (!dir || dir.type !== 'dir') return [word];
    const re = new RegExp('^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    const matches = Object.keys(dir.children)
      .filter(n => re.test(n) && (pattern.startsWith('.') || !n.startsWith('.')))
      .sort()
      .map(n => (base ? base + '/' : (abs ? '/' : '')) + n);
    return matches.length ? matches : [word];
  }

  /* ---------- main entry ---------- */

  async execLine(line, opts = {}) {
    const trimmed = line.trim();
    if (trimmed && opts.record !== false) {
      this.history.push(trimmed);
      const hist = this.fs.lookup(this.homeOf(this.user) + '/.bash_history');
      if (hist && hist.type === 'file') hist.content += trimmed + '\n';
    }
    if (!trimmed) return 0;

    // background job: trailing single '&' (not '&&')
    if (/(?:^|[^&])&\s*$/.test(trimmed)) {
      const body = trimmed.replace(/&\s*$/, '').trim();
      if (!body) { this.term.writeln("bash: syntax error near unexpected token `&'"); return 2; }
      const ctrl = this.newCtrl();
      const job = this.addJob(body, ctrl);
      this.term.write(`[${job.id}] ${job.pid}\n`);
      job.promise = this._run(body, ctrl, job.pid)
        .then(code => this.finishJob(job, code))
        .catch(() => this.finishJob(job, 1));
      if (this.onCommandExecuted && opts.record !== false) {
        try { this.onCommandExecuted(trimmed, 0); } catch (e) { /* noop */ }
      }
      return 0;
    }

    // foreground, suspendable via Ctrl+Z
    const ctrl = this.newCtrl();
    this.fgCtrl = ctrl;
    this.fgLine = trimmed;
    let detachResolve;
    const detachPromise = new Promise(r => { detachResolve = r; });
    this.fgDetach = detachResolve;

    this.fgPromise = this._run(trimmed, ctrl, this.nextPid)
      .catch((e) => { this.term.writeln('bash: error: ' + ((e && e.message) || e)); return 1; });
    const raced = await Promise.race([
      this.fgPromise.then(code => ({ done: true, code })),
      detachPromise,
    ]);

    let code;
    if (raced.detached) {
      code = 148; // suspended
    } else {
      code = raced.code;
      this.fgCtrl = null; this.fgDetach = null; this.fgPromise = null;
    }
    this.lastExit = code;

    if (this.onCommandExecuted && opts.record !== false) {
      try { this.onCommandExecuted(trimmed, code); } catch (e) { /* lab checks never kill the shell */ }
    }
    return code;
  }

  // Run a full line (chains + pipelines). No history, no job bookkeeping.
  async _run(line, ctrl, pid) {
    let tokens;
    try {
      tokens = this.tokenize(this.expandVarsOutsideQuotes(line));
    } catch (e) {
      this.term.writeln(e.message);
      return 2;
    }

    const chains = [];
    let cur = [], lastOp = ';';
    for (const t of tokens) {
      if (t.op === ';' || t.op === '&&' || t.op === '||') {
        chains.push({ tokens: cur, joiner: lastOp }); lastOp = t.op; cur = [];
      } else if (t.op === '&') {
        continue; // stray & mid-line: ignore (trailing & handled in execLine)
      } else cur.push(t);
    }
    chains.push({ tokens: cur, joiner: lastOp });

    let code = 0;
    for (const chain of chains) {
      if (ctrl && ctrl.killed) return 130;
      if (!chain.tokens.length) continue;
      if (chain.joiner === '&&' && code !== 0) continue;
      if (chain.joiner === '||' && code === 0) continue;
      code = await this.execPipeline(chain.tokens, ctrl, pid);
      this.lastExit = code;
    }
    return code;
  }

  expandVarsOutsideQuotes(line) {
    let out = '', i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === "'") {
        const end = line.indexOf("'", i + 1);
        if (end === -1) { out += line.slice(i); break; }
        out += line.slice(i, end + 1); i = end + 1;
      } else if (c === '"') {
        const end = this.findClosingDQ(line, i + 1);
        if (end === -1) { out += line.slice(i); break; }
        out += line.slice(i, end + 1); i = end + 1;
      } else {
        let j = i;
        while (j < line.length && line[j] !== "'" && line[j] !== '"') j++;
        out += this.expandVars(line.slice(i, j));
        i = j;
      }
    }
    return out;
  }

  /* ---------- pipeline ---------- */

  async execPipeline(tokens, ctrl, pid) {
    const segments = [];
    let cur = [];
    for (const t of tokens) {
      if (t.op === '|') { segments.push(cur); cur = []; }
      else cur.push(t);
    }
    segments.push(cur);

    let stdin = '';
    let code = 0;
    for (let s = 0; s < segments.length; s++) {
      if (ctrl && ctrl.killed) return 130;
      const seg = segments[s];
      const isLast = s === segments.length - 1;
      const words = [];
      let redirOut = null, redirAppend = false, redirErr = null, redirIn = null;
      for (let i = 0; i < seg.length; i++) {
        const t = seg[i];
        if (t.op === '>' || t.op === '>>' || t.op === '2>' || t.op === '<') {
          const target = seg[i + 1];
          if (!target || target.op) {
            this.term.writeln("bash: syntax error near unexpected token `newline'");
            return 2;
          }
          if (t.op === '<') redirIn = target.value;
          else if (t.op === '2>') redirErr = target.value;
          else { redirOut = target.value; redirAppend = t.op === '>>'; }
          i++;
        } else words.push(t);
      }
      if (!words.length) { this.term.writeln("bash: syntax error near unexpected token `|'"); return 2; }

      let argv = [];
      const first = words[0];
      if (!first.quoted && this.aliases[first.value]) {
        const aliasTokens = this.tokenize(this.aliases[first.value]);
        argv = aliasTokens.map(t => t.value);
        words.slice(1).forEach(w => argv.push(...this.expandGlob(w.value, w.quoted)));
      } else {
        for (const w of words) argv.push(...this.expandGlob(w.value, w.quoted));
      }

      if (redirIn) {
        const p = this.fs.norm(redirIn, this.cwd, this.env.HOME);
        const node = this.fs.lookup(p);
        if (!node) { this.term.writeln(`bash: ${redirIn}: No such file or directory`); return 1; }
        if (!this.fs.can(node, 'r', this.user)) { this.term.writeln(`bash: ${redirIn}: Permission denied`); return 1; }
        stdin = node.content || '';
      }

      let outBuf = '', errBuf = '';
      const ctx = {
        fs: this.fs, shell: this, term: this.term,
        env: this.env, user: this.user, cwd: this.cwd,
        stdin, ctrl, pid,
        out: (s2) => { outBuf += s2; },
        err: (s2) => { errBuf += s2; },
        interactive: isLast && !redirOut,
      };

      code = await this.runCommand(ctx, argv);

      if (redirErr !== null) {
        const p = this.fs.norm(redirErr, this.cwd, this.env.HOME);
        const info = this.fs.parentOf(p);
        if (info) this.fs.writeFile(p, errBuf, { owner: this.user, group: this.user });
      } else if (errBuf) {
        this.emit(errBuf);
      }

      if (redirOut !== null) {
        const p = this.fs.norm(redirOut, this.cwd, this.env.HOME);
        const info = this.fs.parentOf(p);
        if (!info) { this.term.writeln(`bash: ${redirOut}: No such file or directory`); return 1; }
        const existing = this.fs.lookup(p);
        if (existing && !this.fs.can(existing, 'w', this.user) ||
            !existing && !this.fs.can(info.parent, 'w', this.user)) {
          this.term.writeln(`bash: ${redirOut}: Permission denied`); return 1;
        }
        const prev = redirAppend && existing && existing.type === 'file' ? existing.content : '';
        this.fs.writeFile(p, prev + outBuf, { owner: this.user, group: this.user, mode: 0o664 });
        stdin = '';
      } else if (isLast) {
        this.emit(outBuf);
        stdin = '';
      } else {
        stdin = outBuf;
      }
    }
    return code;
  }

  async runCommand(ctx, argv) {
    if (!argv.length) return 0;
    const name = argv[0];

    if (/^\w+=/.test(name) && argv.length === 1) {
      const eq = name.indexOf('=');
      this.env[name.slice(0, eq)] = name.slice(eq + 1);
      return 0;
    }

    const cmd = window.Commands[name];
    if (cmd) {
      try {
        const r = await cmd.fn(ctx, argv.slice(1));
        return r || 0;
      } catch (e) {
        if (e && e.signal) return 130;
        ctx.err(`${name}: internal error: ${e.message}\n`);
        return 1;
      }
    }

    if (name.includes('/')) {
      const p = this.fs.norm(name, this.cwd, this.env.HOME);
      const node = this.fs.lookup(p);
      if (!node) { ctx.err(`bash: ${name}: No such file or directory\n`); return 127; }
      if (node.type === 'dir') { ctx.err(`bash: ${name}: Is a directory\n`); return 126; }
      if (!this.fs.can(node, 'x', this.user)) { ctx.err(`bash: ${name}: Permission denied\n`); return 126; }
      if (node.content && !node.content.startsWith('\x7fELF')) {
        return await this.runScript(node.content, ctx.ctrl, name);
      }
      ctx.err(`bash: ${name}: cannot execute binary file\n`);
      return 126;
    }

    ctx.err(`${name}: command not found\n`);
    return 127;
  }

  /* ---------- command substitution capture ---------- */

  async capture(line, ctrl) {
    let buf = '';
    this.sinkStack.push(s => { buf += s; });
    try {
      await this._run(line, ctrl, this.nextPid);
    } finally {
      this.sinkStack.pop();
    }
    return buf.replace(/\n+$/, '');
  }

  /* ================= script interpreter =================
     Supports: comments/shebang, VAR=value, $(cmd), $[ arith ], $VAR/$$,
     any command, for VAR in LIST; do ... done,
     while [ a OP b ]; do ... done, exit [n].                     */

  async runScript(content, ctrl, scriptName = 'script') {
    ctrl = ctrl || this.newCtrl();
    const pid = this.nextPid++;
    const vars = {};

    const rawLines = content.split('\n').map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    const stmts = [];
    const parse = (i, out) => {
      while (i < rawLines.length) {
        const line = rawLines[i];
        if (line === 'done' || line === 'fi') return i + 1;
        let m = line.match(/^for\s+(\w+)\s+in\s+(.*?)\s*;?\s*(do)?$/);
        if (m) {
          const body = [];
          let j = i + 1;
          if (!m[3] && rawLines[j] === 'do') j++;
          j = parse(j, body);
          out.push({ type: 'for', varName: m[1], listExpr: m[2], body });
          i = j; continue;
        }
        m = line.match(/^while\s+(\[.*?\])\s*;?\s*(do)?$/);
        if (m) {
          const body = [];
          let j = i + 1;
          if (!m[2] && rawLines[j] === 'do') j++;
          j = parse(j, body);
          out.push({ type: 'while', condExpr: m[1], body });
          i = j; continue;
        }
        out.push({ type: 'cmd', line });
        i++;
      }
      return i;
    };
    parse(0, stmts);

    const expandVarsOnly = (str) => {
      // $[ arithmetic ]
      str = str.replace(/\$\[([^\]]*)\]/g, (m, expr) => {
        const e = expr.replace(/\$(\w+)/g, (mm, n) =>
          vars[n] !== undefined ? vars[n] : (this.env[n] !== undefined ? this.env[n] : '0'));
        try {
          if (!/^[\d\s+\-*/%()]+$/.test(e)) return '0';
          // eslint-disable-next-line no-new-func
          return String(Function('"use strict"; return (' + e + ')')());
        } catch (err) { return '0'; }
      });
      // variables: script-local first, then $$, $?, then env
      return str.replace(/\$\{(\w+)\}|\$(\w+|\$|\?)/g, (m, braced, plain) => {
        const name = braced || plain;
        if (name === '$') return String(pid);
        if (name === '?') return String(this.lastExit);
        if (vars[name] !== undefined) return vars[name];
        return this.env[name] !== undefined ? this.env[name] : '';
      });
    };

    const expand = async (str) => {
      // $(command) substitution
      let out = '';
      let i = 0;
      while (i < str.length) {
        const start = str.indexOf('$(', i);
        if (start === -1) { out += str.slice(i); break; }
        out += str.slice(i, start);
        let depth = 1, j = start + 2;
        while (j < str.length && depth > 0) {
          if (str[j] === '(') depth++;
          if (str[j] === ')') depth--;
          j++;
        }
        const inner = expandVarsOnly(str.slice(start + 2, j - 1));
        out += (await this.capture(inner, ctrl)).replace(/\n/g, ' ');
        i = j;
      }
      return expandVarsOnly(out);
    };

    const evalCond = async (expr) => {
      const e = (await expand(expr)).trim();
      const m = e.match(/^\[\s*(.*?)\s+(-le|-lt|-ge|-gt|-eq|-ne|!=|=)\s+(.*?)\s*\]$/);
      if (!m) return false;
      const a = m[1], op = m[2], b = m[3];
      const na = parseFloat(a), nb = parseFloat(b);
      switch (op) {
        case '-le': return na <= nb;
        case '-lt': return na < nb;
        case '-ge': return na >= nb;
        case '-gt': return na > nb;
        case '-eq': return na === nb;
        case '-ne': return na !== nb;
        case '=': return a === b;
        case '!=': return a !== b;
      }
      return false;
    };

    let exited = false;
    let exitCode = 0;
    const execStmts = async (list) => {
      for (const st of list) {
        if (exited) return;
        if (ctrl.paused) await ctrl.waitResume();
        if (ctrl.killed) { exited = true; exitCode = 137; return; }

        if (st.type === 'cmd') {
          const am = st.line.match(/^(\w+)=(.*)$/);
          if (am) {
            const raw = am[2];
            const isAssignment = !/\s/.test(raw) || /^(["']).*\1$/.test(raw) ||
              raw.startsWith('$(') || raw.startsWith('$[');
            if (isAssignment) {
              let v = (await expand(raw)).trim();
              v = v.replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
              vars[am[1]] = v;
              continue;
            }
          }
          if (st.line === 'exit' || /^exit\s+\d+$/.test(st.line)) {
            exited = true;
            exitCode = parseInt(st.line.split(/\s+/)[1] || '0', 10) || 0;
            return;
          }
          const expanded = await expand(st.line);
          exitCode = await this._run(expanded, ctrl, pid);
        } else if (st.type === 'for') {
          const items = (await expand(st.listExpr)).split(/\s+/).filter(Boolean);
          for (const item of items) {
            if (exited || ctrl.killed) return;
            vars[st.varName] = item;
            await execStmts(st.body);
          }
        } else if (st.type === 'while') {
          let guard = 0;
          while (await evalCond(st.condExpr)) {
            if (exited || ctrl.killed) return;
            if (ctrl.paused) await ctrl.waitResume();
            await execStmts(st.body);
            if (++guard > 5000) break;
          }
        }
      }
    };

    await execStmts(stmts);
    if (ctrl.killed) return 137;
    return exitCode;
  }
}

window.Shell = Shell;
