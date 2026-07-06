/* System-administration commands used by the labs: runlevels & boot,
   networking, locale/time, disks & filesystems, packages, logging,
   job control, user management, and a simulated Docker engine.
   Loaded after commands.js — re-registering a name overrides it. */
'use strict';

(function () {
  const register = (name, fn, man) => { window.Commands[name] = { fn, man: man || '' }; };
  const resolvePath = (ctx, path) => ctx.fs.norm(path, ctx.cwd, ctx.env.HOME);
  const pad2 = (n) => String(n).padStart(2, '0');
  const nowStamp = () => {
    const d = new Date();
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${mons[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };

  /* ================= runlevels & boot ================= */

  register('runlevel', async (ctx) => {
    ctx.out(`${ctx.shell.sys.runlevelPrev} ${ctx.shell.sys.runlevel}\n`);
    return 0;
  }, 'runlevel - print previous and current SysV runlevel\n\nOutput is "PREV CURRENT". N means the runlevel has not changed since boot.\nRunlevel 1 = single-user (rescue) mode, 5 = graphical multi-user.');

  async function bootSequence(ctx) {
    const term = ctx.term;
    const shell = ctx.shell;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    term.write('\nBroadcast message from root@linuxlab on pts/0:\n\nThe system will reboot now!\n');
    await wait(700);
    term.write('[  OK  ] Stopped target Graphical Interface.\n[  OK  ] Stopped target Multi-User System.\n[  OK  ] Reached target Reboot.\n');
    await wait(900);
    term.clear();

    // GRUB2 menu
    term.write(
      '                             GNU GRUB  version 2.06\n\n' +
      ' ┌────────────────────────────────────────────────────────────────────────┐\n' +
      ' │*Ubuntu                                                                 │\n' +
      ' │ Advanced options for Ubuntu                                            │\n' +
      ' │ Memory test (memtest86+.elf)                                           │\n' +
      ' │ UEFI Firmware Settings                                                 │\n' +
      ' └────────────────────────────────────────────────────────────────────────┘\n\n' +
      '      Use the ↑ and ↓ keys to select which entry is highlighted.\n' +
      '      Press enter to boot the selected OS, `e\' to edit the commands\n' +
      '      before booting or `c\' for a command-line.\n\n');
    const choice = (await term.readLine("grub> highlighted entry 'Ubuntu' — press 'e' to edit or Enter to boot: ")).trim().toLowerCase();

    let single = false;
    if (choice === 'e') {
      term.write(
        '\n ┌── GNU GRUB — edit mode ────────────────────────────────────────────────┐\n' +
        ' │ setparams \'Ubuntu\'                                                     │\n' +
        ' │   recordfail                                                           │\n' +
        ' │   load_video                                                           │\n' +
        ' │   insmod gzio                                                          │\n' +
        ' │   search --no-floppy --fs-uuid --set=root 1c9a8b7e-4f3d-4b2a-9e8f      │\n' +
        ' │   linux  /boot/vmlinuz-5.15.0-105-generic root=UUID=1c9a8b7e ro quiet  │\n' +
        ' │   initrd /boot/initrd.img-5.15.0-105-generic                           │\n' +
        ' └────────────────────────────────────────────────────────────────────────┘\n' +
        '      Minimum Emacs-like screen editing is supported.\n' +
        '      Press Ctrl-x to start, Ctrl-c for a command-line or ESC to discard.\n\n');
      const addition = (await term.readLine("edit the 'linux' line — type text to append to it, then Enter (= Ctrl+X to boot): ")).trim();
      if (/\bsingle\b|\brescue\b|^1$|\b1\b/.test(addition)) single = true;
    }

    term.write('\nBooting...\n');
    await wait(600);
    term.write('[    0.000000] Linux version 5.15.0-105-generic (buildd@lcy02-amd64-007)\n');
    term.write('[    1.204512] systemd[1]: Detected virtualization oracle.\n');
    await wait(500);

    if (single) {
      term.write('[  OK  ] Reached target Rescue Mode.\n');
      term.write('You are in rescue mode. After logging in, type "journalctl -xb" to view\n' +
                 'system logs, "systemctl reboot" to reboot, or "reboot" to boot into\n' +
                 'default mode.\n');
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        const pw = await term.readSecret('Give root password for maintenance\n(or press Control-D to continue): ');
        if (pw === shell.userdb.root.pw) ok = true;
        else term.write('Login incorrect.\n');
      }
      if (!ok) {
        term.write('Too many authentication failures — continuing normal boot.\n');
      } else {
        shell.sys.runlevelPrev = 'N';
        shell.sys.runlevel = '1';
        shell.userStack = [];
        shell.becomeUser('root');
        shell.cwd = '/root';
        shell.env.PWD = '/root';
        term.write('root@linuxlab:~# \n');
        term.writeln('(single-user mode — type reboot to return to the normal runlevel)');
        return 0;
      }
    }

    // normal boot
    term.write('[  OK  ] Reached target Graphical Interface.\n\n');
    await wait(400);
    term.write('Ubuntu 22.04.4 LTS linuxlab tty1\n\nlinuxlab login: student\nPassword: \n');
    await wait(300);
    term.write(`Last login: ${new Date().toString().slice(0, 24)} on tty1\n`);
    shell.sys.runlevelPrev = 'N';
    shell.sys.runlevel = '5';
    shell.userStack = [];
    shell.becomeUser('student');
    shell.cwd = '/home/student';
    shell.env.PWD = '/home/student';
    return 0;
  }

  register('reboot', async (ctx) => bootSequence(ctx),
    'reboot - reboot the machine\n\nIn this lab the reboot is simulated: you will see the GRUB2 menu and can\npress e to edit the kernel line (e.g. append the word single for\nsingle-user/rescue mode).');
  register('shutdown', async (ctx, args) => {
    if (args.includes('-r')) return bootSequence(ctx);
    ctx.out('Shutdown scheduled — but this is a lab, so nothing will power off.\nUse reboot to go through the (simulated) boot sequence.\n');
    return 0;
  }, 'shutdown - power off or reboot the machine\n\n  -r     reboot instead of powering off');
  register('poweroff', window.Commands['shutdown'].fn, 'poweroff - power off the machine (simulated)');

  /* ================= networking ================= */

  register('route', async (ctx) => {
    ctx.out('Kernel IP routing table\n');
    ctx.out('Destination     Gateway         Genmask         Flags Metric Ref    Use Iface\n');
    ctx.out('default         _gateway        0.0.0.0         UG    100    0        0 enp0s3\n');
    ctx.out('10.0.2.0        0.0.0.0         255.255.255.0   U     100    0        0 enp0s3\n');
    return 0;
  }, 'route - show the IP routing table\n\nThe "default" line shows your default gateway.');

  register('iwconfig', async (ctx) => {
    ctx.out('wlan0     IEEE 802.11  ESSID:"CampusNet"\n');
    ctx.out('          Mode:Managed  Frequency:5.18 GHz  Access Point: D8:47:32:A1:5B:C0\n');
    ctx.out('          Bit Rate=433.3 Mb/s   Tx-Power=22 dBm\n');
    ctx.out('          Retry short limit:7   RTS thr:off   Fragment thr:off\n');
    ctx.out('          Power Management:on\n');
    ctx.out('          Link Quality=61/70  Signal level=-49 dBm\n\n');
    ctx.out('lo        no wireless extensions.\n\nenp0s3    no wireless extensions.\n');
    return 0;
  }, 'iwconfig - show wireless network interface settings');

  register('iwlist', async (ctx, args) => {
    if (!args.includes('scan') && !args.includes('scanning')) {
      ctx.err('Usage: iwlist [interface] scanning\n');
      return 1;
    }
    ctx.out('wlan0     Scan completed :\n');
    ctx.out('          Cell 01 - Address: D8:47:32:A1:5B:C0\n');
    ctx.out('                    Channel:36\n                    Frequency:5.18 GHz (Channel 36)\n');
    ctx.out('                    Quality=61/70  Signal level=-49 dBm\n');
    ctx.out('                    Encryption key:on\n                    ESSID:"CampusNet"\n');
    ctx.out('          Cell 02 - Address: 6E:22:9F:4D:31:08\n');
    ctx.out('                    Channel:11\n                    Frequency:2.462 GHz (Channel 11)\n');
    ctx.out('                    Quality=38/70  Signal level=-72 dBm\n');
    ctx.out('                    Encryption key:on\n                    ESSID:"Library-Guest"\n');
    return 0;
  }, 'iwlist - scan for wireless access points\n\nUsage: iwlist wlan0 scan');

  register('netstat', async (ctx, args) => {
    const flags = args.join('');
    ctx.out('Active Internet connections (only servers)\n');
    ctx.out('Proto Recv-Q Send-Q Local Address           Foreign Address         State\n');
    ctx.out('tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN\n');
    ctx.out('tcp        0      0 127.0.0.53:53           0.0.0.0:*               LISTEN\n');
    const dk = Object.values(ctx.shell.sys.docker.containers).find(c => c.running && c.port);
    if (dk) ctx.out(`tcp        0      0 0.0.0.0:${dk.port.split(':')[0].padEnd(5)}           0.0.0.0:*               LISTEN\n`);
    ctx.out('tcp6       0      0 :::22                   :::*                    LISTEN\n');
    ctx.out('udp        0      0 127.0.0.53:53           0.0.0.0:*\n');
    ctx.out('Active UNIX domain sockets (only servers)\n');
    ctx.out('Proto RefCnt Flags       Type       State         I-Node   Path\n');
    ctx.out('unix  2      [ ACC ]     STREAM     LISTENING     24310    /run/systemd/private\n');
    ctx.out('unix  2      [ ACC ]     STREAM     LISTENING     24313    /run/systemd/io.system.ManagedOOM\n');
    ctx.out('unix  2      [ ACC ]     STREAM     LISTENING     20132    /run/dbus/system_bus_socket\n');
    return 0;
  }, 'netstat - print network connections and listening ports\n\n  -l     show only listening sockets');

  register('ss', async (ctx, args) => {
    ctx.out('State    Recv-Q   Send-Q     Local Address:Port       Peer Address:Port   Process\n');
    const proc = ctx.user === 'root';
    ctx.out(`LISTEN   0        128              0.0.0.0:22              0.0.0.0:*       ${proc ? 'users:(("sshd",pid=801,fd=3))' : ''}\n`);
    ctx.out(`LISTEN   0        4096       127.0.0.53%lo:53              0.0.0.0:*       ${proc ? 'users:(("systemd-resolve",pid=610,fd=14))' : ''}\n`);
    const dk = Object.values(ctx.shell.sys.docker.containers).find(c => c.running && c.port);
    if (dk) ctx.out(`LISTEN   0        4096             0.0.0.0:${dk.port.split(':')[0].padEnd(4)}            0.0.0.0:*       ${proc ? 'users:(("docker-proxy",pid=3110,fd=4))' : ''}\n`);
    ctx.out(`ESTAB    0        0              10.0.2.15:22             10.0.2.2:51522   ${proc ? 'users:(("sshd",pid=1102,fd=4))' : ''}\n`);
    return 0;
  }, 'ss - investigate sockets\n\nUsage: ss -anpt   (all, numeric, processes, tcp)\n\nProcess names are only shown when run as root.');

  /* ================= sessions / display server ================= */

  register('loginctl', async (ctx, args) => {
    if (!args.length || args[0] === 'list-sessions') {
      ctx.out('SESSION  UID USER    SEAT  TTY \n');
      ctx.out('      2 1000 student seat0 tty2\n');
      ctx.out('     c1  116 gdm     seat0 tty1\n\n');
      ctx.out('2 sessions listed.\n');
      return 0;
    }
    if (args[0] === 'show-session') {
      const sess = args[1];
      const pIdx = args.indexOf('-p');
      const prop = pIdx !== -1 ? args[pIdx + 1] : null;
      if (!sess) { ctx.err('loginctl: missing session id\n'); return 1; }
      if (sess !== '2' && sess !== 'c1') { ctx.err(`Failed to get session path: No session '${sess}' known\n`); return 1; }
      const type = sess === '2' ? 'wayland' : 'x11';
      if (prop === 'Type') { ctx.out(`Type=${type}\n`); return 0; }
      ctx.out(`Id=${sess}\nUser=1000\nName=student\nSeat=seat0\nTTY=tty2\nRemote=no\nService=gdm-password\nType=${type}\nClass=user\nActive=yes\nState=active\n`);
      return 0;
    }
    ctx.err(`Unknown command verb ${args[0]}.\n`);
    return 1;
  }, 'loginctl - control the systemd login manager\n\nUsage:\n  loginctl                               list sessions\n  loginctl show-session N -p Type       show session type (x11 or wayland)');

  /* ================= locale & time ================= */

  register('locale', async (ctx) => {
    const lang = ctx.env.LANG || 'en_US.UTF-8';
    ctx.out(`LANG=${lang}\nLANGUAGE=\n`);
    for (const k of ['LC_CTYPE', 'LC_NUMERIC', 'LC_TIME', 'LC_COLLATE', 'LC_MONETARY',
      'LC_MESSAGES', 'LC_PAPER', 'LC_NAME', 'LC_ADDRESS', 'LC_TELEPHONE', 'LC_MEASUREMENT',
      'LC_IDENTIFICATION']) {
      ctx.out(`${k}="${lang}"\n`);
    }
    ctx.out('LC_ALL=\n');
    return 0;
  }, 'locale - display current localization settings\n\nThe settings follow the LANG environment variable\n(e.g. export LANG=en_GB.UTF-8 changes the session locale).');

  register('localectl', async (ctx, args) => {
    if (!args.length || args[0] === 'status') {
      ctx.out(`System Locale: ${ctx.shell.sys.systemLocale}\n    VC Keymap: n/a\n   X11 Layout: us\n    X11 Model: pc105\n`);
      return 0;
    }
    if (args[0] === 'set-locale') {
      if (ctx.user !== 'root') {
        ctx.err('Could not set locale: Interactive authentication required.\n(use sudo localectl set-locale ...)\n');
        return 1;
      }
      const val = args.slice(1).join(' ').replace(/^["']|["']$/g, '');
      if (!val) { ctx.err('localectl: missing locale argument\n'); return 1; }
      ctx.shell.sys.systemLocale = val.includes('=') ? val : 'LANG=' + val;
      return 0;
    }
    ctx.err(`Unknown command verb ${args[0]}.\n`);
    return 1;
  }, 'localectl - control the system locale\n\nUsage:\n  localectl                          show the system locale\n  localectl set-locale "LANG=..."   set it (requires sudo)');

  register('time', async (ctx, args) => {
    if (!args.length) { ctx.out('\nreal\t0m0.000s\nuser\t0m0.000s\nsys\t0m0.000s\n'); return 0; }
    const t0 = performance.now();
    const code = await ctx.shell.runCommand({ ...ctx }, args);
    const elapsed = (performance.now() - t0) / 1000;
    const fmt = (s) => `${Math.floor(s / 60)}m${s.toFixed(3)}s`;
    ctx.out(`\nreal\t${fmt(elapsed)}\nuser\t${fmt(elapsed * 0.4)}\nsys\t${fmt(elapsed * 0.1)}\n`);
    return code;
  }, 'time - run a command and report how long it took\n\nUsage: time COMMAND [ARGS]');

  register('timedatectl', async (ctx) => {
    const d = new Date();
    const iso = d.toISOString().replace('T', ' ').slice(0, 19);
    ctx.out(`               Local time: ${d.toString().slice(0, 24)}\n`);
    ctx.out(`           Universal time: ${iso} UTC\n`);
    ctx.out(`                 RTC time: ${iso}\n`);
    ctx.out(`                Time zone: Etc/UTC (UTC, +0000)\n`);
    ctx.out('System clock synchronized: yes\n              NTP service: active\n          RTC in local TZ: no\n');
    return 0;
  }, 'timedatectl - show system time and time zone settings');

  /* ================= kernel messages / disks ================= */

  register('dmesg', async (ctx) => {
    ctx.out(ctx.shell.sys.dmesgLog.join('\n') + '\n');
    return 0;
  }, 'dmesg - print the kernel ring buffer\n\nShows device attach/detach messages, e.g. when a USB drive is plugged in.\nCombine with tail: dmesg | tail');

  register('lsusb', async (ctx) => {
    ctx.out('Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub\n');
    ctx.out('Bus 001 Device 002: ID 80ee:0021 VirtualBox USB Tablet\n');
    if (ctx.shell.sys.usb.present) {
      ctx.out('Bus 001 Device 003: ID 0781:5567 SanDisk Corp. Cruzer Blade\n');
    }
    ctx.out('Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub\n');
    return 0;
  }, 'lsusb - list USB devices');

  register('lsblk', async (ctx) => {
    const sys = ctx.shell.sys;
    ctx.out('NAME        MAJ:MIN RM  SIZE RO TYPE  MOUNTPOINTS\n');
    ctx.out('sda           8:0    0   40G  0 disk  \n');
    ctx.out('└─sda1        8:1    0   40G  0 part  /\n');
    if (sys.usb.present) {
      ctx.out(`sdb           8:16   1 ${sys.usb.size.padStart(5)}  0 disk  \n`);
      sys.usb.partitions.forEach((p, i) => {
        const last = i === sys.usb.partitions.length - 1;
        let mp = '';
        if (sys.usb.mountedAt && p.num === 1 && !sys.usb.luks.formatted) mp = sys.usb.mountedAt;
        ctx.out(`${last ? '└─' : '├─'}sdb${p.num}        8:${16 + p.num}   1 ${p.size.padStart(5)}  0 part  ${mp}\n`);
        if (sys.usb.luks.opened && sys.usb.luks.mapper) {
          ctx.out(`  └─${sys.usb.luks.mapper.padEnd(9)} 253:0    0 ${p.size.padStart(5)}  0 crypt ${sys.usb.luks.mountedAt || ''}\n`);
        }
      });
    }
    return 0;
  }, 'lsblk - list block devices, partitions, and mount points');

  register('eject', async (ctx, args) => {
    const sys = ctx.shell.sys;
    if (!sys.usb.present) { ctx.err('eject: no removable device found\n'); return 1; }
    sys.usb.mountedAt = null;
    sys.usb.present = false;
    const t = `[${((Date.now() - ctx.shell.startTime) / 1000 + 4523).toFixed(6).padStart(12)}]`;
    sys.dmesgLog.push(`${t} usb 1-1: USB disconnect, device number 3`);
    ctx.shell.ensureDeviceNodes();
    const media = ctx.fs.lookup('/media/student');
    if (media) for (const n of Object.keys(media.children)) delete media.children[n];
    ctx.out('The USB storage device has been safely removed.\n');
    ctx.out("(To plug it back in for another lab, use the lab panel's Reset button or run: lab reset)\n");
    return 0;
  }, 'eject - safely remove a removable storage device\n\nUsage: eject /dev/sdb');

  register('umount', async (ctx, args) => {
    if (ctx.user !== 'root') { ctx.err(`umount: ${args[0] || ''}: must be superuser to unmount.\n`); return 32; }
    const sys = ctx.shell.sys;
    const target = args.filter(a => !a.startsWith('-'))[0];
    if (!target) { ctx.err('umount: bad usage\nTry \'umount --help\' for more information.\n'); return 1; }
    const p = resolvePath(ctx, target);
    // LUKS mapper mount?
    if (sys.usb.luks.mountedAt && (target.includes('mapper') || p === sys.usb.luks.mountedAt)) {
      const dir = ctx.fs.lookup(sys.usb.luks.mountedAt);
      if (dir) delete dir.children['lost+found'];
      sys.usb.luks.mountedAt = null;
      return 0;
    }
    if (target.startsWith('/dev/sdb') || (sys.usb.mountedAt && p === sys.usb.mountedAt) ||
        (sys.usb.userMountedAt && p === sys.usb.userMountedAt)) {
      if (!sys.usb.present) { ctx.err(`umount: ${target}: no mount point specified.\n`); return 1; }
      if (!sys.usb.mountedAt && !sys.usb.userMountedAt) { ctx.err(`umount: ${target}: not mounted.\n`); return 32; }
      if (sys.usb.mountedAt) {
        const info = ctx.fs.parentOf(sys.usb.mountedAt);
        if (info) delete info.parent.children[info.name];
        sys.usb.mountedAt = null;
      }
      if (sys.usb.userMountedAt) {
        const dir = ctx.fs.lookup(sys.usb.userMountedAt);
        if (dir) delete dir.children['lost+found'];
        sys.usb.userMountedAt = null;
      }
      return 0;
    }
    ctx.err(`umount: ${target}: not mounted.\n`);
    return 32;
  }, 'umount - unmount filesystems\n\nUsage: sudo umount /dev/sdb1\n       sudo umount /path/to/mountpoint');

  register('mount', async (ctx, args) => {
    const sys = ctx.shell.sys;
    if (!args.length) {
      ctx.out('sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)\n');
      ctx.out('proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\n');
      ctx.out('/dev/sda1 on / type ext4 (rw,relatime,errors=remount-ro)\n');
      ctx.out('tmpfs on /run type tmpfs (rw,nosuid,nodev,size=403028k,mode=755)\n');
      if (sys.usb.present && sys.usb.mountedAt) {
        ctx.out(`/dev/sdb1 on ${sys.usb.mountedAt} type vfat (rw,nosuid,nodev,relatime,uid=1000,gid=1000)\n`);
      }
      if (sys.usb.present && sys.usb.userMountedAt) {
        ctx.out(`/dev/sdb1 on ${sys.usb.userMountedAt} type ${sys.usb.partitions[0].fs} (rw,relatime)\n`);
      }
      if (sys.usb.luks.mountedAt) {
        ctx.out(`/dev/mapper/${sys.usb.luks.mapper} on ${sys.usb.luks.mountedAt} type ext4 (rw,relatime)\n`);
      }
      return 0;
    }
    if (ctx.user !== 'root') { ctx.err('mount: only root can do that (use sudo)\n'); return 1; }
    const rest = [];
    let fsType = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-t') fsType = args[++i];
      else if (!args[i].startsWith('-')) rest.push(args[i]);
    }
    const [dev, mp] = rest;
    if (!dev || !mp) { ctx.err('mount: bad usage\nTry \'mount --help\' for more information.\n'); return 1; }
    const mpAbs = resolvePath(ctx, mp);
    const mpNode = ctx.fs.lookup(mpAbs);
    if (!mpNode || mpNode.type !== 'dir') { ctx.err(`mount: ${mp}: mount point does not exist.\n`); return 32; }

    if (dev.startsWith('/dev/mapper/')) {
      const name = dev.slice('/dev/mapper/'.length);
      if (!sys.usb.luks.opened || sys.usb.luks.mapper !== name) {
        ctx.err(`mount: ${mp}: special device ${dev} does not exist.\n`); return 32;
      }
      if (!sys.usb.luks.innerFs) {
        ctx.err(`mount: ${mp}: wrong fs type, bad option, bad superblock on ${dev}, missing codepage or helper program, or other error.\n`);
        return 32;
      }
      sys.usb.luks.mountedAt = mpAbs;
      ctx.fs.mkdir(mpAbs + '/lost+found', { owner: 'root', group: 'root', mode: 0o700 });
      return 0;
    }
    if (!dev.startsWith('/dev/sdb')) { ctx.err(`mount: ${mp}: special device ${dev} does not exist.\n`); return 32; }
    if (!sys.usb.present) { ctx.err(`mount: ${mp}: special device ${dev} does not exist.\n`); return 32; }
    const part = sys.usb.partitions.find(p => '/dev/sdb' + p.num === dev);
    if (!part) { ctx.err(`mount: ${mp}: special device ${dev} does not exist.\n`); return 32; }
    if (fsType && part.fs !== fsType && part.fs !== 'crypto_LUKS') {
      ctx.err(`mount: ${mp}: wrong fs type, bad option, bad superblock on ${dev}, missing codepage or helper program, or other error.\n`);
      return 32;
    }
    if (part.fs === 'crypto_LUKS') {
      ctx.err(`mount: ${mp}: unknown filesystem type 'crypto_LUKS'.\n(hint: open it first with cryptsetup luksOpen)\n`);
      return 32;
    }
    sys.usb.userMountedAt = mpAbs;
    if (part.fs === 'ext4') {
      ctx.fs.mkdir(mpAbs + '/lost+found', { owner: 'root', group: 'root', mode: 0o700 });
    }
    return 0;
  }, 'mount - mount a filesystem\n\nUsage: sudo mount -t ext4 /dev/sdb1 MOUNTPOINT\n       mount            (no args: list mounted filesystems)');

  register('mkfs', async (ctx, args) => {
    if (ctx.user !== 'root') { ctx.err('mkfs.ext4: Permission denied while trying to determine filesystem size (use sudo)\n'); return 1; }
    const sys = ctx.shell.sys;
    let type = 'ext2';
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-t') type = args[++i];
      else if (!args[i].startsWith('-')) rest.push(args[i]);
    }
    const dev = rest[0];
    if (!dev) { ctx.err('Usage: mkfs [options] [-t <type>] <device>\n'); return 1; }
    ctx.out(`mke2fs 1.46.5 (30-Dec-2021)\n`);

    if (dev.startsWith('/dev/mapper/')) {
      const name = dev.slice('/dev/mapper/'.length);
      if (!sys.usb.luks.opened || sys.usb.luks.mapper !== name) {
        ctx.err(`mkfs.${type}: No such file or directory while trying to determine filesystem size\n`); return 1;
      }
      sys.usb.luks.innerFs = type;
    } else {
      const part = sys.usb.present && sys.usb.partitions.find(p => '/dev/sdb' + p.num === dev);
      if (!part) { ctx.err(`mkfs.${type}: No such file or directory while trying to determine filesystem size\n`); return 1; }
      if (sys.usb.mountedAt || sys.usb.userMountedAt) {
        ctx.err(`mkfs.${type}: ${dev} contains a mounted filesystem; will not make a filesystem here!\n`); return 1;
      }
      part.fs = type;
      part.label = '';
    }
    ctx.out('Creating filesystem with 1953024 4k blocks and 488640 inodes\n');
    ctx.out('Filesystem UUID: 7c3d92f1-88a4-4d29-b6ff-2e01c5a9d3f4\n');
    ctx.out('Superblock backups stored on blocks: \n\t32768, 98304, 163840, 229376, 294912, 819200, 884736, 1605632\n\n');
    ctx.out('Allocating group tables: done                            \n');
    ctx.out('Writing inode tables: done                            \n');
    ctx.out('Creating journal (16384 blocks): done\n');
    ctx.out('Writing superblocks and filesystem accounting information: done \n');
    return 0;
  }, 'mkfs - build a Linux filesystem on a device\n\nUsage: sudo mkfs -t ext4 /dev/sdb1');
  register('mkfs.ext4', async (ctx, args) => window.Commands['mkfs'].fn(ctx, ['-t', 'ext4', ...args]),
    'mkfs.ext4 - create an ext4 filesystem');

  register('fdisk', async (ctx, args) => {
    const sys = ctx.shell.sys;
    const { term } = ctx;
    const rest = args.filter(a => !a.startsWith('-'));
    if (args.includes('-l')) {
      ctx.out('Disk /dev/sda: 40 GiB, 42949672960 bytes, 83886080 sectors\n');
      if (sys.usb.present) ctx.out('Disk /dev/sdb: 7.45 GiB, 8004304896 bytes, 15633408 sectors\n');
      return 0;
    }
    if (ctx.user !== 'root') {
      ctx.err(`fdisk: cannot open ${rest[0] || '/dev/sdb'}: Permission denied\n`);
      return 1;
    }
    const dev = rest[0];
    if (!dev || !dev.startsWith('/dev/sdb') || !sys.usb.present) {
      ctx.err(`fdisk: cannot open ${dev || ''}: No such file or directory\n`);
      return 1;
    }
    if (dev !== '/dev/sdb') {
      ctx.err(`fdisk: cannot open ${dev}: use the whole disk (/dev/sdb), not a partition\n`);
      return 1;
    }
    if (sys.usb.mountedAt || sys.usb.userMountedAt) {
      ctx.out('Welcome to fdisk (util-linux 2.37.2).\n');
      ctx.out(`The device ${dev} is currently in use — unmount it first (sudo umount /dev/sdb1).\n`);
      return 1;
    }

    // interactive from here on: write straight to the terminal so prompts order correctly
    term.write('\nWelcome to fdisk (util-linux 2.37.2).\nChanges will remain in memory only, until you decide to write them.\nBe careful before using the write command.\n\n');

    // work on a copy until 'w'
    let parts = sys.usb.partitions.map(p => ({ ...p }));
    const printTable = () => {
      let s = `Disk /dev/sdb: 7.45 GiB, 8004304896 bytes, 15633408 sectors\n` +
        `Disk model: Cruzer Blade    \nUnits: sectors of 1 * 512 = 512 bytes\n` +
        `Sector size (logical/physical): 512 bytes / 512 bytes\nDisklabel type: dos\n` +
        `Disk identifier: 0x6f20736b\n`;
      if (parts.length) {
        s += `\nDevice     Boot Start      End  Sectors  Size Id Type\n`;
        for (const p of parts) {
          const type = p.fs === 'vfat' ? ' c W95 FAT32 (LBA)' : '83 Linux';
          s += `/dev/sdb${p.num}        2048 15633407 15631360  7.5G ${type}\n`;
        }
      }
      return s;
    };

    for (;;) {
      const cmd = (await term.readLine('Command (m for help): ')).trim().toLowerCase();
      if (cmd === 'm') {
        term.write('\nHelp:\n  p   print the partition table\n  d   delete a partition\n  n   add a new partition\n  w   write table to disk and exit\n  q   quit without saving changes\n\n');
      } else if (cmd === 'p') {
        term.write(printTable() + '\n');
      } else if (cmd === 'd') {
        if (!parts.length) { term.write('No partition is defined yet!\n'); continue; }
        parts = [];
        term.write('Partition 1 has been deleted.\n');
      } else if (cmd === 'n') {
        const ptype = (await term.readLine('Partition type\n   p   primary (0 primary, 0 extended, 4 free)\n   e   extended (container for logical partitions)\nSelect (default p): ')).trim() || 'p';
        if (ptype !== 'p') { term.write('Only primary partitions are supported in this lab.\n'); continue; }
        await term.readLine('Partition number (1-4, default 1): ');
        await term.readLine('First sector (2048-15633407, default 2048): ');
        await term.readLine('Last sector, +/-sectors or +/-size{K,M,G,T,P} (2048-15633407, default 15633407): ');
        term.write('\nCreated a new partition 1 of type \'Linux\' and of size 7.5 GiB.\n');
        const hadVfat = sys.usb.partitions.some(p => p.fs === 'vfat');
        if (hadVfat) {
          const ans = (await term.readLine('Partition #1 contains a vfat signature.\nDo you want to remove the signature? [Y]es/[N]o: ')).trim().toLowerCase();
          if (ans.startsWith('y')) term.write('The signature will be removed by a write command.\n');
        }
        parts = [{ num: 1, fs: 'raw', size: '7.5G', label: '' }];
      } else if (cmd === 'w') {
        sys.usb.partitions = parts;
        sys.usb.repartitioned = true;
        ctx.shell.ensureDeviceNodes();
        term.write('The partition table has been altered.\nCalling ioctl() to re-read partition table.\nSyncing disks.\n');
        return 0;
      } else if (cmd === 'q') {
        term.write('\n');
        return 0;
      } else if (cmd) {
        term.write(`${cmd}: unknown command\n`);
      }
    }
  }, 'fdisk - manipulate disk partition table\n\nUsage: sudo fdisk /dev/sdb\n\nInside fdisk: p print, d delete, n new, w write & exit, q quit');

  register('cryptsetup', async (ctx, args) => {
    if (ctx.user !== 'root') { ctx.err('Only root can use cryptsetup (use sudo).\n'); return 1; }
    const sys = ctx.shell.sys;
    const sub = args[0];
    const luks = sys.usb.luks;
    if (sub === 'luksFormat') {
      const dev = args[1];
      const part = sys.usb.present && sys.usb.partitions.find(p => '/dev/sdb' + p.num === dev);
      if (!part) { ctx.err(`Device ${dev || ''} does not exist or access denied.\n`); return 1; }
      if (sys.usb.mountedAt || sys.usb.userMountedAt) { ctx.err(`Cannot format ${dev} which is still in use (unmount it first).\n`); return 1; }
      ctx.shell.emit(`\nWARNING!\n========\nThis will overwrite data on ${dev} irrevocably.\n\n`);
      const confirm = await ctx.term.readLine('Are you sure? (Type \'yes\' in capital letters): ');
      if (confirm.trim() !== 'YES') { ctx.err('Operation aborted.\n'); return 1; }
      const p1 = await ctx.term.readSecret(`Enter passphrase for ${dev}: `);
      const p2 = await ctx.term.readSecret('Verify passphrase: ');
      if (p1 !== p2) { ctx.err('Passphrases do not match.\n'); return 1; }
      if (!p1) { ctx.err('Passphrase must not be empty.\n'); return 1; }
      luks.formatted = true;
      luks.pass = p1;
      luks.opened = false;
      luks.innerFs = null;
      part.fs = 'crypto_LUKS';
      return 0;
    }
    if (sub === 'luksOpen' || sub === 'open') {
      const dev = args[1], name = args[2];
      if (!name) { ctx.err('Usage: cryptsetup luksOpen <device> <name>\n'); return 1; }
      const part = sys.usb.present && sys.usb.partitions.find(p => '/dev/sdb' + p.num === dev);
      if (!part || !luks.formatted) { ctx.err(`Device ${dev || ''} is not a valid LUKS device.\n`); return 1; }
      const pw = await ctx.term.readSecret(`Enter passphrase for ${dev}: `);
      if (pw !== luks.pass) { ctx.err('No key available with this passphrase.\n'); return 2; }
      luks.opened = true;
      luks.mapper = name;
      ctx.shell.ensureDeviceNodes();
      return 0;
    }
    if (sub === 'luksClose' || sub === 'close') {
      const name = args[1];
      if (!luks.opened || luks.mapper !== name) { ctx.err(`Device ${name || ''} is not active.\n`); return 1; }
      if (luks.mountedAt) { ctx.err(`Device ${name} is still in use (unmount it first).\n`); return 5; }
      luks.opened = false;
      luks.mapper = null;
      ctx.shell.ensureDeviceNodes();
      return 0;
    }
    if (sub === 'status') {
      if (luks.opened) {
        ctx.out(`/dev/mapper/${luks.mapper} is active${luks.mountedAt ? ' and is in use' : ''}.\n  type:    LUKS2\n  cipher:  aes-xts-plain64\n  keysize: 512 bits\n  device:  /dev/sdb1\n`);
      } else ctx.out('Device is not active.\n');
      return 0;
    }
    ctx.err('Usage: cryptsetup luksFormat|luksOpen|luksClose|status ...\n');
    return 1;
  }, 'cryptsetup - manage LUKS encrypted volumes\n\nUsage:\n  sudo cryptsetup luksFormat /dev/sdb1          encrypt a partition\n  sudo cryptsetup luksOpen /dev/sdb1 secure     unlock -> /dev/mapper/secure\n  sudo cryptsetup luksClose secure              lock again');

  /* ================= logging ================= */

  register('logger', async (ctx, args) => {
    const msg = args.join(' ');
    if (!msg) return 0;
    const line = `${nowStamp()} linuxlab ${ctx.user}: ${msg}`;
    const syslog = ctx.fs.lookup('/var/log/syslog');
    if (syslog) syslog.content += line + '\n';
    ctx.shell.sys.journal.push({ ts: Date.now(), line });
    return 0;
  }, 'logger - make an entry in the system log\n\nUsage: logger MESSAGE...\n\nThe entry appears in /var/log/syslog and in journalctl.');

  register('journalctl', async (ctx, args) => {
    const boot = new Date(ctx.shell.startTime - 4523 * 1000);
    const base = [
      `${nowStamp()} linuxlab systemd[1]: Started Session 2 of User student.`,
      `${nowStamp()} linuxlab systemd[1]: Startup finished in 4.512s (kernel) + 8.201s (userspace) = 12.713s.`,
      `${nowStamp()} linuxlab sshd[1102]: Accepted password for student from 10.0.2.2 port 51522 ssh2`,
    ];
    let lines = [
      `-- Journal begins at ${boot.toString().slice(0, 24)}, ends at ${new Date().toString().slice(0, 24)}. --`,
      ...base,
      ...ctx.shell.sys.journal.map(j => j.line),
    ];
    if (args.includes('-r')) {
      lines = [lines[0], ...lines.slice(1).reverse()];
    }
    const nIdx = args.indexOf('-n');
    if (nIdx !== -1) {
      const n = parseInt(args[nIdx + 1]) || 10;
      lines = [lines[0], ...lines.slice(1).slice(-n)];
    }
    ctx.out(lines.join('\n') + '\n');
    return 0;
  }, 'journalctl - query the systemd journal\n\n  -r     newest entries first\n  -n N   show only the last N entries');

  /* ================= processes & jobs ================= */

  register('pgrep', async (ctx, args) => {
    const { } = {};
    const name = args.filter(a => !a.startsWith('-'))[0];
    if (!name) { ctx.err('pgrep: no matching criteria specified\n'); return 2; }
    let found = false;
    for (const job of ctx.shell.jobs) {
      if ((job.status === 'Running' || job.status === 'Stopped') && !job.ctrl.killed &&
          job.cmd.split(/\s+/)[0].includes(name)) {
        ctx.out(job.pid + '\n');
        found = true;
      }
    }
    // static system processes
    const sysProcs = { sshd: 801, systemd: 1, bash: 1103, rsyslogd: 610, cron: 1523 };
    if (sysProcs[name] !== undefined && !found) {
      ctx.out(sysProcs[name] + '\n');
      found = true;
    }
    return found ? 0 : 1;
  }, 'pgrep - look up processes by name and print their PIDs\n\nUsage: pgrep NAME');

  register('jobs', async (ctx) => {
    const live = ctx.shell.jobs.filter(j => (j.status === 'Running' || j.status === 'Stopped') && !j.ctrl.killed);
    for (const job of live) {
      const status = job.status === 'Running' ? 'Running' : 'Stopped';
      ctx.out(`[${job.id}]${ctx.shell.jobMarker(job)}  ${status.padEnd(22)} ${job.cmd}${job.status === 'Running' ? ' &' : ''}\n`);
    }
    return 0;
  }, 'jobs - list the shell\'s background and stopped jobs\n\nStart a background job with:  command &\nPause a foreground job with:  Ctrl+Z\nResume a paused job with:     bg N');

  register('bg', async (ctx, args) => {
    const job = ctx.shell.findJob(args[0]);
    if (!job) { ctx.err(`bash: bg: ${args[0] || 'current'}: no such job\n`); return 1; }
    if (job.status !== 'Stopped') { ctx.err(`bash: bg: job ${job.id} already in background\n`); return 1; }
    job.status = 'Running';
    job.ctrl.resume();
    ctx.out(`[${job.id}]+ ${job.cmd} &\n`);
    return 0;
  }, 'bg - resume a stopped job in the background\n\nUsage: bg [N]   (N is the job number shown by jobs)');

  register('fg', async (ctx, args) => {
    const job = ctx.shell.findJob(args[0]);
    if (!job) { ctx.err(`bash: fg: ${args[0] || 'current'}: no such job\n`); return 1; }
    ctx.shell.emit(job.cmd + '\n');
    job.status = 'Running';
    job.ctrl.resume();
    // wait for the job to finish in the foreground; Ctrl+C will kill it
    ctx.shell.fgCtrl = job.ctrl;
    if (job.promise) await job.promise;
    ctx.shell.fgCtrl = null;
    return 0;
  }, 'fg - bring a job to the foreground\n\nUsage: fg [N]');

  /* ================= users & groups ================= */

  register('usermod', async (ctx, args) => {
    if (ctx.user !== 'root') { ctx.err('usermod: Permission denied.\nusermod: cannot lock /etc/passwd; try again later.\n'); return 1; }
    let groupsToAdd = null;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-G' || args[i] === '-aG' || args[i] === '-Ga') groupsToAdd = args[++i];
      else if (args[i] === '-a' || args[i] === '--append') continue;
      else if (!args[i].startsWith('-')) rest.push(args[i]);
    }
    const user = rest[rest.length - 1];
    if (!user) { ctx.err('Usage: usermod [options] LOGIN\n'); return 2; }
    const passwd = ctx.fs.lookup('/etc/passwd');
    if (!passwd.content.split('\n').some(l => l.startsWith(user + ':'))) {
      ctx.err(`usermod: user '${user}' does not exist\n`); return 6;
    }
    if (groupsToAdd) {
      const groupF = ctx.fs.lookup('/etc/group');
      for (const g of groupsToAdd.split(',')) {
        const lines = groupF.content.split('\n');
        const idx = lines.findIndex(l => l.startsWith(g + ':'));
        if (idx === -1) { ctx.err(`usermod: group '${g}' does not exist\n`); return 6; }
        const f = lines[idx].split(':');
        const members = (f[3] || '').split(',').filter(Boolean);
        if (!members.includes(user)) members.push(user);
        lines[idx] = `${f[0]}:${f[1]}:${f[2]}:${members.join(',')}`;
        groupF.content = lines.join('\n');
      }
    }
    return 0;
  }, 'usermod - modify a user account\n\nUsage: sudo usermod -G GROUP USER   add USER to GROUP\n       sudo usermod -aG GROUP USER  append to supplementary groups\n\nRequires root.');

  register('chgrp', async (ctx, args) => {
    const { rest, recursive } = (() => {
      const r = [];
      let rec = false;
      for (const a of args) {
        if (a === '-R') rec = true;
        else if (!a.startsWith('-')) r.push(a);
      }
      return { rest: r, recursive: rec };
    })();
    if (rest.length < 2) { ctx.err('chgrp: missing operand\n'); return 1; }
    const group = rest[0];
    const groupF = ctx.fs.lookup('/etc/group');
    if (groupF && !groupF.content.split('\n').some(l => l.startsWith(group + ':'))) {
      ctx.err(`chgrp: invalid group: '${group}'\n`); return 1;
    }
    let code = 0;
    const apply = (node) => {
      node.group = group;
      if (recursive && node.type === 'dir') for (const c of Object.values(node.children)) apply(c);
    };
    for (const path of rest.slice(1)) {
      const node = ctx.fs.lookup(resolvePath(ctx, path));
      if (!node) { ctx.err(`chgrp: cannot access '${path}': No such file or directory\n`); code = 1; continue; }
      if (ctx.user !== 'root' && node.owner !== ctx.user) {
        ctx.err(`chgrp: changing group of '${path}': Operation not permitted\n`); code = 1; continue;
      }
      apply(node);
    }
    return code;
  }, 'chgrp - change the group ownership of files\n\nUsage: chgrp [-R] GROUP FILE...');

  register('chage', async (ctx, args) => {
    const list = args.includes('-l');
    const user = args.filter(a => !a.startsWith('-'))[0];
    if (!user) { ctx.err('Usage: chage [options] LOGIN\n'); return 1; }
    const passwd = ctx.fs.lookup('/etc/passwd');
    if (!passwd.content.split('\n').some(l => l.startsWith(user + ':'))) {
      ctx.err(`chage: user '${user}' does not exist in /etc/passwd\n`); return 1;
    }
    if (ctx.user !== 'root' && user !== ctx.user) {
      ctx.err(`chage: Permission denied.\n`); return 1;
    }
    if (list) {
      const d = new Date();
      const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const lastChange = `${mons[d.getMonth()]} ${pad2(d.getDate())}, ${d.getFullYear()}`;
      ctx.out(`Last password change\t\t\t\t\t: ${lastChange}\n`);
      ctx.out('Password expires\t\t\t\t\t: never\n');
      ctx.out('Password inactive\t\t\t\t\t: never\n');
      ctx.out('Account expires\t\t\t\t\t\t: never\n');
      ctx.out('Minimum number of days between password change\t\t: 0\n');
      ctx.out('Maximum number of days between password change\t\t: 99999\n');
      ctx.out('Number of days of warning before password expires\t: 7\n');
      return 0;
    }
    ctx.err('chage: only -l (list) is supported in this lab environment\n');
    return 1;
  }, 'chage - view or change user password expiry information\n\nUsage: chage -l USER   (list password aging info; other users require root)');

  /* ================= packages ================= */

  const pkgVersion = { zsh: '5.8.1-1', tcsh: '6.21.00-1.1', docker: '24.0.7-0ubuntu2', 'docker.io': '24.0.7-0ubuntu2' };

  register('apt', async (ctx, args) => {
    const sys = ctx.shell.sys;
    const sub = args[0];
    const needRoot = ['install', 'remove', 'update', 'upgrade', 'purge', 'autoremove'].includes(sub);
    if (needRoot && ctx.user !== 'root') {
      ctx.err('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n');
      ctx.err('E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n');
      return 100;
    }
    if (sub === 'update') {
      ctx.out('Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease\n');
      ctx.out('Hit:2 http://archive.ubuntu.com/ubuntu jammy-updates InRelease\n');
      ctx.out('Hit:3 http://archive.ubuntu.com/ubuntu jammy-security InRelease\n');
      ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
      ctx.out('All packages are up to date.\n');
      return 0;
    }
    if (sub === 'install') {
      const pkg = (args[1] || '').replace(/^docker\.io$/, 'docker');
      if (!pkg) { ctx.err('E: Unable to locate package \n'); return 100; }
      if (!['zsh', 'tcsh', 'docker'].includes(pkg) && !sys.packages.has(pkg)) {
        ctx.err(`E: Unable to locate package ${pkg}\n`); return 100;
      }
      ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
      if (sys.packages.has(pkg) || (pkg === 'docker' && sys.dockerInstalled)) {
        ctx.out(`${pkg} is already the newest version (${pkgVersion[pkg] || '1.0'}).\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n`);
        return 0;
      }
      ctx.out(`The following NEW packages will be installed:\n  ${pkg}\n`);
      ctx.out('0 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.\n');
      ctx.out(`Need to get 707 kB of archives.\nAfter this operation, 1,876 kB of additional disk space will be used.\n`);
      ctx.out(`Get:1 http://archive.ubuntu.com/ubuntu jammy/main amd64 ${pkg} amd64 ${pkgVersion[pkg] || '1.0'} [707 kB]\n`);
      ctx.out(`Fetched 707 kB in 0s (2,301 kB/s)\n`);
      ctx.out(`Selecting previously unselected package ${pkg}.\nPreparing to unpack .../${pkg}_${pkgVersion[pkg] || '1.0'}_amd64.deb ...\n`);
      ctx.out(`Unpacking ${pkg} (${pkgVersion[pkg] || '1.0'}) ...\nSetting up ${pkg} (${pkgVersion[pkg] || '1.0'}) ...\n`);
      ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
      sys.packages.add(pkg);
      if (pkg === 'zsh') ctx.fs.writeFile('/bin/zsh', '\x7fELF (binary)\n', { mode: 0o755 });
      if (pkg === 'tcsh') ctx.fs.writeFile('/bin/tcsh', '\x7fELF (binary)\n', { mode: 0o755 });
      if (pkg === 'docker') sys.dockerInstalled = true;
      return 0;
    }
    if (sub === 'remove' || sub === 'purge') {
      const pkg = args[1];
      if (!pkg || !sys.packages.has(pkg)) {
        ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
        ctx.err(`Package '${pkg || ''}' is not installed, so not removed\n`);
        ctx.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
        return 0;
      }
      ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
      ctx.out(`The following packages will be REMOVED:\n  ${pkg}\n`);
      ctx.out('0 upgraded, 0 newly installed, 1 to remove and 0 not upgraded.\n');
      ctx.out(`After this operation, 1,876 kB disk space will be freed.\n`);
      ctx.out(`(Reading database ... 202341 files and directories currently installed.)\nRemoving ${pkg} (${pkgVersion[pkg] || '1.0'}) ...\n`);
      sys.packages.delete(pkg);
      if (pkg === 'zsh') ctx.fs.remove('/bin/zsh');
      if (pkg === 'tcsh') ctx.fs.remove('/bin/tcsh');
      if (pkg === 'docker') sys.dockerInstalled = false;
      return 0;
    }
    if (sub === 'list') {
      ctx.out('Listing... Done\n');
      for (const p of [...ctx.shell.sys.packages].sort()) {
        ctx.out(`${p}/jammy,now ${pkgVersion[p] || '1.0-1'} amd64 [installed]\n`);
      }
      return 0;
    }
    ctx.out('apt 2.4.12 (amd64)\nUsage: apt [options] command\n\nMost used commands:\n  update  install  remove  upgrade  list  search\n');
    return 0;
  }, 'apt - command-line package manager\n\nUsage:\n  sudo apt update           refresh the package index\n  sudo apt install PKG      install a package\n  sudo apt remove PKG       remove a package\n  apt list --installed      list installed packages');
  register('apt-get', window.Commands['apt'].fn, 'apt-get - APT package handling utility (see apt)');

  register('apt-cache', async (ctx, args) => {
    if (args[0] === 'pkgnames') {
      ctx.out([...ctx.shell.sys.packages].sort().join('\n') + '\n');
      return 0;
    }
    ctx.err('Usage: apt-cache pkgnames\n');
    return 1;
  }, 'apt-cache - query the APT package cache\n\nUsage: apt-cache pkgnames   (list installed/known package names)');

  register('dpkg', async (ctx, args) => {
    if (args[0] === '-l' || args[0] === '--list') {
      ctx.out('Desired=Unknown/Install/Remove/Purge/Hold\n||/ Name            Version          Architecture Description\n+++-===============-================-============-=================================\n');
      for (const p of [...ctx.shell.sys.packages].sort()) {
        ctx.out(`ii  ${p.padEnd(15)} ${(pkgVersion[p] || '1.0-1').padEnd(16)} amd64        installed package\n`);
      }
      return 0;
    }
    ctx.err('Usage: dpkg -l\n');
    return 1;
  }, 'dpkg - Debian package manager\n\nUsage: dpkg -l   (list installed packages)');

  register('dnf', async (ctx) => {
    ctx.err('dnf: this system is Ubuntu (Debian-based) — use apt instead.\n');
    ctx.err('  e.g.  sudo apt install zsh\n');
    return 1;
  }, 'dnf - Red Hat package manager (not available on this Ubuntu system; use apt)');
  register('yum', window.Commands['dnf'].fn, 'yum - Red Hat package manager (use apt on this system)');

  const shellStub = (name) => async (ctx) => {
    if (!ctx.shell.sys.packages.has(name)) {
      ctx.err(`${name}: command not found\n`);
      return 127;
    }
    ctx.out(`${name} is installed. This lab keeps bash as the active shell — type exit if you were expecting a subshell.\n`);
    return 0;
  };
  register('zsh', shellStub('zsh'), 'zsh - the Z shell (install with sudo apt install zsh)');
  register('tcsh', shellStub('tcsh'), 'tcsh - the TENEX C shell (install with sudo apt install tcsh)');

  /* ================= scripts ================= */

  register('bash', async (ctx, args) => {
    const file = args.filter(a => !a.startsWith('-'))[0];
    if (!file) {
      ctx.out('GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\n(you are already in a bash session — nested interactive shells are not simulated)\n');
      return 0;
    }
    const p = resolvePath(ctx, file);
    const node = ctx.fs.lookup(p);
    if (!node) { ctx.err(`bash: ${file}: No such file or directory\n`); return 127; }
    if (!ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`bash: ${file}: Permission denied\n`); return 126; }
    return await ctx.shell.runScript(node.content || '', ctx.ctrl, file);
  }, 'bash - GNU Bourne-Again SHell\n\nUsage: bash SCRIPT.sh   (run a shell script)');
  register('sh', window.Commands['bash'].fn, 'sh - POSIX shell (runs scripts like bash here)');

  register('pico', async (ctx, args) => window.Commands['nano'].fn(ctx, args),
    'pico - simple text editor (alias for nano here)');

  /* ================= docker (simulated engine) ================= */

  register('docker', async (ctx, args) => {
    const sys = ctx.shell.sys;
    if (!sys.dockerInstalled) {
      ctx.err("docker: command not found\n(install it first: sudo apt install docker)\n");
      return 127;
    }
    if (ctx.user !== 'root') {
      ctx.err('Got permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\n(run docker with sudo)\n');
      return 1;
    }
    const dk = sys.docker;
    const sub = args[0];
    const hex = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    const ago = (t) => {
      const s = Math.floor((Date.now() - t) / 1000);
      if (s < 60) return `${s} seconds ago`;
      if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
      return `${Math.floor(s / 3600)} hours ago`;
    };

    if (sub === 'ps') {
      const all = args.includes('-a');
      ctx.out('CONTAINER ID   IMAGE     COMMAND              CREATED          STATUS          PORTS                  NAMES\n');
      for (const c of Object.values(dk.containers)) {
        if (!c.running && !all) continue;
        const status = c.running ? `Up ${ago(c.started)}` : `Exited (0) ${ago(c.stopped)}`;
        const ports = c.running && c.port ? `0.0.0.0:${c.port.split(':')[0]}->${c.port.split(':')[1]}/tcp` : '';
        ctx.out(`${c.id.slice(0, 12)}   ${c.image.padEnd(9)} "httpd-foreground"   ${ago(c.created).padEnd(16)} ${status.padEnd(15)} ${ports.padEnd(22)} ${c.name}\n`);
      }
      return 0;
    }
    if (sub === 'pull') {
      let image = args[1] || '';
      image = image.replace(/^docker\.io\/library\//, '').split(':')[0];
      if (image !== 'httpd') { ctx.err(`Error response from daemon: pull access denied for ${image || '(none)'}, repository does not exist\n`); return 1; }
      ctx.out('latest: Pulling from library/httpd\n');
      for (const layer of ['09f376ebb190', '18b9701d2a9a', '61e01337cf5b', 'e2bd9d4d0a3f', '9269ba3950bb']) {
        ctx.out(`${layer}: Pull complete\n`);
      }
      ctx.out('Digest: sha256:a8f52ad9a5e9d3e59b6a5478d1a3c2b7f3e6f9d0b7a24bf46e5c8a83f1c9d1d2\n');
      ctx.out('Status: Downloaded newer image for httpd:latest\ndocker.io/library/httpd:latest\n');
      dk.pulled.add('httpd');
      return 0;
    }
    if (sub === 'images') {
      ctx.out('REPOSITORY   TAG       IMAGE ID       CREATED       SIZE\n');
      if (dk.pulled.has('httpd')) ctx.out('httpd        latest    2776f4da9d55   2 weeks ago   148MB\n');
      return 0;
    }
    if (sub === 'run') {
      let name = null, port = null, image = null;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--name') name = args[++i];
        else if (args[i] === '-p') port = args[++i];
        else if (args[i].startsWith('-')) continue;
        else image = args[i].replace(/^docker\.io\/library\//, '').split(':')[0];
      }
      if (!image) { ctx.err('docker: "run" requires at least 1 argument.\n'); return 1; }
      if (image !== 'httpd') { ctx.err(`Unable to find image '${image}:latest' locally\ndocker: Error response from daemon: pull access denied for ${image}.\n`); return 125; }
      if (!dk.pulled.has('httpd')) {
        ctx.out("Unable to find image 'httpd:latest' locally\n");
        await window.Commands['docker'].fn({ ...ctx }, ['pull', 'httpd']);
      }
      name = name || 'container_' + Math.floor(Math.random() * 1000);
      if (dk.containers[name]) {
        ctx.err(`docker: Error response from daemon: Conflict. The container name "/${name}" is already in use.\n`);
        return 125;
      }
      const id = hex();
      dk.containers[name] = {
        id, name, image: 'httpd', port: port ? port.replace('-', '') : null,
        running: true, created: Date.now(), started: Date.now(),
      };
      ctx.out(id + '\n');
      return 0;
    }
    if (sub === 'exec') {
      const rest = args.slice(1).filter(a => !a.startsWith('-'));
      const name = rest[0], cmd = rest[1];
      const c = dk.containers[name];
      if (!c) { ctx.err(`Error response from daemon: No such container: ${name || ''}\n`); return 1; }
      if (!c.running) { ctx.err(`Error response from daemon: Container ${name} is not running\n`); return 1; }
      if (cmd !== 'bash' && cmd !== 'sh' && cmd !== '/bin/bash') {
        ctx.err('This lab supports: docker exec -it NAME bash\n');
        return 1;
      }
      // enter the container: swap in a container filesystem
      const cfs = new VFS();
      const mkc = (path) => {
        const parts = path.split('/').filter(Boolean);
        let cur = '';
        for (const p of parts) {
          cur += '/' + p;
          if (!cfs.exists(cur)) cfs.mkdir(cur, {});
        }
      };
      mkc('/usr/local/apache2/bin'); mkc('/usr/local/apache2/conf');
      mkc('/usr/local/apache2/htdocs'); mkc('/usr/local/apache2/logs');
      mkc('/usr/local/apache2/modules');
      cfs.writeFile('/usr/local/apache2/htdocs/index.html', '<html><body><h1>It works!</h1></body></html>\n');
      cfs.writeFile('/usr/local/apache2/conf/httpd.conf',
        'ServerRoot "/usr/local/apache2"\nListen 80\nDocumentRoot "/usr/local/apache2/htdocs"\n');
      cfs.writeFile('/etc/hostname', c.id.slice(0, 12) + '\n');

      const saved = {
        fs: ctx.shell.fs,
        // when reached via sudo, restore to the real (pre-sudo) user on exit
        user: ctx.sudoRealUser || ctx.shell.user,
        cwd: ctx.shell.cwd,
        env: { HOSTNAME: ctx.shell.env.HOSTNAME, HOME: ctx.shell.env.HOME, USER: ctx.shell.env.USER, LOGNAME: ctx.shell.env.LOGNAME },
      };
      ctx.shell.containerCtx = { id: c.id, name: c.name, saved };
      ctx.shell.fs = cfs;
      cfs.groupLookup = () => [];
      ctx.shell.user = 'root';
      ctx.shell.cwd = '/usr/local/apache2';
      ctx.shell.env.HOSTNAME = c.id.slice(0, 12);
      ctx.shell.env.HOME = '/root';
      ctx.shell.env.USER = 'root';
      ctx.shell.env.LOGNAME = 'root';
      return 0;
    }
    if (sub === 'stop') {
      const c = dk.containers[args[1]];
      if (!c) { ctx.err(`Error response from daemon: No such container: ${args[1] || ''}\n`); return 1; }
      c.running = false;
      c.stopped = Date.now();
      ctx.out(args[1] + '\n');
      return 0;
    }
    if (sub === 'rm') {
      const c = dk.containers[args[1]];
      if (!c) { ctx.err(`Error response from daemon: No such container: ${args[1] || ''}\n`); return 1; }
      if (c.running) {
        ctx.err(`Error response from daemon: cannot remove container "/${args[1]}": container is running: stop the container before removing\n`);
        return 1;
      }
      delete dk.containers[args[1]];
      ctx.out(args[1] + '\n');
      return 0;
    }
    if (sub === 'rmi') {
      const image = (args[1] || '').split(':')[0];
      if (!dk.pulled.has(image)) { ctx.err(`Error response from daemon: No such image: ${args[1] || ''}\n`); return 1; }
      if (Object.values(dk.containers).some(c => c.image === image)) {
        ctx.err(`Error response from daemon: conflict: unable to remove repository reference "${image}" (must force) - container is using its referenced image\n`);
        return 1;
      }
      dk.pulled.delete(image);
      ctx.out(`Untagged: ${image}:latest\nDeleted: sha256:2776f4da9d55b46a7b8b7548e6c9a01b0e3a8b8e9d55a2c4c0f6e0e8b8d9c0a1\n`);
      return 0;
    }
    ctx.err(`docker: '${sub || ''}' is not a docker command.\nSupported here: ps, pull, images, run, exec, stop, rm, rmi\n`);
    return 1;
  }, 'docker - container engine (simulated)\n\nCommon usage:\n  sudo docker ps                                   list running containers\n  sudo docker pull httpd                           download an image\n  sudo docker run -d -t -p 8088:80 --name NAME httpd\n  sudo docker exec -it NAME bash                   shell inside the container\n  sudo docker stop NAME / rm NAME / rmi httpd');

  /* ---- curl override: can reach containers published on localhost ---- */
  register('curl', async (ctx, args) => {
    const url = args.filter(a => !a.startsWith('-'))[0] || '';
    const m = url.match(/localhost:(\d+)/) || url.match(/127\.0\.0\.1:(\d+)/);
    if (m) {
      const port = m[1];
      const c = Object.values(ctx.shell.sys.docker.containers)
        .find(k => k.running && k.port && k.port.split(':')[0] === port);
      if (c) {
        ctx.out('<html><body><h1>It works!</h1></body></html>\n');
        return 0;
      }
      ctx.err(`curl: (7) Failed to connect to localhost port ${port} after 0 ms: Connection refused\n`);
      return 7;
    }
    ctx.err('curl: external network access is not available in this lab environment\n(published container ports on localhost do work, e.g. curl http://localhost:8088)\n');
    return 6;
  }, 'curl - transfer a URL\n\nOnly localhost container ports are reachable in this lab,\ne.g. curl http://localhost:8088');
})();
