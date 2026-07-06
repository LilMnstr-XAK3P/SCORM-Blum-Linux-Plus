/* Lab 3 — based on Exercise 8.1: identifying the display server (X11 vs Wayland). */
'use strict';

defineLab({
  id: 'lab03',
  title: 'Lab 3: Checking Your Display Server (Ex 8.1)',
  intro: 'Determine whether this desktop session runs on Wayland or X11. An empty WAYLAND_DISPLAY variable usually means X11; loginctl gives the definitive answer.',

  tasks: [
    {
      text: 'Check whether the WAYLAND_DISPLAY environment variable is set',
      hint: 'Type: echo $WAYLAND_DISPLAY — a value like wayland-0 suggests Wayland; empty output suggests X11.',
      check: (c) => c.argv[0] === 'echo' && c.line.includes('$WAYLAND_DISPLAY') && c.code === 0,
    },
    {
      text: 'List the login sessions and note your GUI session number',
      hint: 'Type: loginctl — find the session belonging to the student user (session 2 here).',
      check: (c) => c.argv[0] === 'loginctl' && c.argv.length === 1 && c.code === 0,
    },
    {
      text: 'Query the session Type property to confirm the display server',
      hint: 'Type: loginctl show-session 2 -p Type — Type=wayland or Type=x11 settles it.',
      check: (c) => c.argv[0] === 'loginctl' && c.argv[1] === 'show-session' &&
        c.line.includes('-p') && c.line.includes('Type') && c.code === 0,
    },
  ],
});
