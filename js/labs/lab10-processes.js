/* Lab 10 — based on Exercise 21.1: finding and stopping a running process.
   The book uses two terminal windows; here the sleep runs in the background
   of the single terminal, which teaches the same pgrep/kill workflow. */
'use strict';

defineLab({
  id: 'lab10',
  title: 'Lab 10: Managing a Running Process (Ex 21.1)',
  intro: 'Start a long-running sleep process, find its PID with pgrep, terminate it with kill, and verify it is gone. Since this lab has one terminal, run the sleep in the background with & instead of a second window.',

  tasks: [
    {
      text: 'Start a sleep process that runs for 1000 seconds in the background',
      hint: 'Type: sleep 1000 & — the shell prints the job number and PID.',
      check: (c) => c.shell.jobs.some(j => j.status === 'Running' && j.cmd.startsWith('sleep')),
    },
    {
      text: 'Find the PID of the sleep process',
      hint: 'Type: pgrep sleep',
      check: (c) => c.argv[0] === 'pgrep' && c.argv[1] === 'sleep' && c.code === 0,
    },
    {
      text: 'Terminate the sleep process with a signal',
      hint: 'Type: sudo kill -SIGHUP pid — use the PID that pgrep reported.',
      check: (c) => c.line.includes('kill') &&
        !c.shell.jobs.some(j => j.status === 'Running' && !j.ctrl.killed && j.cmd.startsWith('sleep')),
    },
    {
      text: 'Confirm the sleep process is no longer running',
      hint: 'Type: pgrep sleep — no output (and a silent return) means nothing matched.',
      check: (c) => c.argv[0] === 'pgrep' && c.argv[1] === 'sleep' && c.code === 1,
    },
  ],
});
