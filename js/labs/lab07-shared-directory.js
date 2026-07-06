/* Lab 7 — based on Exercise 15.1: a group-shared directory using the setgid bit. */
'use strict';

defineLab({
  id: 'lab07',
  title: 'Lab 7: Creating a Shared Directory (Ex 15.1)',
  intro: 'Build a directory two users can both write to: create test1 and test2, put them in a sales group, and use the setgid (GUID) bit so new files inherit the group. Instead of logging out, use su to switch users (and exit to come back).',

  setup(fs, shell) {
    // clean slate: remove test users, sales group, and /sales
    for (const u of ['test1', 'test2']) {
      delete shell.userdb[u];
      fs.remove('/home/' + u);
      for (const f of ['/etc/passwd', '/etc/shadow']) {
        const node = fs.lookup(f);
        if (node) node.content = node.content.split('\n').filter(l => !l.startsWith(u + ':')).join('\n');
      }
    }
    const group = fs.lookup('/etc/group');
    if (group) {
      group.content = group.content.split('\n')
        .filter(l => l && !l.startsWith('sales:') && !l.startsWith('test1:') && !l.startsWith('test2:'))
        .join('\n') + '\n';
    }
    fs.remove('/sales');
  },

  tasks: [
    {
      text: 'Create the test1 user account with a home directory',
      hint: 'Type: sudo useradd -m test1',
      check: (c) => {
        const passwd = c.fs.lookup('/etc/passwd');
        return passwd && passwd.content.includes('test1:') && c.fs.exists('/home/test1');
      },
    },
    {
      text: 'Give test1 a password',
      hint: 'Type: sudo passwd test1 — pick a password you can remember; you will log in as test1 shortly.',
      check: (c) => c.shell.userdb.test1 && c.shell.userdb.test1.pw,
    },
    {
      text: 'Create the test2 user account (with home directory) and give it a password too',
      hint: 'Type: sudo useradd -m test2 and then sudo passwd test2',
      check: (c) => {
        const passwd = c.fs.lookup('/etc/passwd');
        return passwd && passwd.content.includes('test2:') &&
          c.shell.userdb.test2 && c.shell.userdb.test2.pw;
      },
    },
    {
      text: 'Create a new group named sales',
      hint: 'Type: sudo groupadd sales',
      check: (c) => {
        const g = c.fs.lookup('/etc/group');
        return g && g.content.split('\n').some(l => l.startsWith('sales:'));
      },
    },
    {
      text: 'Add both test users to the sales group, then verify with grep',
      hint: 'Type: sudo usermod -G sales test1 and sudo usermod -G sales test2 — check with: cat /etc/group | grep sales',
      check: (c) => {
        const g = c.fs.lookup('/etc/group');
        const line = g && g.content.split('\n').find(l => l.startsWith('sales:'));
        return line && line.includes('test1') && line.includes('test2');
      },
    },
    {
      text: 'Create the /sales directory and assign it to the sales group',
      hint: 'Type: sudo mkdir /sales and then sudo chgrp sales /sales',
      check: (c) => {
        const n = c.fs.lookup('/sales');
        return n && n.type === 'dir' && n.group === 'sales';
      },
    },
    {
      text: 'Give the group write access to /sales and set the setgid bit',
      hint: 'Type: sudo chmod g+w /sales and then sudo chmod g+s /sales — ls -ld /sales should now show drwxrwsr-x.',
      check: (c) => {
        const n = c.fs.lookup('/sales');
        return n && (n.mode & 0o2000) !== 0 && (n.mode & 0o020) !== 0;
      },
    },
    {
      text: 'Switch to test1, cd into /sales, and create testfile.txt with a line of text',
      hint: 'Type: su test1 (use the password you set), then cd /sales, then: echo "first line from test1" > testfile.txt',
      check: (c) => {
        const f = c.fs.lookup('/sales/testfile.txt');
        return f && f.owner === 'test1' && f.group === 'sales';
      },
    },
    {
      text: 'Switch to test2 and append a line to the same file, proving group write access works',
      hint: 'Type exit (back to student), then su test2, cd /sales, and: echo "second line from test2" >> testfile.txt — view it with cat testfile.txt.',
      check: (c) => {
        const f = c.fs.lookup('/sales/testfile.txt');
        return c.user === 'test2' && f && (f.content.match(/\n/g) || []).length >= 2;
      },
    },
    {
      text: 'Return to the student account: confirm you can read testfile.txt but appending to it fails',
      hint: 'Type exit until whoami shows student, then try: echo "line from student" >> /sales/testfile.txt — it should be denied since student is not in the sales group.',
      check: (c) => c.user === 'student' && c.line.includes('>>') &&
        c.line.includes('testfile') && c.code !== 0,
    },
  ],
});
