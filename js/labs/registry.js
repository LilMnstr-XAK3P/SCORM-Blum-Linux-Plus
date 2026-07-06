/* Lab framework.
   ------------------------------------------------------------------
   Each lab is registered with defineLab({ ... }). Structure:

   defineLab({
     id: 'lab01',                        // unique, stable id (used for saved progress)
     title: 'Lab 1: Navigating the Filesystem',
     intro: 'Shown in the lab panel when the lab starts.',
     setup(fs, shell) { ... },           // optional: create files the lab needs
     tasks: [
       {
         text: 'Change into the Documents directory',      // shown to student
         hint: 'Use cd followed by the directory name.',   // optional
         // check runs after every command; return true when the task is done.
         // c = { line, argv, code, fs, shell, cwd, user, env }
         check: (c) => c.cwd === '/home/student/Documents',
       },
       ...
     ],
   });

   Checks can verify either behavior (what was typed / exit code) or state
   (what now exists in the filesystem) — state checks are more robust.
   ------------------------------------------------------------------ */
'use strict';

const LabManager = {
  labs: [],
  active: null,          // active lab object
  completedTasks: {},    // labId -> Set of task indexes
  completedLabs: new Set(),
  shell: null,
  term: null,

  defineLab(lab) {
    this.labs.push(lab);
  },

  init(shell, term) {
    this.shell = shell;
    this.term = term;
    shell.onCommandExecuted = (line, code) => this.onCommand(line, code);
    this.renderPanel();
  },

  restore(saved) {
    if (!saved) return;
    for (const [labId, idxs] of Object.entries(saved.tasks || {})) {
      this.completedTasks[labId] = new Set(idxs);
    }
    this.completedLabs = new Set(saved.labs || []);
    if (saved.activeLab) {
      const lab = this.labs.find(l => l.id === saved.activeLab);
      if (lab) this.startLab(lab, { quiet: true, skipSetup: false });
    }
    this.renderPanel();
  },

  saveState() {
    const tasks = {};
    for (const [labId, set] of Object.entries(this.completedTasks)) {
      tasks[labId] = [...set];
    }
    SCORM.saveProgress({
      tasks,
      labs: [...this.completedLabs],
      activeLab: this.active ? this.active.id : null,
    });
    this.reportScore();
  },

  // Each lab is worth POINTS_PER_LAB (10) with proportional partial credit
  // per task. SCORM score.raw is reported as a percentage of total points,
  // so a Canvas assignment worth 150 points maps 1:1 (10 pts × 15 labs).
  POINTS_PER_LAB: 10,

  pointsEarned() {
    let pts = 0;
    for (const lab of this.labs) {
      const done = this.completedTasks[lab.id] ? this.completedTasks[lab.id].size : 0;
      if (lab.tasks.length) pts += this.POINTS_PER_LAB * (done / lab.tasks.length);
    }
    return pts;
  },

  pointsTotal() {
    return this.labs.length * this.POINTS_PER_LAB;
  },

  reportScore() {
    const total = this.pointsTotal();
    if (!total) return;
    const pct = (this.pointsEarned() / total) * 100;
    SCORM.reportScore(pct, this.completedLabs.size === this.labs.length);
  },

  /* ---------- lifecycle ---------- */

  startLab(lab, opts = {}) {
    this.active = lab;
    if (!this.completedTasks[lab.id]) this.completedTasks[lab.id] = new Set();
    if (lab.setup && !opts.skipSetup) {
      try { lab.setup(this.shell.fs, this.shell); } catch (e) { console.error('lab setup failed', e); }
    }
    if (!opts.quiet) {
      this.term.writeln('');
      this.term.writeHTML(`<span class="lab-banner">═══ ${this.escape(lab.title)} ═══</span>\n`);
      if (lab.intro) this.term.writeln(lab.intro);
      this.term.writeln(`This lab has ${lab.tasks.length} tasks. Follow the checklist in the Lab panel →`);
      this.term.writeln("Type 'lab status' for progress or 'lab hint' if you get stuck.");
      this.term.writeln('');
    }
    this.renderPanel();
    this.saveState();
  },

  resetLab() {
    if (!this.active) return;
    this.completedTasks[this.active.id] = new Set();
    this.completedLabs.delete(this.active.id);
    if (this.active.setup) {
      try { this.active.setup(this.shell.fs, this.shell); } catch (e) { /* noop */ }
    }
    this.renderPanel();
    this.saveState();
  },

  onCommand(line, code) {
    if (!this.active) return;
    const lab = this.active;
    const doneSet = this.completedTasks[lab.id];
    const argv = line.trim().split(/\s+/);
    const c = {
      line: line.trim(), argv, code,
      fs: this.shell.fs, shell: this.shell,
      cwd: this.shell.cwd, user: this.shell.user, env: this.shell.env,
    };
    let changed = false;
    lab.tasks.forEach((task, i) => {
      if (doneSet.has(i)) return;
      // sequential mode: only check the first incomplete task unless task.anyOrder
      const firstIncomplete = lab.tasks.findIndex((t, j) => !doneSet.has(j));
      if (!task.anyOrder && i !== firstIncomplete) return;
      try {
        if (task.check(c)) {
          doneSet.add(i);
          changed = true;
          this.term.writeHTML(`<span class="task-done">✔ Task ${i + 1} complete: ${this.escape(task.text)}</span>\n`);
        }
      } catch (e) { /* a failing check never breaks the shell */ }
    });
    if (changed) {
      if (doneSet.size === lab.tasks.length && !this.completedLabs.has(lab.id)) {
        this.completedLabs.add(lab.id);
        this.term.writeHTML(`<span class="lab-banner">🎉 ${this.escape(lab.title)} complete! (${this.completedLabs.size}/${this.labs.length} labs done)</span>\n`);
        this.term.writeln("Type 'lab list' to choose your next lab.");
      }
      this.renderPanel();
      this.saveState();
    }
  },

  /* ---------- `lab` command ---------- */

  async labCommand(ctx, args) {
    const sub = args[0] || 'status';
    if (sub === 'list') {
      ctx.out('Available labs:\n\n');
      this.labs.forEach((lab, i) => {
        const done = this.completedLabs.has(lab.id) ? '✔' :
          (this.completedTasks[lab.id] && this.completedTasks[lab.id].size ? '…' : ' ');
        const active = this.active === lab ? ' (active)' : '';
        ctx.out(` [${done}] ${String(i + 1).padStart(2)}. ${lab.title}${active}\n`);
      });
      ctx.out("\nStart a lab with: lab start <number>\n");
      return 0;
    }
    if (sub === 'start') {
      const n = parseInt(args[1]);
      if (!n || n < 1 || n > this.labs.length) {
        ctx.err(`lab: usage: lab start <1-${this.labs.length}>\n`);
        return 1;
      }
      this.startLab(this.labs[n - 1]);
      return 0;
    }
    if (sub === 'status') {
      if (!this.active) { ctx.out("No lab is active. Type 'lab list' to see available labs.\n"); return 0; }
      const doneSet = this.completedTasks[this.active.id];
      ctx.out(`${this.active.title} — ${doneSet.size}/${this.active.tasks.length} tasks complete\n\n`);
      this.active.tasks.forEach((t, i) => {
        ctx.out(` [${doneSet.has(i) ? 'x' : ' '}] ${i + 1}. ${t.text}\n`);
      });
      return 0;
    }
    if (sub === 'hint') {
      if (!this.active) { ctx.out('No lab is active.\n'); return 0; }
      const doneSet = this.completedTasks[this.active.id];
      const idx = this.active.tasks.findIndex((t, i) => !doneSet.has(i));
      if (idx === -1) { ctx.out('All tasks complete!\n'); return 0; }
      const task = this.active.tasks[idx];
      ctx.out(`Task ${idx + 1}: ${task.text}\n`);
      ctx.out(task.hint ? `Hint: ${task.hint}\n` : 'No hint available for this task.\n');
      return 0;
    }
    if (sub === 'reset') {
      this.resetLab();
      ctx.out(this.active ? `${this.active.title} has been reset.\n` : 'No lab is active.\n');
      return 0;
    }
    ctx.err(`lab: unknown subcommand '${sub}'\nUsage: lab list | start N | status | hint | reset\n`);
    return 1;
  },

  /* ---------- side panel UI ---------- */

  escape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  renderPanel() {
    const panel = document.getElementById('lab-panel-content');
    if (!panel) return;
    const earned = this.pointsEarned();
    const total = this.pointsTotal();
    const pct = total ? Math.round((earned / total) * 100) : 0;
    const ptsLabel = Number.isInteger(earned) ? earned : earned.toFixed(1);

    let html = `
      <div class="lab-progress">
        <div class="lab-progress-label">Score: ${ptsLabel}/${total} pts · ${this.completedLabs.size}/${this.labs.length} labs complete</div>
        <div class="lab-progress-bar"><div class="lab-progress-fill" style="width:${pct}%"></div></div>
      </div>
      <label class="lab-select-label" for="lab-select">Select lab:</label>
      <select id="lab-select" class="lab-select">
        <option value="">— choose a lab —</option>`;
    this.labs.forEach((lab, i) => {
      const done = this.completedLabs.has(lab.id) ? ' ✔' : '';
      html += `<option value="${i}" ${this.active === lab ? 'selected' : ''}>${this.escape(lab.title)}${done}</option>`;
    });
    html += '</select>';

    if (this.active) {
      const doneSet = this.completedTasks[this.active.id] || new Set();
      html += `<div class="lab-active-title">${this.escape(this.active.title)}</div>`;
      if (this.active.intro) html += `<div class="lab-intro">${this.escape(this.active.intro)}</div>`;
      html += '<ol class="lab-tasks">';
      const firstIncomplete = this.active.tasks.findIndex((t, j) => !doneSet.has(j));
      this.active.tasks.forEach((t, i) => {
        const done = doneSet.has(i);
        const current = i === firstIncomplete;
        html += `<li class="${done ? 'done' : current ? 'current' : 'locked'}">
          <span class="task-check">${done ? '✔' : '○'}</span>
          <span class="task-text">${this.escape(t.text)}</span>
          ${!done && current && t.hint ? `<button class="hint-btn" data-task="${i}">hint</button><div class="hint-body" id="hint-${i}" hidden>${this.escape(t.hint)}</div>` : ''}
        </li>`;
      });
      html += '</ol>';
      html += '<button id="lab-reset-btn" class="lab-reset">Reset this lab</button>';
    } else {
      html += '<div class="lab-intro">Choose a lab above, or type <code>lab list</code> in the terminal.</div>';
    }
    panel.innerHTML = html;

    const select = document.getElementById('lab-select');
    select.addEventListener('change', () => {
      const i = parseInt(select.value);
      if (!isNaN(i)) this.startLab(this.labs[i]);
    });
    const resetBtn = document.getElementById('lab-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (window.confirm('Reset this lab? Task progress for this lab will be cleared.')) this.resetLab();
      });
    }
    panel.querySelectorAll('.hint-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = document.getElementById('hint-' + btn.dataset.task);
        if (el) el.hidden = !el.hidden;
      });
    });
  },
};

window.LabManager = LabManager;
window.defineLab = (lab) => LabManager.defineLab(lab);
