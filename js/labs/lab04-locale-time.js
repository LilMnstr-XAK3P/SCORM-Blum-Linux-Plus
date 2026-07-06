/* Lab 4 — based on Exercise 9.1: locale settings, date, and timing commands. */
'use strict';

defineLab({
  id: 'lab04',
  title: 'Lab 4: Experimenting with Time (Ex 9.1)',
  intro: 'Inspect and change the localization settings for your session and the system, then look at the date and measure how long a command takes to run.',

  setup(fs, shell) {
    shell.env.LANG = 'en_US.UTF-8';
    shell.sys.systemLocale = 'LANG=en_US.UTF-8';
  },

  tasks: [
    {
      text: 'Display the current localization settings and note the character set',
      hint: 'Type: locale',
      check: (c) => c.argv[0] === 'locale' && c.argv.length === 1 && c.code === 0,
    },
    {
      text: 'Switch your session locale to British English by setting the LANG variable',
      hint: 'Type: export LANG=en_GB.UTF-8',
      check: (c) => c.env.LANG === 'en_GB.UTF-8',
    },
    {
      text: 'Display the localization settings again to see the change',
      hint: 'Run locale again while LANG is set to en_GB.UTF-8.',
      check: (c) => c.argv[0] === 'locale' && c.env.LANG === 'en_GB.UTF-8' && c.code === 0,
    },
    {
      text: 'Show the system-wide locale using the systemd tool',
      hint: 'Type: localectl',
      check: (c) => c.argv[0] === 'localectl' && (c.argv.length === 1 || c.argv[1] === 'status') && c.code === 0,
    },
    {
      text: 'Change the system-wide locale to British English with localectl',
      hint: 'Type: sudo localectl set-locale "LANG=en_GB.UTF-8"',
      check: (c) => c.shell.sys.systemLocale.includes('en_GB'),
    },
    {
      text: 'Restore your session locale to US English',
      hint: 'Type: export LANG=en_US.UTF-8',
      check: (c) => c.env.LANG === 'en_US.UTF-8',
    },
    {
      text: 'Display the current date and time',
      hint: 'Type: date',
      check: (c) => c.argv[0] === 'date' && c.code === 0,
    },
    {
      text: 'Measure how long the date command takes to run',
      hint: 'Type: time date — the "real" line is the wall-clock time used.',
      check: (c) => c.argv[0] === 'time' && c.argv[1] === 'date' && c.code === 0,
    },
  ],
});
