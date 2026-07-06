/* Boot: SCORM handshake, build FS + shell + terminal, print MOTD, restore progress. */
'use strict';

(function boot() {
  SCORM.init();

  const fs = new VFS();
  const container = document.getElementById('terminal');
  const term = new Terminal(container);
  const shell = new Shell(fs, term);
  term.attachShell(shell);

  // keep the window title in sync with the prompt
  const titleEl = document.getElementById('term-title');
  const updateTitle = () => {
    const p = shell.promptText();
    titleEl.textContent = `${p.user}@${p.host}: ${p.dir}`;
  };
  const origExec = shell.execLine.bind(shell);
  shell.execLine = async (line) => {
    const r = await origExec(line);
    updateTitle();
    return r;
  };

  // ---- login banner (Ubuntu MOTD style) ----
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${days[d.getDay()]} ${mons[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} UTC ${d.getFullYear()}`;

  term.writeln('Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 5.15.0-105-generic x86_64)');
  term.writeln('');
  term.writeln(' * Documentation:  https://help.ubuntu.com');
  term.writeln(' * Management:     https://landscape.canonical.com');
  term.writeln(' * Support:        https://ubuntu.com/advantage');
  term.writeln('');
  term.writeln('  System information as of ' + dateStr);
  term.writeln('');
  term.writeln('  System load:  0.08              Processes:             128');
  term.writeln('  Usage of /:   22.0% of 39.25GB  Users logged in:       1');
  term.writeln('  Memory usage: 19%               IPv4 address for enp0s3: 10.0.2.15');
  term.writeln('  Swap usage:   0%');
  term.writeln('');
  term.writeln('Last login: ' + dateStr + ' from 10.0.2.2');
  term.writeHTML('<span class="lab-banner">Type \'lab list\' to see the lab exercises, or \'help\' for available commands.</span>\n');
  term.writeln('');

  // ---- labs ----
  LabManager.init(shell, term);
  LabManager.restore(SCORM.loadProgress());

  // ---- panel toggle ----
  const panel = document.getElementById('lab-panel');
  document.getElementById('panel-toggle').addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });

  updateTitle();
  term.renderInput();
  container.querySelector('.term-screen').focus();

  // exposed for debugging / automated tests
  window.LAB_ENV = { fs, shell, term, run: (line) => shell.execLine(line) };
})();
