/* Lab 8 — based on Exercise 17.1: creating and viewing log/journal entries. */
'use strict';

defineLab({
  id: 'lab08',
  title: 'Lab 8: Creating a Log or Journal Entry (Ex 17.1)',
  intro: 'Generate your own system log event with logger, then find it in both the rsyslog file (/var/log/syslog on Ubuntu) and the systemd journal. Since this lab has one terminal, view the log before and after instead of running tail -f in a second window.',

  tasks: [
    {
      text: 'View the end of the system log file',
      hint: 'Type: sudo tail /var/log/syslog',
      check: (c) => c.line.includes('tail') && c.line.includes('/var/log/syslog') && c.code === 0,
    },
    {
      text: 'Create your own log event with the logger command',
      hint: 'Type: logger This is a test log entry',
      check: (c) => c.argv[0] === 'logger' && c.shell.sys.journal.length > 0,
    },
    {
      text: 'Look at the end of the log file again and find your new entry',
      hint: 'Type: sudo tail /var/log/syslog — your message should now be the last line.',
      check: (c) => c.line.includes('tail') && c.line.includes('/var/log/syslog') &&
        c.shell.sys.journal.length > 0 && c.code === 0,
    },
    {
      text: 'Display the journal newest-first and confirm the same event appears there',
      hint: 'Type: journalctl -r — systemd-journald and rsyslog both receive the event.',
      check: (c) => c.argv[0] === 'journalctl' && c.line.includes('-r') && c.code === 0,
    },
  ],
});
