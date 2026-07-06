/* Virtual File System — emulates an ext4-ish tree with users, permissions, timestamps. */
'use strict';

function fsNode(type, opts = {}) {
  return {
    type,                                  // 'dir' | 'file' | 'link'
    children: type === 'dir' ? {} : null,  // name -> node
    content: type === 'file' ? (opts.content || '') : null,
    target: type === 'link' ? (opts.target || '') : null,
    mode: opts.mode !== undefined ? opts.mode : (type === 'dir' ? 0o755 : 0o644),
    owner: opts.owner || 'root',
    group: opts.group || opts.owner || 'root',
    mtime: opts.mtime || Date.now(),
    nlink: type === 'dir' ? 2 : 1,
  };
}

class VFS {
  constructor() {
    this.root = fsNode('dir', { mode: 0o755 });
    this.buildDefaultTree();
  }

  /* ---------- path helpers ---------- */

  // Normalize a path against cwd -> absolute path string
  norm(path, cwd, home) {
    if (!path) path = '.';
    if (path.startsWith('~')) {
      path = (home || '/') + path.slice(1);
    }
    if (!path.startsWith('/')) path = (cwd === '/' ? '' : cwd) + '/' + path;
    const parts = path.split('/');
    const out = [];
    for (const p of parts) {
      if (p === '' || p === '.') continue;
      if (p === '..') { out.pop(); continue; }
      out.push(p);
    }
    return '/' + out.join('/');
  }

  // Look up node at absolute path. Follows symlinks in intermediate dirs;
  // follows final symlink unless followLink === false.
  lookup(abspath, followLink = true, depth = 0) {
    if (depth > 10) return null;
    if (abspath === '/') return this.root;
    const parts = abspath.split('/').filter(Boolean);
    let node = this.root;
    let curPath = '';
    for (let i = 0; i < parts.length; i++) {
      if (!node || node.type !== 'dir') return null;
      node = node.children[parts[i]] || null;
      curPath += '/' + parts[i];
      if (!node) return null;
      const isLast = i === parts.length - 1;
      if (node.type === 'link' && (!isLast || followLink)) {
        const target = this.norm(node.target, curPath.slice(0, curPath.lastIndexOf('/')) || '/');
        node = this.lookup(target, true, depth + 1);
      }
    }
    return node;
  }

  parentOf(abspath) {
    if (abspath === '/') return null;
    const idx = abspath.lastIndexOf('/');
    const parentPath = idx === 0 ? '/' : abspath.slice(0, idx);
    const name = abspath.slice(idx + 1);
    const parent = this.lookup(parentPath);
    return parent && parent.type === 'dir' ? { parent, name, parentPath } : null;
  }

  exists(abspath) { return this.lookup(abspath) !== null; }

  /* ---------- permission checks ---------- */
  // perm: 'r' | 'w' | 'x'   user: username ('root' bypasses all)
  // Group membership comes from this.groupLookup (installed by the shell).
  can(node, perm, user) {
    if (!node) return false;
    if (user === 'root') return true;
    const bit = { r: 4, w: 2, x: 1 }[perm];
    let shift;
    if (node.owner === user) shift = 6;
    else if (this.groupLookup && this.groupLookup(user).includes(node.group)) shift = 3;
    else shift = 0;
    return ((node.mode >> shift) & bit) !== 0;
  }

  // Removing/renaming a directory entry: write on the dir; if the sticky bit
  // is set (e.g. /tmp), you must also own the file or the directory.
  canDelete(parentNode, childNode, user) {
    if (user === 'root') return true;
    if (!this.can(parentNode, 'w', user)) return false;
    if (parentNode.mode & 0o1000) {
      return childNode.owner === user || parentNode.owner === user;
    }
    return true;
  }

  // Check every dir component of a path is executable (traversable) by user
  canTraverse(abspath, user) {
    if (user === 'root') return true;
    const parts = abspath.split('/').filter(Boolean);
    let node = this.root, cur = '';
    for (let i = 0; i < parts.length - 0; i++) {
      if (!this.can(node, 'x', user)) return false;
      node = node.children ? (node.children[parts[i]] || null) : null;
      if (!node) return true; // missing handled elsewhere
      if (node.type === 'link') {
        node = this.lookup(this.norm(node.target, cur || '/'));
        if (!node) return true;
      }
      cur += '/' + parts[i];
    }
    return true;
  }

