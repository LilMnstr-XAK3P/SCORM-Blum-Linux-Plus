/* Lab 1 — based on Exercise 5.1: booting into single-user (rescue) mode. */
'use strict';

defineLab({
  id: 'lab01',
  title: 'Lab 1: Using Rescue Mode (Ex 5.1)',
  intro: 'Boot the system into single-user mode from the GRUB2 menu to inspect it as root, then return to the normal runlevel. The reboot here is simulated but follows the real GRUB2 flow. Root password: root',

  setup(fs, shell) {
    shell.sys.runlevelPrev = 'N';
    shell.sys.runlevel = '5';
  },

  tasks: [
    {
      text: 'Check the current runlevel of the system',
      hint: "Type: runlevel — the output 'N 5' means no previous runlevel, currently 5 (graphical multi-user).",
      check: (c) => c.argv[0] === 'runlevel' && c.code === 0 && c.shell.sys.runlevel === '5',
    },
    {
      text: "Reboot, press 'e' at the GRUB menu, append the word 'single' to the linux line, and give the root password to enter single-user mode",
      hint: "Type: reboot — then answer 'e' at the GRUB prompt, type 'single' when asked what to append, and enter the root password (root).",
      check: (c) => c.shell.sys.runlevel === '1' && c.user === 'root',
    },
    {
      text: 'Confirm you are now in runlevel 1 (single-user mode)',
      hint: 'Run runlevel again — it should now report runlevel 1.',
      check: (c) => c.argv[0] === 'runlevel' && c.shell.sys.runlevel === '1',
    },
    {
      text: 'Reboot again and boot normally (just press Enter at the GRUB menu)',
      hint: 'Type: reboot — this time press Enter at the GRUB prompt to boot the default entry.',
      check: (c) => c.shell.sys.runlevel === '5' && c.user === 'student',
    },
    {
      text: 'Verify the system is back at the normal default runlevel',
      hint: 'Run runlevel one more time — it should report 5 again.',
      check: (c) => c.argv[0] === 'runlevel' && c.shell.sys.runlevel === '5' && c.user === 'student',
    },
  ],
});
