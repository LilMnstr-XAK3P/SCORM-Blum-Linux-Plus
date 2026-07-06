# Linux Command Line Lab — SCORM package for Canvas

A browser-based Linux terminal emulator with 15 guided, auto-graded lab
exercises adapted from the course textbook. No server or network access is
needed — the whole "machine" (filesystem, users, permissions, devices) runs in
the student's browser, and progress/score is reported to Canvas through
SCORM 1.2.

## Grading

- **15 labs × 10 points = 150 points total.**
- Partial credit within each lab is proportional to tasks completed
  (e.g. 4 of 8 tasks = 5 points).
- SCORM 1.2 reports `score.raw` as a **percentage** (0–100). Set the Canvas
  assignment to **150 points** and the percentage maps 1:1 to points
  (e.g. SCORM 80% = 120/150).
- `lesson_status` becomes `completed` only when **all 15 labs** are finished;
  until then it stays `incomplete`. Progress is saved in `suspend_data`, so
  students can leave and resume across sessions.

## The labs

| # | Lab | Based on |
|---|-----|----------|
| 1 | Using Rescue Mode (simulated GRUB2 boot, runlevels) | Ex 5.1 |
| 2 | Determining the Network Environment | Ex 7.1 |
| 3 | Checking Your Display Server (Wayland/X11) | Ex 8.1 |
| 4 | Experimenting with Time (locale, date, time) | Ex 9.1 |
| 5 | Experimenting with Filesystems (fdisk, mkfs, mount) | Ex 11.1 |
| 6 | Working with Packages (apt install/remove) | Ex 13.1 |
| 7 | Creating a Shared Directory (users, groups, setgid) | Ex 15.1 |
| 8 | Creating a Log or Journal Entry (logger, journalctl) | Ex 17.1 |
| 9 | Creating an Encrypted Disk (LUKS via cryptsetup) | Ex 19.1 |
| 10 | Managing a Running Process (pgrep, kill) | Ex 21.1 |
| 11 | Adding a USB Storage Device (dmesg, lsusb, lsblk) | Ex 23.1 |
| 12 | Troubleshooting App Permission Issues (sticky bit) | Ex 24.1 |
| 13 | Bash Script for Password Info (cut, for, chage) | Ex 25.1 |
| 14 | Manipulating Jobs (&, Ctrl+Z, jobs, bg, kill) | Ex 27.1 |
| 15 | Working with Containers (simulated Docker + Apache) | Ex 29.1 |

Steps that need real hardware or a GUI in the book are adapted to
terminal-equivalents: the USB stick is pre-"inserted" and managed through
dmesg/lsblk/eject; the Disks-app encryption exercise uses `cryptsetup`; the
two-terminal exercises use background jobs (`&`) in the single terminal; the
browser check in the container lab uses `curl`. Rebooting into single-user
mode is fully simulated, including the GRUB2 edit screen and root password
prompt.

More practice labs can be appended after these core 15 — each new lab file
adds 10 more points to the package total automatically.

## What students get

- An authentic Ubuntu 22.04 terminal: green/blue bash prompt, MOTD login
  banner, tab completion, command history (↑/↓), Ctrl+C/L/A/E/U/K/W, pipes,
  redirection (`>`, `>>`, `2>`, `<`), globbing, `$VARIABLES`, quoting,
  aliases, `&&`/`||`/`;` chaining, **background jobs** (`&`, Ctrl+Z, `jobs`,
  `bg`, `fg`, `kill`).
- 100+ commands with authentic output and error messages; `man` pages for all.
- A **shell-script interpreter**: students write and run real scripts with
  variables, `$(command substitution)`, `$[ arithmetic ]`, `$$`, and
  `for`/`while` loops (used by labs 12–14).
- Working **nano** and **vi** editors (full-screen, correct keybindings).
- A real permission model: users/groups from `/etc/passwd` + `/etc/group`,
  setuid/setgid/sticky bits, group-write checks, sticky-bit delete protection
  on /tmp. `sudo` (student's password: `student`), `su` (root password:
  `root`), `useradd`/`passwd`/`usermod`/`chgrp`.
- Simulated subsystems for the labs: GRUB2/runlevels, USB block device
  (fdisk/mkfs/mount/umount/lsblk/eject), LUKS (cryptsetup), apt packages,
  rsyslog + systemd journal, and a Docker engine (pull/run/exec/stop/rm)
  with a working Apache container reachable via `curl localhost:8088`.

## Project layout

```
index.html              app shell — lab <script> tags are listed here
imsmanifest.xml         SCORM 1.2 manifest — list new lab files here too
css/style.css           GNOME-terminal look + lab panel styles
js/fs.js                virtual filesystem (permissions, special bits, groups)
js/shell.js             bash parser/executor + job control + script interpreter
js/commands.js          core command implementations + man pages
js/commands-sys.js      sysadmin commands (boot, disks, packages, docker, …)
js/terminal.js          terminal UI, line editor, nano/vi overlays
js/scorm.js             SCORM 1.2 API wrapper (localStorage fallback)
js/labs/registry.js     lab framework (task checking, panel UI, 10-pt scoring)
js/labs/lab01..15-*.js  one file per lab
make-package.sh         builds linux-blum-scorm.zip for Canvas
```

## Adding a practice lab

Create `js/labs/lab16-name.js`:

```js
defineLab({
  id: 'lab16',                       // stable id — used for saved progress
  title: 'Lab 16: File Permissions Practice',
  intro: 'Short description shown in the panel.',
  setup(fs, shell) {                 // optional: reset state the lab needs
    fs.writeFile('/home/student/data.txt', 'hello\n',
      { owner: 'student', group: 'student' });
  },
  tasks: [
    {
      text: 'Make data.txt readable only by its owner',
      hint: 'chmod 600 data.txt',
      check: (c) => {
        const n = c.fs.lookup('/home/student/data.txt');
        return n && (n.mode & 0o777) === 0o600;
      },
    },
  ],
});
```

Then add the file to **both** `index.html` (script tag) and
`imsmanifest.xml` (`<file href="..."/>`). The lab is automatically worth
10 points.

Check callbacks receive `c = { line, argv, code, fs, shell, cwd, user, env }`.
Prefer **state checks** (inspect `c.fs` or `c.shell.sys`) over matching the
typed command — they accept any correct solution. Tasks complete in order
unless a task sets `anyOrder: true`.

## Packaging for Canvas

```bash
./make-package.sh        # produces linux-blum-scorm.zip
```

In Canvas: **Settings → Apps** must have the SCORM app enabled (most
institutions do). Then **Assignments → +Assignment → Submission Type →
External Tool → SCORM**, or use the course **SCORM** page (left nav) and
upload the zip. Choose *"Import as graded assignment"* and set the assignment
to **150 points**.

## Testing locally

Open `index.html` via any static server (or double-click it). Without an LMS
the app runs in standalone mode and saves progress to `localStorage`, so you
can test labs exactly as students will experience them.

Debug hook: in the browser console, `LAB_ENV.run('ls -la')` executes a command
programmatically; `LAB_ENV.fs` and `LAB_ENV.shell` expose the internals.