  /* ---------- mutation helpers (no permission checks; commands do those) ---------- */

  mkdir(abspath, opts = {}) {
    const info = this.parentOf(abspath);
    if (!info) return null;
    const node = fsNode('dir', opts);
    // setgid on parent: new entries inherit the parent's group (and dirs the bit)
    if (info.parent.mode & 0o2000) {
      node.group = info.parent.group;
      node.mode |= 0o2000;
    }
    info.parent.children[info.name] = node;
    info.parent.mtime = Date.now();
    return node;
  }

  writeFile(abspath, content, opts = {}) {
    const info = this.parentOf(abspath);
    if (!info) return null;
    let node = info.parent.children[info.name];
    if (node && node.type === 'file') {
      node.content = content;
      node.mtime = Date.now();
    } else {
      node = fsNode('file', { ...opts, content });
      if (info.parent.mode & 0o2000) node.group = info.parent.group;
      info.parent.children[info.name] = node;
      info.parent.mtime = Date.now();
    }
    return node;
  }

  remove(abspath) {
    const info = this.parentOf(abspath);
    if (!info || !info.parent.children[info.name]) return false;
    delete info.parent.children[info.name];
    info.parent.mtime = Date.now();
    return true;
  }

  symlink(abspath, target, opts = {}) {
    const info = this.parentOf(abspath);
    if (!info) return null;
    const node = fsNode('link', { ...opts, target });
    info.parent.children[info.name] = node;
    return node;
  }

  copyNode(node) {
    const copy = fsNode(node.type, {
      content: node.content, target: node.target,
      mode: node.mode, owner: node.owner, group: node.group,
    });
    if (node.type === 'dir') {
      copy.children = {};
      for (const [name, child] of Object.entries(node.children)) {
        copy.children[name] = this.copyNode(child);
      }
    }
    return copy;
  }

  /* ---------- mode string like drwxrwsr-x (with setuid/setgid/sticky) ---------- */
  modeString(node) {
    const t = node.type === 'dir' ? 'd' : node.type === 'link' ? 'l' : '-';
    let s = t;
    const special = [(node.mode & 0o4000), (node.mode & 0o2000), (node.mode & 0o1000)];
    const specialChar = ['s', 's', 't'];
    [6, 3, 0].forEach((shift, i) => {
      const m = (node.mode >> shift) & 7;
      s += (m & 4 ? 'r' : '-') + (m & 2 ? 'w' : '-');
      if (special[i]) s += (m & 1) ? specialChar[i] : specialChar[i].toUpperCase();
      else s += (m & 1 ? 'x' : '-');
    });
    return s;
  }

  sizeOf(node) {
    if (node.type === 'dir') return 4096;
    if (node.type === 'link') return (node.target || '').length;
    return (node.content || '').length;
  }

