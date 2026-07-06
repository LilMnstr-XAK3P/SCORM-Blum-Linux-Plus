/* Lab 14 — based on Exercise 27.1: running, pausing, resuming, and killing
   jobs from the Bash command line. */
'use strict';

defineLab({
  id: 'lab14',
  title: 'Lab 14: Manipulating Jobs (Ex 27.1)',
  intro: 'Write a looping test script, then practice job control: pause it with Ctrl+Z, run a second copy in the background with &, resume the paused one with bg, and kill them both.',

  setup(fs, shell) {
    fs.remove('/home/student/jobtest.sh');
    for (const j of shell.jobs) j.ctrl.kill();
  },

  tasks: [
    {
      text: 'Create jobtest.sh in your home directory: a script that loops ten times, echoing its PID and loop counter, sleeping 10 seconds each pass',
      hint: 'Type: nano jobtest.sh — use a counter variable, a while [ $count -le 10 ] loop, sleep 10 inside it, and $$ for the PID. (Full script on the next task\'s hint.)',
      check: (c) => {
        const f = c.fs.lookup('/home/student/jobtest.sh');
        return f && f.content && f.content.includes('while') &&
          f.content.includes('sleep 10') && f.content.includes('$count');
      },
    },
    {
      text: 'Give yourself execute permission on the script',
      hint: 'A working version:\n#!/bin/bash\n# jobtest.sh - looping test program for job control practice\necho "Job test starting, PID $$"\ncount=1\nwhile [ $count -le 10 ] ; do\n    echo "PID $$ loop iteration $count"\n    sleep 10\n    count=$[ $count + 1 ]\ndone\necho "Job test finished"\n— then run: chmod u+x jobtest.sh',
      check: (c) => {
        const f = c.fs.lookup('/home/student/jobtest.sh');
        return f && (f.mode & 0o100) !== 0;
      },
    },
    {
      text: 'Run ./jobtest.sh in the foreground, then pause it with Ctrl+Z',
      hint: 'Type: ./jobtest.sh — wait for a loop message, then press Ctrl+Z. The shell reports the job as Stopped.',
      check: (c) => c.shell.jobs.some(j => j.status === 'Stopped' && j.cmd.includes('jobtest')),
    },
    {
      text: 'Start a second copy of the script in background mode',
      hint: 'Type: ./jobtest.sh &',
      check: (c) => c.shell.jobs.filter(j => j.cmd.includes('jobtest') &&
        (j.status === 'Running' || j.status === 'Stopped')).length >= 2,
    },
    {
      text: 'List the current jobs and note each one\'s status',
      hint: 'Type: jobs — one should be Stopped, the other Running.',
      check: (c) => c.argv[0] === 'jobs',
    },
    {
      text: 'Resume the paused job in the background',
      hint: 'Type: bg 1 (use the job number that jobs showed as Stopped).',
      check: (c) => {
        const jt = c.shell.jobs.filter(j => j.cmd.includes('jobtest'));
        return jt.length >= 2 && jt.every(j => j.status === 'Running' || j.status === 'Done' || j.status === 'Killed') &&
          jt.filter(j => j.status === 'Running').length >= 2;
      },
    },
    {
      text: 'List the jobs again — both copies should now be Running',
      hint: 'Type: jobs',
      check: (c) => c.argv[0] === 'jobs',
    },
    {
      text: 'Kill both running jobs with kill -9 and their PIDs',
      hint: 'Type: kill -9 PID1 PID2 — the PIDs appear in the jobs/pgrep output (kill %1 %2 also works).',
      check: (c) => c.line.includes('kill') &&
        !c.shell.jobs.some(j => j.cmd.includes('jobtest') && !j.ctrl.killed &&
          (j.status === 'Running' || j.status === 'Stopped')),
    },
    {
      text: 'Verify that no jobs remain',
      hint: 'Type: jobs — the list should be empty.',
      check: (c) => c.argv[0] === 'jobs' &&
        !c.shell.jobs.some(j => j.cmd.includes('jobtest') && !j.ctrl.killed &&
          (j.status === 'Running' || j.status === 'Stopped')),
    },
  ],
});
