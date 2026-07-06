/* Lab 6 — based on Exercise 13.1: installing and removing software packages. */
'use strict';

defineLab({
  id: 'lab06',
  title: 'Lab 6: Working with Packages (Ex 13.1)',
  intro: 'Use the apt package manager (this is a Debian-based Ubuntu system) to list installed software, install the zsh shell package, verify it, and remove it again.',

  setup(fs, shell) {
    shell.sys.packages.delete('zsh');
    fs.remove('/bin/zsh');
  },

  tasks: [
    {
      text: 'Display the packages currently installed on the system',
      hint: 'Type: sudo apt-cache pkgnames — or apt list --installed, or dpkg -l.',
      check: (c) => (c.line.includes('apt-cache') || c.line.includes('dpkg') ||
        (c.line.includes('apt') && c.line.includes('list'))) && c.code === 0,
    },
    {
      text: 'Install the zsh shell package',
      hint: 'Type: sudo apt install zsh',
      check: (c) => c.shell.sys.packages.has('zsh'),
    },
    {
      text: 'Verify that zsh now appears in the installed package list',
      hint: 'Type: sudo apt-cache pkgnames | grep zsh',
      check: (c) => c.shell.sys.packages.has('zsh') && c.line.includes('zsh') &&
        (c.line.includes('apt-cache') || c.line.includes('dpkg') || c.line.includes('list')) && c.code === 0,
    },
    {
      text: 'Remove the zsh package from the system',
      hint: 'Type: sudo apt remove zsh',
      check: (c) => !c.shell.sys.packages.has('zsh'),
    },
    {
      text: 'Confirm that zsh no longer appears in the installed package list',
      hint: 'Type: sudo apt-cache pkgnames | grep zsh — no output means it is gone.',
      check: (c) => !c.shell.sys.packages.has('zsh') && c.line.includes('zsh') &&
        (c.line.includes('apt-cache') || c.line.includes('dpkg') || c.line.includes('list')),
    },
  ],
});