  /* ---------- default Ubuntu-like tree ---------- */
  buildDefaultTree() {
    const now = Date.now();
    const mk = (path, opts) => {
      const parts = path.split('/').filter(Boolean);
      let node = this.root, cur = '';
      for (const p of parts) {
        cur += '/' + p;
        if (!node.children[p]) node.children[p] = fsNode('dir', { mtime: now });
        node = node.children[p];
      }
      if (opts) Object.assign(node, opts);
      return node;
    };
    const mkfile = (path, content, opts = {}) => {
      const info = (() => {
        const idx = path.lastIndexOf('/');
        mk(idx === 0 ? '/' : path.slice(0, idx));
        return this.parentOf(path);
      })();
      info.parent.children[info.name] = fsNode('file', { content, mtime: now, ...opts });
    };

    for (const d of ['/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/media', '/mnt',
      '/opt', '/proc', '/run', '/sbin', '/srv', '/sys', '/usr', '/var']) mk(d);
    mk('/usr/bin'); mk('/usr/local/bin'); mk('/usr/share'); mk('/usr/share/man');
    mk('/var/log'); mk('/var/tmp', { mode: 0o777 }); mk('/tmp', { mode: 0o777 });
    mk('/root', { mode: 0o700, owner: 'root' });

    // student home
    const home = '/home/student';
    mk(home, { owner: 'student', group: 'student', mode: 0o755 });
    for (const d of ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Public', 'Templates', 'Videos']) {
      mk(home + '/' + d, { owner: 'student', group: 'student' });
    }
    mkfile(home + '/.bashrc',
      '# ~/.bashrc: executed by bash(1) for non-login shells.\n' +
      'case $- in\n    *i*) ;;\n      *) return;;\nesac\n\n' +
      'HISTCONTROL=ignoreboth\nHISTSIZE=1000\nHISTFILESIZE=2000\n\n' +
      "alias ll='ls -alF'\nalias la='ls -A'\nalias l='ls -CF'\n",
      { owner: 'student', group: 'student' });
    mkfile(home + '/.profile',
      '# ~/.profile: executed by the command interpreter for login shells.\n',
      { owner: 'student', group: 'student' });
    mkfile(home + '/.bash_history', '', { owner: 'student', group: 'student', mode: 0o600 });

    // /etc files
    mkfile('/etc/hostname', 'linuxlab\n');
    mkfile('/etc/hosts',
      '127.0.0.1\tlocalhost\n127.0.1.1\tlinuxlab\n\n' +
      '::1     ip6-localhost ip6-loopback\nfe00::0 ip6-localnet\n');
    mkfile('/etc/passwd',
      'root:x:0:0:root:/root:/bin/bash\n' +
      'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n' +
      'bin:x:2:2:bin:/bin:/usr/sbin/nologin\n' +
      'sys:x:3:3:sys:/dev:/usr/sbin/nologin\n' +
      'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\n' +
      'sshd:x:105:65534::/run/sshd:/usr/sbin/nologin\n' +
      'student:x:1000:1000:Student,,,:/home/student:/bin/bash\n');
    mkfile('/etc/shadow',
      'root:$6$rounds=656000$SALTSALT$HASH:19700:0:99999:7:::\n' +
      'student:$6$rounds=656000$SALTSALT$HASH:19700:0:99999:7:::\n',
      { mode: 0o640 });
    mkfile('/etc/group',
      'root:x:0:\nadm:x:4:student\nsudo:x:27:student\n' +
      'cdrom:x:24:student\nplugdev:x:46:student\nstudent:x:1000:\n');
    mkfile('/etc/os-release',
      'PRETTY_NAME="Ubuntu 22.04.4 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\n' +
      'VERSION="22.04.4 LTS (Jammy Jellyfish)"\nVERSION_CODENAME=jammy\n' +
      'ID=ubuntu\nID_LIKE=debian\nHOME_URL="https://www.ubuntu.com/"\n');
    mkfile('/etc/issue', 'Ubuntu 22.04.4 LTS \\n \\l\n\n');
    mkfile('/etc/fstab',
      '# /etc/fstab: static file system information.\n' +
      'UUID=1c9a8b7e-4f3d-4b2a-9e8f-7c6d5e4f3a2b /               ext4    errors=remount-ro 0       1\n' +
      '/swapfile                                 none            swap    sw              0       0\n');
    mkfile('/etc/resolv.conf', 'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n');
    mkfile('/etc/nsswitch.conf',
      '# /etc/nsswitch.conf\n#\n# Name Service Switch configuration file.\n\n' +
      'passwd:         files systemd\ngroup:          files systemd\nshadow:         files\n' +
      'gshadow:        files\n\nhosts:          files mdns4_minimal [NOTFOUND=return] dns\n' +
      'networks:       files\n\nprotocols:      db files\nservices:       db files\n' +
      'ethers:         db files\nrpc:            db files\n\nnetgroup:       nis\n');
    // /tmp and /var/tmp carry the sticky bit like a real system
    this.lookup('/tmp').mode = 0o1777;
    this.lookup('/var/tmp').mode = 0o1777;
    // block devices (the "USB stick" sdb is managed by the shell's device state)
    mkfile('/dev/sda', '', { mode: 0o660, group: 'disk' });
    mkfile('/dev/sda1', '', { mode: 0o660, group: 'disk' });

    // /var/log samples
    mkfile('/var/log/syslog',
      'Jul  5 08:17:01 linuxlab CRON[1523]: (root) CMD (cd / && run-parts --report /etc/cron.hourly)\n' +
      'Jul  5 08:30:12 linuxlab systemd[1]: Starting Daily apt upgrade and clean activities...\n' +
      'Jul  5 08:30:14 linuxlab systemd[1]: apt-daily-upgrade.service: Deactivated successfully.\n',
      { mode: 0o640, group: 'adm' });
    mkfile('/var/log/auth.log',
      'Jul  5 08:15:22 linuxlab sshd[1102]: Accepted password for student from 10.0.2.2 port 51522 ssh2\n' +
      'Jul  5 08:15:22 linuxlab sshd[1102]: pam_unix(sshd:session): session opened for user student(uid=1000)\n',
      { mode: 0o640, group: 'adm' });
    mkfile('/var/log/dpkg.log', 'Jul  5 07:58:01 status installed vim:amd64 2:8.2.3995-1ubuntu2.16\n');

    // /dev
    mkfile('/dev/null', '', { mode: 0o666 });
    mkfile('/dev/zero', '', { mode: 0o666 });
    mkfile('/dev/random', '', { mode: 0o666 });

    // /proc basics
    mkfile('/proc/version',
      'Linux version 5.15.0-105-generic (buildd@lcy02-amd64-007) ' +
      '(gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0) #115-Ubuntu SMP Mon Apr 15 09:52:04 UTC 2024\n');
    mkfile('/proc/cpuinfo',
      'processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz\n' +
      'cpu MHz\t\t: 2592.000\ncache size\t: 12288 KB\n');
    mkfile('/proc/meminfo',
      'MemTotal:        4030264 kB\nMemFree:         2560648 kB\nMemAvailable:    3202520 kB\n' +
      'Buffers:           84512 kB\nCached:           612348 kB\nSwapTotal:       2097148 kB\nSwapFree:        2097148 kB\n');

    // root's private area (permission-denied practice)
    mkfile('/root/.bashrc', '# root bashrc\n', { mode: 0o600 });
    mkfile('/root/secret.txt', 'The root password is not stored here. Nice try!\n', { mode: 0o600 });

    // populate "binaries" so `which`/ls of /bin look real (names only)
    const bins = ['bash', 'cat', 'chmod', 'chown', 'cp', 'date', 'dd', 'df', 'echo', 'grep',
      'gzip', 'hostname', 'kill', 'ln', 'ls', 'mkdir', 'mount', 'mv', 'nano', 'ping', 'ps',
      'pwd', 'rm', 'rmdir', 'sed', 'sh', 'sleep', 'sort', 'su', 'tar', 'touch', 'uname', 'vi'];
    for (const b of bins) {
      mkfile('/bin/' + b, '\x7fELF (binary)\n', { mode: 0o755 });
    }
    const usrbins = ['awk', 'clear', 'curl', 'cut', 'diff', 'du', 'env', 'file', 'find', 'free',
      'head', 'id', 'less', 'man', 'passwd', 'sudo', 'tail', 'top', 'tr', 'uniq', 'uptime',
      'vim', 'wc', 'wget', 'whereis', 'which', 'whoami'];
    for (const b of usrbins) {
      mkfile('/usr/bin/' + b, '\x7fELF (binary)\n', { mode: 0o755 });
    }
    this.symlink('/bin/sh', '/bin/bash');
  }

  /* ---------- serialization (for SCORM suspend/resume) ---------- */
  serialize() {
    const enc = (node) => {
      const o = { t: node.type[0], m: node.mode, o: node.owner, g: node.group };
      if (node.type === 'file') o.c = node.content;
      if (node.type === 'link') o.l = node.target;
      if (node.type === 'dir') {
        o.k = {};
        for (const [name, child] of Object.entries(node.children)) o.k[name] = enc(child);
      }
      return o;
    };
    return JSON.stringify(enc(this.root));
  }

  static deserialize(json) {
    const fs = new VFS();
    const dec = (o) => {
      const type = o.t === 'd' ? 'dir' : o.t === 'l' ? 'link' : 'file';
      const node = fsNode(type, { mode: o.m, owner: o.o, group: o.g, content: o.c, target: o.l });
      if (type === 'dir') {
        node.children = {};
        for (const [name, child] of Object.entries(o.k || {})) node.children[name] = dec(child);
      }
      return node;
    };
    try {
      fs.root = dec(JSON.parse(json));
    } catch (e) { /* fall back to default tree */ }
    return fs;
  }
}

window.VFS = VFS;
