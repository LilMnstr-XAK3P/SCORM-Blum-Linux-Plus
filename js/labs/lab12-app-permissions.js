/* Lab 12 — based on Exercise 24.1: troubleshooting an application permission
   problem caused by the sticky bit on /tmp. */
'use strict';

defineLab({
  id: 'lab12',
  title: 'Lab 12: Troubleshooting App Permission Issues (Ex 24.1)',
  intro: 'Write a small cleanup script that fails because of the sticky bit on /tmp, then troubleshoot it: identify the failing action, inspect the directory permissions, and fix the script.',

  setup(fs, shell) {
    const tmp = fs.lookup('/tmp');
    if (tmp) tmp.mode = 0o1777;
    fs.remove('/tmp/fileA.txt');
    fs.remove('/home/student/application.sh');
  },

  tasks: [
    {
      text: 'Create an empty file /tmp/fileA.txt',
      hint: 'Type: touch /tmp/fileA.txt',
      check: (c) => {
        const f = c.fs.lookup('/tmp/fileA.txt');
        return f && f.type === 'file';
      },
    },
    {
      text: 'Change the ownership of /tmp/fileA.txt so root owns it',
      hint: 'Type: sudo chown root:root /tmp/fileA.txt',
      check: (c) => {
        const f = c.fs.lookup('/tmp/fileA.txt');
        return f && f.owner === 'root' && f.group === 'root';
      },
    },
    {
      text: 'Create application.sh in your home directory: a script that writes to /tmp/fileA.txt and then removes /tmp/*.* interactively',
      hint: 'Type: nano application.sh — the script needs a #!/bin/bash line, an echo redirected into /tmp/fileA.txt, and the line: rm -ir /tmp/*.* — then Ctrl+O to save, Ctrl+X to exit. (Press the hint button on the next task if you want the full script.)',
      check: (c) => {
        const f = c.fs.lookup('/home/student/application.sh');
        return f && f.content && f.content.includes('rm -ir /tmp/*.*') &&
          f.content.includes('/tmp/fileA.txt') && f.content.includes('>');
      },
    },
    {
      text: 'Make the script executable for yourself (mode 744)',
      hint: 'Full script if you need it:\n#!/bin/bash\necho "Writing /tmp/fileA.txt..."\necho "Hello World" > /tmp/fileA.txt\necho "Cleaning up..."\nrm -ir /tmp/*.*\nexit\n— then run: chmod 744 application.sh',
      check: (c) => {
        const f = c.fs.lookup('/home/student/application.sh');
        return f && (f.mode & 0o777) === 0o744;
      },
    },
    {
      text: 'Run the script and observe the failure when it tries to delete /tmp/fileA.txt (answer y to the prompts)',
      hint: 'Type: bash application.sh — note which file triggers "Operation not permitted".',
      check: (c) => c.line.includes('application.sh') &&
        c.fs.exists('/tmp/fileA.txt'), // the delete must have failed
    },
    {
      text: 'Inspect the permissions on the /tmp directory itself and find the sticky bit',
      hint: "Type: ls -ld /tmp — the trailing 't' in drwxrwxrwt is the sticky bit: only a file's owner (or the directory owner) may delete files there. Your script failed because fileA.txt now belongs to root.",
      check: (c) => c.argv[0] === 'ls' && c.line.includes('-ld') && c.line.includes('/tmp') && c.code === 0,
    },
    {
      text: 'Fix application.sh: make it remove only /tmp/fileA.txt (with rm -i) instead of /tmp/*.*',
      hint: 'Edit the rm line to: rm -i /tmp/fileA.txt — targeting only the intended file avoids tripping over other users\' files in /tmp.',
      check: (c) => {
        const f = c.fs.lookup('/home/student/application.sh');
        return f && f.content && f.content.includes('rm -i /tmp/fileA.txt') &&
          !f.content.includes('/tmp/*.*');
      },
    },
  ],
});
