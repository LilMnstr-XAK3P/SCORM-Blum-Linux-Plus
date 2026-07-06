/* Lab 13 — based on Exercise 25.1: writing a Bash script that reports
   password aging information for every account on the system. */
'use strict';

defineLab({
  id: 'lab13',
  title: 'Lab 13: Bash Script for Password Info (Ex 25.1)',
  intro: 'Write a script named pwinfo.sh that pulls every login name out of /etc/passwd and runs chage -l on each one, printing the password aging details for all accounts.',

  setup(fs, shell) {
    fs.remove('/home/student/pwinfo.sh');
  },

  tasks: [
    {
      text: 'Create pwinfo.sh in your home directory: extract the usernames from /etc/passwd with cut, then loop over them running sudo chage -l for each',
      hint: 'Type: nano pwinfo.sh — you need: a #!/bin/bash line; a variable set from $(cut -d : -f 1 /etc/passwd); and a for loop over that list that echoes the username and runs sudo chage -l on it. (Full script on the next task\'s hint if you get stuck.)',
      check: (c) => {
        const f = c.fs.lookup('/home/student/pwinfo.sh');
        return f && f.content && f.content.includes('cut') &&
          f.content.includes('/etc/passwd') && f.content.includes('chage') &&
          /for\s+\w+\s+in/.test(f.content);
      },
    },
    {
      text: 'Give yourself execute permission on the script',
      hint: 'A working version:\n#!/bin/bash\n# pwinfo.sh - report password aging for every account\nlist=$(cut -d : -f 1 /etc/passwd)\nfor user in $list ; do\n    echo Password aging info for $user\n    sudo chage -l $user\n    echo "----------"\ndone\n— then run: chmod u+x pwinfo.sh',
      check: (c) => {
        const f = c.fs.lookup('/home/student/pwinfo.sh');
        return f && (f.mode & 0o100) !== 0;
      },
    },
    {
      text: 'Run the script and check that chage output appears for each account (enter your sudo password if asked)',
      hint: 'Type: ./pwinfo.sh',
      check: (c) => c.line.includes('pwinfo.sh') && !c.line.startsWith('nano') &&
        !c.line.startsWith('chmod') && !c.line.startsWith('vi') && c.code === 0,
    },
  ],
});
