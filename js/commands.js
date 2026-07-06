/* Command implementations. Each: async fn(ctx, args) -> exit code.
   ctx: { fs, shell, term, env, user, cwd, stdin, out(), err(), interactive } */
'use strict';

const Commands = {};
window.Commands = Commands;

function register(name, fn, man) {
  Commands[name] = { fn, man: man || '' };
}

/* ---------- helpers ---------- */

function parseFlags(args) {
  const flags = new Set();
  const rest = [];
  let noMoreFlags = false;
  for (const a of args) {
    if (a === '--') { noMoreFlags = true; continue; }
    if (!noMoreFlags && a.startsWith('--')) flags.add(a.slice(2));
    else if (!noMoreFlags && a.startsWith('-') && a.length > 1) {
      for (const c of a.slice(1)) flags.add(c);
    } else rest.push(a);
  }
  return { flags, rest };
}

function resolvePath(ctx, path) {
  return ctx.fs.norm(path, ctx.cwd, ctx.env.HOME);
}

function fmtDate(ts) {
  const d = new Date(ts);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const day = String(d.getDate()).padStart(2, ' ');
  const now = new Date();
  const sixMonths = 1000 * 60 * 60 * 24 * 182;
  if (Math.abs(now - d) < sixMonths) {
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return `${mon} ${day} ${hm}`;
  }
  return `${mon} ${day}  ${d.getFullYear()}`;
}

function colorName(fs, node, name) {
  if (node.type === 'dir') return `\x01dir\x02${name}\x03`;
  if (node.type === 'link') return `\x01lnk\x02${name}\x03`;
  if (node.mode & 0o111) return `\x01exe\x02${name}\x03`;
  return name;
}

/* ================= filesystem navigation ================= */

register('pwd', async (ctx) => { ctx.out(ctx.cwd + '\n'); return 0; },
  'pwd - print name of current/working directory');

register('cd', async (ctx, args) => {
  let target = args[0];
  if (!target || target === '~') target = ctx.env.HOME;
  if (target === '-') { target = ctx.env.OLDPWD; ctx.out(target + '\n'); }
  const p = resolvePath(ctx, target);
  const node = ctx.fs.lookup(p);
  if (!node) { ctx.err(`bash: cd: ${args[0]}: No such file or directory\n`); return 1; }
  if (node.type !== 'dir') { ctx.err(`bash: cd: ${args[0]}: Not a directory\n`); return 1; }
  if (!ctx.fs.can(node, 'x', ctx.user)) { ctx.err(`bash: cd: ${args[0]}: Permission denied\n`); return 1; }
  ctx.env.OLDPWD = ctx.shell.cwd;
  ctx.shell.cwd = p;
  ctx.env.PWD = p;
  return 0;
}, 'cd - change the shell working directory\n\nUsage: cd [DIRECTORY]\n\ncd -   go to previous directory\ncd ~   go to home directory');

register('ls', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  const paths = rest.length ? rest : ['.'];
  const all = flags.has('a') || flags.has('A') || flags.has('all');
  const long = flags.has('l');
  const classify = flags.has('F');
  const human = flags.has('h');
  const results = [];
  let code = 0;

  for (const path of paths) {
    const p = resolvePath(ctx, path);
    const node = ctx.fs.lookup(p);
    if (!node) { ctx.err(`ls: cannot access '${path}': No such file or directory\n`); code = 2; continue; }
    if (node.type !== 'dir' || flags.has('d')) {
      results.push({ header: null, entries: [[flags.has('d') ? path : path.split('/').pop(), node]] });
      continue;
    }
    if (!ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`ls: cannot open directory '${path}': Permission denied\n`); code = 2; continue; }
    let names = Object.keys(node.children).sort((a, b) => a.localeCompare(b));
    if (!all) names = names.filter(n => !n.startsWith('.'));
    if (flags.has('a')) names = ['.', '..', ...names];
    const entries = names.map(n => [n, n === '.' ? node : n === '..' ? (ctx.fs.lookup(ctx.fs.norm(p + '/..', '/')) || node) : node.children[n]]);
    if (flags.has('t')) entries.sort((a, b) => b[1].mtime - a[1].mtime);
    if (flags.has('r')) entries.reverse();
    results.push({ header: paths.length > 1 ? path : null, entries });
  }

  const fmtSize = (n) => {
    if (!human) return String(n);
    if (n < 1024) return String(n);
    const units = ['K', 'M', 'G'];
    let v = n;
    for (const u of units) { v /= 1024; if (v < 1024) return (v < 10 ? v.toFixed(1) : Math.round(v)) + u; }
    return Math.round(v) + 'T';
  };

  for (const r of results) {
    if (r.header) ctx.out(r.header + ':\n');
    if (long) {
      if (!flags.has('d')) {
        let total = 0;
        for (const [, n] of r.entries) total += Math.ceil(ctx.fs.sizeOf(n) / 1024) * (n.type === 'dir' ? 4 : 4);
        ctx.out(`total ${total}\n`);
      }
      const wSize = Math.max(...r.entries.map(([, n]) => fmtSize(ctx.fs.sizeOf(n)).length), 4);
      const wOwn = Math.max(...r.entries.map(([, n]) => n.owner.length));
      const wGrp = Math.max(...r.entries.map(([, n]) => n.group.length));
      for (const [name, n] of r.entries) {
        let display = colorName(ctx.fs, n, name);
        if (n.type === 'link') display += ' -> ' + n.target;
        ctx.out(`${ctx.fs.modeString(n)} ${String(n.nlink).padStart(2)} ${n.owner.padEnd(wOwn)} ${n.group.padEnd(wGrp)} ${fmtSize(ctx.fs.sizeOf(n)).padStart(wSize)} ${fmtDate(n.mtime)} ${display}\n`);
      }
    } else {
      const parts = r.entries.map(([name, n]) => {
        let s = colorName(ctx.fs, n, name);
        if (classify) {
          if (n.type === 'dir') s += '/';
          else if (n.type === 'link') s += '@';
          else if (n.mode & 0o111) s += '*';
        }
        return s;
      });
      if (parts.length) ctx.out(parts.join('  ') + '\n');
    }
    if (r.header) ctx.out('\n');
  }
  return code;
}, 'ls - list directory contents\n\nUsage: ls [OPTION]... [FILE]...\n\n  -a     do not ignore entries starting with .\n  -l     use a long listing format\n  -h     with -l, print sizes in human readable format\n  -t     sort by modification time, newest first\n  -r     reverse order while sorting\n  -F     append indicator (one of */=>@|) to entries');

/* ================= file viewing ================= */

register('cat', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (!rest.length) { ctx.out(ctx.stdin); return 0; }
  let code = 0;
  for (const path of rest) {
    const p = resolvePath(ctx, path);
    const node = ctx.fs.lookup(p);
    if (!node) { ctx.err(`cat: ${path}: No such file or directory\n`); code = 1; continue; }
    if (node.type === 'dir') { ctx.err(`cat: ${path}: Is a directory\n`); code = 1; continue; }
    if (!ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`cat: ${path}: Permission denied\n`); code = 1; continue; }
    let content = node.content || '';
    if (flags.has('n')) {
      content = content.split('\n').map((l, i, arr) =>
        (i === arr.length - 1 && l === '') ? '' : `${String(i + 1).padStart(6)}\t${l}`).join('\n');
    }
    ctx.out(content.endsWith('\n') || content === '' ? content : content + '\n');
  }
  return code;
}, 'cat - concatenate files and print on the standard output\n\nUsage: cat [OPTION]... [FILE]...\n\n  -n     number all output lines');

register('head', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  let n = 10;
  const nIdx = args.indexOf('-n');
  if (nIdx !== -1 && args[nIdx + 1]) n = parseInt(args[nIdx + 1]) || 10;
  const files = rest.filter(a => !/^\d+$/.test(a) || args[args.indexOf(a) - 1] !== '-n');
  const takeHead = (text) => text.split('\n').slice(0, n).join('\n') + '\n';
  if (!files.length) { ctx.out(takeHead(ctx.stdin.replace(/\n$/, ''))); return 0; }
  for (const path of files) {
    const node = ctx.fs.lookup(resolvePath(ctx, path));
    if (!node) { ctx.err(`head: cannot open '${path}' for reading: No such file or directory\n`); continue; }
    if (!ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`head: cannot open '${path}' for reading: Permission denied\n`); continue; }
    if (files.length > 1) ctx.out(`==> ${path} <==\n`);
    ctx.out(takeHead((node.content || '').replace(/\n$/, '')));
  }
  return 0;
}, 'head - output the first part of files\n\nUsage: head [OPTION]... [FILE]...\n\n  -n NUM   print the first NUM lines instead of the first 10');

register('tail', async (ctx, args) => {
  const { rest } = parseFlags(args);
  let n = 10;
  const nIdx = args.indexOf('-n');
  if (nIdx !== -1 && args[nIdx + 1]) n = parseInt(args[nIdx + 1]) || 10;
  const files = rest.filter(a => !/^\d+$/.test(a) || args[args.indexOf(a) - 1] !== '-n');
  const takeTail = (text) => text.split('\n').slice(-n).join('\n') + '\n';
  if (!files.length) { ctx.out(takeTail(ctx.stdin.replace(/\n$/, ''))); return 0; }
  for (const path of files) {
    const node = ctx.fs.lookup(resolvePath(ctx, path));
    if (!node) { ctx.err(`tail: cannot open '${path}' for reading: No such file or directory\n`); continue; }
    if (!ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`tail: cannot open '${path}' for reading: Permission denied\n`); continue; }
    if (files.length > 1) ctx.out(`==> ${path} <==\n`);
    ctx.out(takeTail((node.content || '').replace(/\n$/, '')));
  }
  return 0;
}, 'tail - output the last part of files\n\nUsage: tail [OPTION]... [FILE]...\n\n  -n NUM   output the last NUM lines, instead of the last 10');

const pagerFn = async (ctx, args) => {
  // Simplified pager: prints content (interactive paging kept simple for the emulator)
  if (!args.length) { ctx.out(ctx.stdin); return 0; }
  const node = ctx.fs.lookup(resolvePath(ctx, args[args.length - 1]));
  if (!node) { ctx.err(`${args[args.length - 1]}: No such file or directory\n`); return 1; }
  if (!ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`${args[args.length - 1]}: Permission denied\n`); return 1; }
  ctx.out(node.content || '');
  if (node.content && !node.content.endsWith('\n')) ctx.out('\n');
  return 0;
};
register('less', pagerFn, 'less - opposite of more (file pager)\n\nUsage: less [FILE]');
register('more', pagerFn, 'more - file perusal filter for crt viewing\n\nUsage: more [FILE]');

register('wc', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  const count = (text, label) => {
    const lines = (text.match(/\n/g) || []).length;
    const words = (text.match(/\S+/g) || []).length;
    const chars = text.length;
    const parts = [];
    if (flags.has('l')) parts.push(lines);
    if (flags.has('w')) parts.push(words);
    if (flags.has('c') || flags.has('m')) parts.push(chars);
    if (!parts.length) parts.push(lines, words, chars);
    ctx.out(parts.map(x => String(x).padStart(3)).join(' ') + (label ? ' ' + label : '') + '\n');
  };
  if (!rest.length) { count(ctx.stdin, ''); return 0; }
  for (const path of rest) {
    const node = ctx.fs.lookup(resolvePath(ctx, path));
    if (!node) { ctx.err(`wc: ${path}: No such file or directory\n`); continue; }
    if (!ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`wc: ${path}: Permission denied\n`); continue; }
    count(node.content || '', path);
  }
  return 0;
}, 'wc - print newline, word, and byte counts for each file\n\nUsage: wc [OPTION]... [FILE]...\n\n  -l     print the newline counts\n  -w     print the word counts\n  -c     print the byte counts');

register('grep', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (!rest.length) { ctx.err('Usage: grep [OPTION]... PATTERNS [FILE]...\n'); return 2; }
  const pattern = rest[0];
  const files = rest.slice(1);
  let re;
  try {
    re = new RegExp(pattern, flags.has('i') ? 'i' : '');
  } catch (e) { re = null; }
  const match = (line) => re ? re.test(line) : line.includes(pattern);
  let found = false;
  const searchText = (text, label) => {
    const lines = text.replace(/\n$/, '').split('\n');
    lines.forEach((line, i) => {
      let m = match(line);
      if (flags.has('v')) m = !m;
      if (m) {
        found = true;
        if (flags.has('c')) return;
        let prefix = label ? label + ':' : '';
        if (flags.has('n')) prefix += (i + 1) + ':';
        ctx.out(prefix + line + '\n');
      }
    });
    if (flags.has('c')) {
      const c = lines.filter(l => flags.has('v') ? !match(l) : match(l)).length;
      ctx.out((label ? label + ':' : '') + c + '\n');
    }
  };
  const walk = (path, abspath) => {
    const node = ctx.fs.lookup(abspath);
    if (!node) { ctx.err(`grep: ${path}: No such file or directory\n`); return; }
    if (node.type === 'dir') {
      if (flags.has('r') || flags.has('R')) {
        for (const name of Object.keys(node.children).sort()) {
          walk(path + '/' + name, abspath + '/' + name);
        }
      } else ctx.err(`grep: ${path}: Is a directory\n`);
      return;
    }
    if (!ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`grep: ${path}: Permission denied\n`); return; }
    searchText(node.content || '', (files.length > 1 || flags.has('r') || flags.has('R')) ? path : null);
  };
  if (!files.length) searchText(ctx.stdin, null);
  else for (const f of files) walk(f, resolvePath(ctx, f));
  return found ? 0 : 1;
}, 'grep - print lines that match patterns\n\nUsage: grep [OPTION]... PATTERNS [FILE]...\n\n  -i     ignore case distinctions\n  -n     print line number with output lines\n  -v     select non-matching lines\n  -c     print only a count of selected lines\n  -r     read all files under each directory, recursively');

register('sort', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  let text = ctx.stdin;
  if (rest.length) {
    const node = ctx.fs.lookup(resolvePath(ctx, rest[0]));
    if (!node) { ctx.err(`sort: cannot read: ${rest[0]}: No such file or directory\n`); return 2; }
    text = node.content || '';
  }
  let lines = text.replace(/\n$/, '').split('\n');
  if (flags.has('n')) lines.sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
  else lines.sort();
  if (flags.has('r')) lines.reverse();
  if (flags.has('u')) lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
  ctx.out(lines.join('\n') + '\n');
  return 0;
}, 'sort - sort lines of text files\n\nUsage: sort [OPTION]... [FILE]...\n\n  -n     compare according to string numerical value\n  -r     reverse the result of comparisons\n  -u     output only the first of an equal run');

register('uniq', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  let text = ctx.stdin;
  if (rest.length) {
    const node = ctx.fs.lookup(resolvePath(ctx, rest[0]));
    if (!node) { ctx.err(`uniq: ${rest[0]}: No such file or directory\n`); return 1; }
    text = node.content || '';
  }
  const lines = text.replace(/\n$/, '').split('\n');
  const out = [];
  let prev = null, count = 0;
  const flush = () => {
    if (prev === null) return;
    if (flags.has('c')) out.push(`${String(count).padStart(7)} ${prev}`);
    else if (flags.has('d')) { if (count > 1) out.push(prev); }
    else out.push(prev);
  };
  for (const l of lines) {
    if (l === prev) count++;
    else { flush(); prev = l; count = 1; }
  }
  flush();
  ctx.out(out.join('\n') + '\n');
  return 0;
}, 'uniq - report or omit repeated lines\n\nUsage: uniq [OPTION]... [INPUT]\n\n  -c     prefix lines by the number of occurrences\n  -d     only print duplicate lines');

register('cut', async (ctx, args) => {
  let delim = '\t', fields = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-d') delim = args[++i];
    else if (args[i].startsWith('-d')) delim = args[i].slice(2);
    else if (args[i] === '-f') fields = args[++i];
    else if (args[i].startsWith('-f')) fields = args[i].slice(2);
    else rest.push(args[i]);
  }
  if (!fields) { ctx.err('cut: you must specify a list of bytes, characters, or fields\n'); return 1; }
  const wanted = new Set();
  for (const part of fields.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= (b || 20); i++) wanted.add(i);
    } else wanted.add(Number(part));
  }
  let text = ctx.stdin;
  if (rest.length) {
    const node = ctx.fs.lookup(resolvePath(ctx, rest[0]));
    if (!node) { ctx.err(`cut: ${rest[0]}: No such file or directory\n`); return 1; }
    text = node.content || '';
  }
  for (const line of text.replace(/\n$/, '').split('\n')) {
    const parts = line.split(delim);
    ctx.out(parts.filter((_, i) => wanted.has(i + 1)).join(delim) + '\n');
  }
  return 0;
}, 'cut - remove sections from each line of files\n\nUsage: cut -d DELIM -f LIST [FILE]\n\n  -d     use DELIM instead of TAB for field delimiter\n  -f     select only these fields');

register('tr', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (!rest.length) { ctx.err('tr: missing operand\n'); return 1; }
  const expand = (s) => {
    s = s.replace(/a-z/g, 'abcdefghijklmnopqrstuvwxyz')
         .replace(/A-Z/g, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
         .replace(/0-9/g, '0123456789');
    return s;
  };
  const from = expand(rest[0]);
  let text = ctx.stdin;
  if (flags.has('d')) {
    const del = new Set(from);
    ctx.out([...text].filter(c => !del.has(c)).join(''));
    return 0;
  }
  const to = expand(rest[1] || '');
  ctx.out([...text].map(c => {
    const i = from.indexOf(c);
    return i === -1 ? c : (to[Math.min(i, to.length - 1)] || c);
  }).join(''));
  return 0;
}, 'tr - translate or delete characters\n\nUsage: tr [OPTION]... STRING1 [STRING2]\n\n  -d     delete characters in STRING1');

/* ================= file manipulation ================= */

register('touch', async (ctx, args) => {
  const { rest } = parseFlags(args);
  if (!rest.length) { ctx.err('touch: missing file operand\n'); return 1; }
  for (const path of rest) {
    const p = resolvePath(ctx, path);
    const node = ctx.fs.lookup(p);
    if (node) { node.mtime = Date.now(); continue; }
    const info = ctx.fs.parentOf(p);
    if (!info) { ctx.err(`touch: cannot touch '${path}': No such file or directory\n`); return 1; }
    if (!ctx.fs.can(info.parent, 'w', ctx.user)) { ctx.err(`touch: cannot touch '${path}': Permission denied\n`); return 1; }
    ctx.fs.writeFile(p, '', { owner: ctx.user, group: ctx.user, mode: 0o664 });
  }
  return 0;
}, 'touch - change file timestamps (creates empty files)\n\nUsage: touch FILE...');

register('mkdir', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (!rest.length) { ctx.err('mkdir: missing operand\n'); return 1; }
  let code = 0;
  for (const path of rest) {
    const p = resolvePath(ctx, path);
    if (ctx.fs.exists(p)) { ctx.err(`mkdir: cannot create directory '${path}': File exists\n`); code = 1; continue; }
    if (flags.has('p')) {
      const parts = p.split('/').filter(Boolean);
      let cur = '';
      for (const part of parts) {
        cur += '/' + part;
        if (!ctx.fs.exists(cur)) ctx.fs.mkdir(cur, { owner: ctx.user, group: ctx.user });
      }
      continue;
    }
    const info = ctx.fs.parentOf(p);
    if (!info || !ctx.fs.lookup(info.parentPath)) { ctx.err(`mkdir: cannot create directory '${path}': No such file or directory\n`); code = 1; continue; }
    if (!ctx.fs.can(info.parent, 'w', ctx.user)) { ctx.err(`mkdir: cannot create directory '${path}': Permission denied\n`); code = 1; continue; }
    ctx.fs.mkdir(p, { owner: ctx.user, group: ctx.user });
  }
  return code;
}, 'mkdir - make directories\n\nUsage: mkdir [OPTION]... DIRECTORY...\n\n  -p     make parent directories as needed');

register('rmdir', async (ctx, args) => {
  const { rest } = parseFlags(args);
  if (!rest.length) { ctx.err('rmdir: missing operand\n'); return 1; }
  let code = 0;
  for (const path of rest) {
    const p = resolvePath(ctx, path);
    const node = ctx.fs.lookup(p);
    if (!node) { ctx.err(`rmdir: failed to remove '${path}': No such file or directory\n`); code = 1; continue; }
    if (node.type !== 'dir') { ctx.err(`rmdir: failed to remove '${path}': Not a directory\n`); code = 1; continue; }
    if (Object.keys(node.children).length) { ctx.err(`rmdir: failed to remove '${path}': Directory not empty\n`); code = 1; continue; }
    const info = ctx.fs.parentOf(p);
    if (!ctx.fs.can(info.parent, 'w', ctx.user)) { ctx.err(`rmdir: failed to remove '${path}': Permission denied\n`); code = 1; continue; }
    ctx.fs.remove(p);
  }
  return code;
}, 'rmdir - remove empty directories\n\nUsage: rmdir DIRECTORY...');

register('rm', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (!rest.length) { ctx.err('rm: missing operand\n'); return 1; }
  const recursive = flags.has('r') || flags.has('R');
  let code = 0;
  for (const path of rest) {
    const p = resolvePath(ctx, path);
    if (p === '/') { ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); code = 1; continue; }
    const node = ctx.fs.lookup(p, false);
    if (!node) {
      if (!flags.has('f')) { ctx.err(`rm: cannot remove '${path}': No such file or directory\n`); code = 1; }
      continue;
    }
    if (node.type === 'dir' && !recursive) { ctx.err(`rm: cannot remove '${path}': Is a directory\n`); code = 1; continue; }
    const info = ctx.fs.parentOf(p);
    if (!ctx.fs.can(info.parent, 'w', ctx.user)) { ctx.err(`rm: cannot remove '${path}': Permission denied\n`); code = 1; continue; }
    if (!ctx.fs.canDelete(info.parent, node, ctx.user)) {
      ctx.err(`rm: cannot remove '${path}': Operation not permitted\n`); code = 1; continue;
    }
    if (flags.has('i')) {
      const kind = node.type === 'dir' ? 'directory' : ((node.content || '') === '' ? 'regular empty file' : 'regular file');
      const ans = await ctx.term.readLine(`rm: remove ${kind} '${path}'? `);
      if (!/^y/i.test(ans)) continue;
    }
    ctx.fs.remove(p);
  }
  return code;
}, 'rm - remove files or directories\n\nUsage: rm [OPTION]... FILE...\n\n  -f     ignore nonexistent files, never prompt\n  -r     remove directories and their contents recursively');

register('cp', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (rest.length < 2) { ctx.err(`cp: missing ${rest.length ? 'destination ' : ''}file operand\n`); return 1; }
  const destPath = resolvePath(ctx, rest[rest.length - 1]);
  const sources = rest.slice(0, -1);
  const destNode = ctx.fs.lookup(destPath);
  const destIsDir = destNode && destNode.type === 'dir';
  if (sources.length > 1 && !destIsDir) { ctx.err(`cp: target '${rest[rest.length - 1]}' is not a directory\n`); return 1; }
  let code = 0;
  for (const src of sources) {
    const sp = resolvePath(ctx, src);
    const snode = ctx.fs.lookup(sp);
    if (!snode) { ctx.err(`cp: cannot stat '${src}': No such file or directory\n`); code = 1; continue; }
    if (snode.type === 'dir' && !flags.has('r') && !flags.has('R') && !flags.has('a')) {
      ctx.err(`cp: -r not specified; omitting directory '${src}'\n`); code = 1; continue;
    }
    if (!ctx.fs.can(snode, 'r', ctx.user)) { ctx.err(`cp: cannot open '${src}' for reading: Permission denied\n`); code = 1; continue; }
    const target = destIsDir ? destPath + '/' + sp.split('/').pop() : destPath;
    const tinfo = ctx.fs.parentOf(target);
    if (!tinfo) { ctx.err(`cp: cannot create '${rest[rest.length - 1]}': No such file or directory\n`); code = 1; continue; }
    if (!ctx.fs.can(tinfo.parent, 'w', ctx.user)) { ctx.err(`cp: cannot create regular file '${target}': Permission denied\n`); code = 1; continue; }
    const copy = ctx.fs.copyNode(snode);
    copy.owner = ctx.user; copy.group = ctx.user; copy.mtime = Date.now();
    tinfo.parent.children[tinfo.name] = copy;
  }
  return code;
}, 'cp - copy files and directories\n\nUsage: cp [OPTION]... SOURCE... DEST\n\n  -r     copy directories recursively');

register('mv', async (ctx, args) => {
  const { rest } = parseFlags(args);
  if (rest.length < 2) { ctx.err(`mv: missing ${rest.length ? 'destination ' : ''}file operand\n`); return 1; }
  const destPath = resolvePath(ctx, rest[rest.length - 1]);
  const sources = rest.slice(0, -1);
  const destNode = ctx.fs.lookup(destPath);
  const destIsDir = destNode && destNode.type === 'dir';
  if (sources.length > 1 && !destIsDir) { ctx.err(`mv: target '${rest[rest.length - 1]}' is not a directory\n`); return 1; }
  let code = 0;
  for (const src of sources) {
    const sp = resolvePath(ctx, src);
    const snode = ctx.fs.lookup(sp, false);
    if (!snode) { ctx.err(`mv: cannot stat '${src}': No such file or directory\n`); code = 1; continue; }
    const sinfo = ctx.fs.parentOf(sp);
    if (!ctx.fs.can(sinfo.parent, 'w', ctx.user)) { ctx.err(`mv: cannot move '${src}': Permission denied\n`); code = 1; continue; }
    if (!ctx.fs.canDelete(sinfo.parent, snode, ctx.user)) { ctx.err(`mv: cannot move '${src}': Operation not permitted\n`); code = 1; continue; }
    const target = destIsDir ? destPath + '/' + sp.split('/').pop() : destPath;
    const tinfo = ctx.fs.parentOf(target);
    if (!tinfo) { ctx.err(`mv: cannot move '${src}' to '${rest[rest.length - 1]}': No such file or directory\n`); code = 1; continue; }
    if (!ctx.fs.can(tinfo.parent, 'w', ctx.user)) { ctx.err(`mv: cannot move '${src}' to '${target}': Permission denied\n`); code = 1; continue; }
    tinfo.parent.children[tinfo.name] = snode;
    snode.mtime = Date.now();
    ctx.fs.remove(sp);
  }
  return code;
}, 'mv - move (rename) files\n\nUsage: mv [OPTION]... SOURCE... DEST');

register('ln', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (rest.length < 2) { ctx.err('ln: missing file operand\n'); return 1; }
  if (!flags.has('s')) { ctx.err('ln: hard links are not supported in this environment; use ln -s\n'); return 1; }
  const target = rest[0];
  const linkPath = resolvePath(ctx, rest[1]);
  if (ctx.fs.exists(linkPath)) { ctx.err(`ln: failed to create symbolic link '${rest[1]}': File exists\n`); return 1; }
  ctx.fs.symlink(linkPath, target, { owner: ctx.user, group: ctx.user, mode: 0o777 });
  return 0;
}, 'ln - make links between files\n\nUsage: ln -s TARGET LINK_NAME\n\n  -s     make symbolic links instead of hard links');

register('chmod', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  // -R may have been eaten as flag; symbolic modes like +x also start with + so they stay in rest
  let modeArg = rest[0];
  if (!modeArg) { ctx.err('chmod: missing operand\n'); return 1; }
  // numeric flags like -x get eaten by parseFlags; handle raw args for chmod
  const raw = args.filter(a => a !== '-R' && a !== '--recursive');
  const recursive = flags.has('R');
  modeArg = raw[0];
  const files = raw.slice(1);
  if (!files.length) { ctx.err(`chmod: missing operand after '${modeArg}'\n`); return 1; }

  const applyMode = (node) => {
    if (/^[0-7]{3,4}$/.test(modeArg)) {
      node.mode = parseInt(modeArg, 8); // 4-digit modes carry setuid/setgid/sticky
      return true;
    }
    const m = modeArg.match(/^([ugoa]*)([+-=])([rwxst]+)$/);
    if (!m) return false;
    const who = m[1] || 'a';
    const op = m[2];
    let bits = 0;
    if (m[3].includes('r')) bits |= 4;
    if (m[3].includes('w')) bits |= 2;
    if (m[3].includes('x')) bits |= 1;
    const shifts = [];
    if (who.includes('u') || who.includes('a')) shifts.push(6);
    if (who.includes('g') || who.includes('a')) shifts.push(3);
    if (who.includes('o') || who.includes('a')) shifts.push(0);
    for (const s of shifts) {
      if (op === '+') node.mode |= (bits << s);
      else if (op === '-') node.mode &= ~(bits << s);
      else node.mode = (node.mode & ~(7 << s)) | (bits << s);
    }
    // special bits: u+s setuid, g+s setgid, +t sticky
    if (m[3].includes('s')) {
      let sp = 0;
      if (who.includes('u')) sp |= 0o4000;
      if (who.includes('g')) sp |= 0o2000;
      if (!who.includes('u') && !who.includes('g')) sp |= 0o2000;
      if (op === '+') node.mode |= sp;
      else if (op === '-') node.mode &= ~sp;
    }
    if (m[3].includes('t')) {
      if (op === '+') node.mode |= 0o1000;
      else if (op === '-') node.mode &= ~0o1000;
    }
    return true;
  };

  let code = 0;
  const walk = (node) => {
    applyMode(node);
    if (node.type === 'dir') for (const c of Object.values(node.children)) walk(c);
  };
  for (const path of files) {
    const node = ctx.fs.lookup(resolvePath(ctx, path));
    if (!node) { ctx.err(`chmod: cannot access '${path}': No such file or directory\n`); code = 1; continue; }
    if (ctx.user !== 'root' && node.owner !== ctx.user) { ctx.err(`chmod: changing permissions of '${path}': Operation not permitted\n`); code = 1; continue; }
    if (!applyMode(node)) { ctx.err(`chmod: invalid mode: '${modeArg}'\n`); return 1; }
    if (recursive && node.type === 'dir') for (const c of Object.values(node.children)) walk(c);
  }
  return code;
}, 'chmod - change file mode bits\n\nUsage: chmod [OPTION]... MODE FILE...\n\nMODE can be octal (e.g. 755, 644) or symbolic (e.g. u+x, go-w, a=r)\n\n  -R     change files and directories recursively');

register('chown', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (rest.length < 2) { ctx.err('chown: missing operand\n'); return 1; }
  if (ctx.user !== 'root') { ctx.err(`chown: changing ownership of '${rest[1]}': Operation not permitted\n`); return 1; }
  const [owner, group] = rest[0].split(':');
  const walk = (node) => {
    node.owner = owner || node.owner;
    if (group) node.group = group;
    if (node.type === 'dir' && flags.has('R')) for (const c of Object.values(node.children)) walk(c);
  };
  let code = 0;
  for (const path of rest.slice(1)) {
    const node = ctx.fs.lookup(resolvePath(ctx, path));
    if (!node) { ctx.err(`chown: cannot access '${path}': No such file or directory\n`); code = 1; continue; }
    walk(node);
  }
  return code;
}, 'chown - change file owner and group\n\nUsage: chown [OPTION]... OWNER[:GROUP] FILE...\n\n  -R     operate on files and directories recursively');

register('stat', async (ctx, args) => {
  const { rest } = parseFlags(args);
  if (!rest.length) { ctx.err('stat: missing operand\n'); return 1; }
  for (const path of rest) {
    const p = resolvePath(ctx, path);
    const node = ctx.fs.lookup(p, false);
    if (!node) { ctx.err(`stat: cannot statx '${path}': No such file or directory\n`); return 1; }
    const type = node.type === 'dir' ? 'directory' : node.type === 'link' ? 'symbolic link' : 'regular file';
    const d = new Date(node.mtime);
    const dstr = d.toISOString().replace('T', ' ').replace('Z', '.000000000 +0000');
    ctx.out(`  File: ${path}${node.type === 'link' ? ' -> ' + node.target : ''}\n`);
    ctx.out(`  Size: ${ctx.fs.sizeOf(node)}\t\tBlocks: 8          IO Block: 4096   ${type}\n`);
    ctx.out(`Device: 801h/2049d\tInode: ${Math.floor(Math.random() * 900000) + 100000}  Links: ${node.nlink}\n`);
    ctx.out(`Access: (0${node.mode.toString(8)}/${ctx.fs.modeString(node)})  Uid: (${node.owner === 'root' ? ' 0/    root' : '1000/ student'})   Gid: (${node.group === 'root' ? ' 0/    root' : '1000/ student'})\n`);
    ctx.out(`Access: ${dstr}\nModify: ${dstr}\nChange: ${dstr}\n Birth: ${dstr}\n`);
  }
  return 0;
}, 'stat - display file or file system status\n\nUsage: stat FILE...');

register('file', async (ctx, args) => {
  const { rest } = parseFlags(args);
  if (!rest.length) { ctx.err('Usage: file [FILE...]\n'); return 1; }
  for (const path of rest) {
    const node = ctx.fs.lookup(resolvePath(ctx, path), false);
    if (!node) { ctx.out(`${path}: cannot open \`${path}' (No such file or directory)\n`); continue; }
    let desc;
    if (node.type === 'dir') desc = 'directory';
    else if (node.type === 'link') desc = `symbolic link to ${node.target}`;
    else if ((node.content || '').startsWith('\x7fELF')) desc = 'ELF 64-bit LSB pie executable, x86-64';
    else if (node.content === '') desc = 'empty';
    else if (node.content.startsWith('#!')) desc = `${node.content.split('\n')[0].slice(2).trim()} script, ASCII text executable`;
    else desc = 'ASCII text';
    ctx.out(`${path}: ${desc}\n`);
  }
  return 0;
}, 'file - determine file type\n\nUsage: file FILE...');

register('find', async (ctx, args) => {
  let startPath = '.', namePat = null, typeFilter = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-name' || args[i] === '-iname') namePat = { pat: args[++i], ci: args[i - 1] === '-iname' };
    else if (args[i] === '-type') typeFilter = args[++i];
    else if (!args[i].startsWith('-')) positional.push(args[i]);
  }
  if (positional.length) startPath = positional[0];
  const p = resolvePath(ctx, startPath);
  const start = ctx.fs.lookup(p);
  if (!start) { ctx.err(`find: '${startPath}': No such file or directory\n`); return 1; }
  let re = null;
  if (namePat) {
    re = new RegExp('^' + namePat.pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', namePat.ci ? 'i' : '');
  }
  const matches = (name, node) => {
    if (re && !re.test(name)) return false;
    if (typeFilter === 'f' && node.type !== 'file') return false;
    if (typeFilter === 'd' && node.type !== 'dir') return false;
    if (typeFilter === 'l' && node.type !== 'link') return false;
    return true;
  };
  const walk = (displayPath, node, name) => {
    if (matches(name, node)) ctx.out(displayPath + '\n');
    if (node.type === 'dir') {
      if (!ctx.fs.can(node, 'r', ctx.user)) {
        ctx.err(`find: '${displayPath}': Permission denied\n`);
        return;
      }
      for (const childName of Object.keys(node.children).sort()) {
        walk(displayPath + '/' + childName, node.children[childName], childName);
      }
    }
  };
  const rootName = p === '/' ? '/' : p.split('/').pop();
  if (matches(rootName, start)) ctx.out(startPath + '\n');
  else if (!namePat && !typeFilter) ctx.out(startPath + '\n');
  if (start.type === 'dir') {
    for (const childName of Object.keys(start.children).sort()) {
      walk((startPath === '/' ? '' : startPath) + '/' + childName, start.children[childName], childName);
    }
  }
  return 0;
}, 'find - search for files in a directory hierarchy\n\nUsage: find [PATH] [EXPRESSION]\n\n  -name PATTERN   file name matches shell pattern PATTERN\n  -iname PATTERN  like -name, but case insensitive\n  -type [fdl]     file is of type: f=regular file, d=directory, l=symlink');

register('tree', async (ctx, args) => {
  const { rest } = parseFlags(args);
  const startPath = rest[0] || '.';
  const p = resolvePath(ctx, startPath);
  const start = ctx.fs.lookup(p);
  if (!start) { ctx.err(`${startPath} [error opening dir]\n`); return 1; }
  ctx.out(startPath + '\n');
  let dirs = 0, files = 0;
  const walk = (node, prefix) => {
    const names = Object.keys(node.children).filter(n => !n.startsWith('.')).sort();
    names.forEach((name, i) => {
      const child = node.children[name];
      const isLast = i === names.length - 1;
      ctx.out(prefix + (isLast ? '└── ' : '├── ') + colorName(ctx.fs, child, name) + '\n');
      if (child.type === 'dir') {
        dirs++;
        walk(child, prefix + (isLast ? '    ' : '│   '));
      } else files++;
    });
  };
  if (start.type === 'dir') walk(start, '');
  ctx.out(`\n${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}\n`);
  return 0;
}, 'tree - list contents of directories in a tree-like format\n\nUsage: tree [DIRECTORY]');

register('du', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  const path = rest[0] || '.';
  const p = resolvePath(ctx, path);
  const node = ctx.fs.lookup(p);
  if (!node) { ctx.err(`du: cannot access '${path}': No such file or directory\n`); return 1; }
  const human = flags.has('h');
  const fmt = (kb) => human ? (kb < 1024 ? kb + 'K' : (kb / 1024).toFixed(1) + 'M') : String(kb);
  const sizeOf = (n) => {
    let s = Math.max(4, Math.ceil(ctx.fs.sizeOf(n) / 1024));
    if (n.type === 'dir') for (const c of Object.values(n.children)) s += sizeOf(c);
    return s;
  };
  if (flags.has('s')) { ctx.out(`${fmt(sizeOf(node))}\t${path}\n`); return 0; }
  const walk = (n, display) => {
    if (n.type !== 'dir') return;
    for (const [name, c] of Object.entries(n.children)) {
      if (c.type === 'dir') walk(c, display + '/' + name);
    }
    ctx.out(`${fmt(sizeOf(n))}\t${display}\n`);
  };
  walk(node, path);
  return 0;
}, 'du - estimate file space usage\n\nUsage: du [OPTION]... [FILE]...\n\n  -h     print sizes in human readable format\n  -s     display only a total for each argument');

register('df', async (ctx, args) => {
  const { flags } = parseFlags(args);
  if (flags.has('h')) {
    ctx.out('Filesystem      Size  Used Avail Use% Mounted on\n');
    ctx.out('/dev/sda1        40G  8.2G   30G  22% /\n');
    ctx.out('tmpfs           2.0G     0  2.0G   0% /dev/shm\n');
    ctx.out('tmpfs           394M  1.2M  393M   1% /run\n');
  } else {
    ctx.out('Filesystem     1K-blocks    Used Available Use% Mounted on\n');
    ctx.out('/dev/sda1       41152736 8598340  30435020  22% /\n');
    ctx.out('tmpfs            2015132       0   2015132   0% /dev/shm\n');
    ctx.out('tmpfs             403028    1204    401824   1% /run\n');
  }
  return 0;
}, 'df - report file system disk space usage\n\nUsage: df [OPTION]...\n\n  -h     print sizes in human readable format');

/* ================= system info ================= */

register('whoami', async (ctx) => { ctx.out(ctx.user + '\n'); return 0; },
  'whoami - print effective user name');

register('id', async (ctx, args) => {
  const target = args.filter(a => !a.startsWith('-'))[0] || ctx.user;
  if (target === 'root') ctx.out('uid=0(root) gid=0(root) groups=0(root)\n');
  else if (target === 'student') ctx.out('uid=1000(student) gid=1000(student) groups=1000(student),4(adm),24(cdrom),27(sudo),46(plugdev)\n');
  else { ctx.err(`id: '${target}': no such user\n`); return 1; }
  return 0;
}, 'id - print real and effective user and group IDs\n\nUsage: id [USER]');

register('groups', async (ctx) => {
  ctx.out(ctx.user === 'root' ? 'root\n' : 'student adm cdrom sudo plugdev\n');
  return 0;
}, 'groups - print the groups a user is in');

register('hostname', async (ctx) => { ctx.out(ctx.env.HOSTNAME + '\n'); return 0; },
  'hostname - show or set the system host name');

register('uname', async (ctx, args) => {
  const { flags } = parseFlags(args);
  if (flags.has('a')) ctx.out('Linux linuxlab 5.15.0-105-generic #115-Ubuntu SMP Mon Apr 15 09:52:04 UTC 2024 x86_64 x86_64 x86_64 GNU/Linux\n');
  else if (flags.has('r')) ctx.out('5.15.0-105-generic\n');
  else if (flags.has('m')) ctx.out('x86_64\n');
  else if (flags.has('n')) ctx.out('linuxlab\n');
  else if (flags.has('o')) ctx.out('GNU/Linux\n');
  else ctx.out('Linux\n');
  return 0;
}, 'uname - print system information\n\nUsage: uname [OPTION]...\n\n  -a     print all information\n  -r     print the kernel release\n  -m     print the machine hardware name\n  -n     print the network node hostname');

register('date', async (ctx, args) => {
  const d = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  if (args[0] && args[0].startsWith('+')) {
    let f = args[0].slice(1);
    f = f.replace(/%Y/g, d.getFullYear()).replace(/%m/g, pad(d.getMonth() + 1))
         .replace(/%d/g, pad(d.getDate())).replace(/%H/g, pad(d.getHours()))
         .replace(/%M/g, pad(d.getMinutes())).replace(/%S/g, pad(d.getSeconds()))
         .replace(/%A/g, ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()])
         .replace(/%B/g, ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]);
    ctx.out(f + '\n');
    return 0;
  }
  const tz = /\(([^)]+)\)/.exec(d.toString());
  const tzAbbr = tz ? tz[1].split(' ').map(w => w[0]).join('') : 'UTC';
  ctx.out(`${days[d.getDay()]} ${mons[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${tzAbbr} ${d.getFullYear()}\n`);
  return 0;
}, 'date - print or set the system date and time\n\nUsage: date [+FORMAT]\n\nFORMAT sequences: %Y year, %m month, %d day, %H hour, %M minute, %S second');

register('cal', async (ctx, args) => {
  const now = new Date();
  const year = args[1] ? parseInt(args[1]) : now.getFullYear();
  const month = args[0] && !isNaN(parseInt(args[0])) ? parseInt(args[0]) - 1 : now.getMonth();
  const mons = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const header = `${mons[month]} ${year}`;
  ctx.out(header.padStart(Math.floor((20 + header.length) / 2)).padEnd(20) + '\n');
  ctx.out('Su Mo Tu We Th Fr Sa\n');
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  let line = '   '.repeat(first);
  for (let d = 1; d <= days; d++) {
    line += String(d).padStart(2) + ' ';
    if ((first + d) % 7 === 0) { ctx.out(line.trimEnd() + '\n'); line = ''; }
  }
  if (line.trim()) ctx.out(line.trimEnd() + '\n');
  return 0;
}, 'cal - display a calendar\n\nUsage: cal [MONTH] [YEAR]');

register('uptime', async (ctx) => {
  const secs = Math.floor((Date.now() - ctx.shell.startTime) / 1000) + 4523;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  ctx.out(` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} up  ${h}:${pad(m)},  1 user,  load average: 0.08, 0.03, 0.01\n`);
  return 0;
}, 'uptime - tell how long the system has been running');

register('free', async (ctx, args) => {
  const { flags } = parseFlags(args);
  if (flags.has('h')) {
    ctx.out('               total        used        free      shared  buff/cache   available\n');
    ctx.out('Mem:           3.8Gi       748Mi       2.4Gi       1.0Mi       680Mi       3.1Gi\n');
    ctx.out('Swap:          2.0Gi          0B       2.0Gi\n');
  } else {
    ctx.out('               total        used        free      shared  buff/cache   available\n');
    ctx.out('Mem:         4030264      766120     2560648        1024      696860     3202520\n');
    ctx.out('Swap:        2097148           0     2097148\n');
  }
  return 0;
}, 'free - display amount of free and used memory in the system\n\nUsage: free [OPTION]\n\n  -h     show human-readable output');

register('ps', async (ctx, args) => {
  const boot = ctx.shell.startTime;
  const t = (offset) => {
    const d = new Date(boot + offset);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const hasAux = args.includes('aux') || args.includes('-aux') || (args.includes('a') && args.includes('u'));
  const hasEf = args.includes('-ef');
  if (hasAux || hasEf) {
    ctx.out('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n');
    ctx.out(`root           1  0.0  0.3 167404 11924 ?        Ss   ${t(0)}   0:02 /sbin/init\n`);
    ctx.out(`root         412  0.0  0.5  47480 20488 ?        Ss   ${t(2000)}   0:00 /lib/systemd/systemd-journald\n`);
    ctx.out(`root         568  0.0  0.2 289316  9812 ?        Ssl  ${t(3000)}   0:00 /usr/lib/accountsservice/accounts-daemon\n`);
    ctx.out(`root         801  0.0  0.1  15424  7044 ?        Ss   ${t(4000)}   0:00 sshd: /usr/sbin/sshd -D\n`);
    ctx.out(`syslog       610  0.0  0.1 222404  5220 ?        Ssl  ${t(3500)}   0:00 /usr/sbin/rsyslogd -n\n`);
    ctx.out(`${ctx.user.padEnd(9)}   1102  0.0  0.1  17232  5488 ?        Ss   ${t(6000)}   0:00 sshd: ${ctx.user}@pts/0\n`);
    ctx.out(`${ctx.user.padEnd(9)}   1103  0.0  0.1  10344  5348 pts/0    Ss   ${t(6100)}   0:00 -bash\n`);
    ctx.out(`${ctx.user.padEnd(9)}   ${String(1200 + ctx.shell.history.length).padStart(4)}  0.0  0.0  10620  3384 pts/0    R+   ${t(Date.now() - boot)}   0:00 ps ${args.join(' ')}\n`);
  } else {
    ctx.out('    PID TTY          TIME CMD\n');
    ctx.out('   1103 pts/0    00:00:00 bash\n');
    ctx.out(`   ${1200 + ctx.shell.history.length} pts/0    00:00:00 ps\n`);
  }
  return 0;
}, 'ps - report a snapshot of the current processes\n\nUsage: ps [OPTION]\n\n  aux    show all processes (BSD syntax)\n  -ef    show all processes (standard syntax)');

register('top', async (ctx) => {
  ctx.out('top - interactive process viewer is not available in this lab environment.\n');
  ctx.out("Try 'ps aux' to see a process snapshot.\n");
  return 0;
}, 'top - display Linux processes (use ps aux in this environment)');

register('kill', async (ctx, args) => {
  // separate signal flags (-9, -SIGHUP, -s SIG) from pid/job args
  const pids = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-s' || a === '-n') { i++; continue; }
    if (a.startsWith('-')) continue; // signal spec
    pids.push(a);
  }
  if (!pids.length) { ctx.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec\n'); return 2; }
  let code = 0;
  for (const pid of pids) {
    const job = ctx.shell.findJob(pid);
    if (job) {
      job.ctrl.kill();
      continue;
    }
    if (['1103', '1102', '1', '412', '568', '801', '610'].includes(pid)) {
      if (ctx.user !== 'root' && ['1', '412', '568', '801', '610'].includes(pid)) {
        ctx.err(`bash: kill: (${pid}) - Operation not permitted\n`);
        code = 1;
      }
      // else: silently "kills" — no visible effect for the static system pids
    } else {
      ctx.err(`bash: kill: (${pid}) - No such process\n`);
      code = 1;
    }
  }
  return code;
}, 'kill - send a signal to a process\n\nUsage: kill [-9|-SIGHUP] PID...\n       kill %N          (kill job number N)');

/* ================= environment ================= */

register('echo', async (ctx, args) => {
  let newline = true, interpret = false;
  while (args[0] === '-n' || args[0] === '-e') {
    if (args[0] === '-n') newline = false;
    if (args[0] === '-e') interpret = true;
    args = args.slice(1);
  }
  let s = args.join(' ');
  if (interpret) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  ctx.out(s + (newline ? '\n' : ''));
  return 0;
}, 'echo - display a line of text\n\nUsage: echo [OPTION]... [STRING]...\n\n  -n     do not output the trailing newline\n  -e     enable interpretation of backslash escapes');

register('printf', async (ctx, args) => {
  if (!args.length) { ctx.err('printf: usage: printf format [arguments]\n'); return 2; }
  let f = args[0].replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  let i = 1;
  f = f.replace(/%[sd]/g, () => args[i++] || '');
  ctx.out(f);
  return 0;
}, 'printf - format and print data\n\nUsage: printf FORMAT [ARGUMENT]...');

register('env', async (ctx) => {
  for (const [k, v] of Object.entries(ctx.env)) ctx.out(`${k}=${v}\n`);
  return 0;
}, 'env - print environment variables');

register('printenv', async (ctx, args) => {
  if (args.length) {
    for (const name of args) {
      if (ctx.env[name] !== undefined) ctx.out(ctx.env[name] + '\n');
    }
    return 0;
  }
  for (const [k, v] of Object.entries(ctx.env)) ctx.out(`${k}=${v}\n`);
  return 0;
}, 'printenv - print all or part of environment\n\nUsage: printenv [VARIABLE]');

register('export', async (ctx, args) => {
  if (!args.length) {
    for (const [k, v] of Object.entries(ctx.env)) ctx.out(`declare -x ${k}="${v}"\n`);
    return 0;
  }
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq === -1) continue;
    ctx.env[a.slice(0, eq)] = a.slice(eq + 1);
  }
  return 0;
}, 'export - set export attribute for shell variables\n\nUsage: export NAME=VALUE');

register('unset', async (ctx, args) => {
  for (const a of args) delete ctx.env[a];
  return 0;
}, 'unset - unset values of shell variables\n\nUsage: unset NAME...');

register('alias', async (ctx, args) => {
  if (!args.length) {
    for (const [k, v] of Object.entries(ctx.shell.aliases).sort()) ctx.out(`alias ${k}='${v}'\n`);
    return 0;
  }
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq === -1) {
      if (ctx.shell.aliases[a]) ctx.out(`alias ${a}='${ctx.shell.aliases[a]}'\n`);
      else { ctx.err(`bash: alias: ${a}: not found\n`); return 1; }
    } else {
      ctx.shell.aliases[a.slice(0, eq)] = a.slice(eq + 1).replace(/^['"]|['"]$/g, '');
    }
  }
  return 0;
}, "alias - define or display aliases\n\nUsage: alias [name[=value]...]\n\nExample: alias ll='ls -alF'");

register('unalias', async (ctx, args) => {
  for (const a of args) {
    if (ctx.shell.aliases[a]) delete ctx.shell.aliases[a];
    else { ctx.err(`bash: unalias: ${a}: not found\n`); return 1; }
  }
  return 0;
}, 'unalias - remove alias definitions\n\nUsage: unalias NAME...');

register('which', async (ctx, args) => {
  if (!args.length) return 1;
  let code = 0;
  for (const name of args) {
    if (Commands[name]) {
      const bin = ctx.fs.exists('/bin/' + name) ? '/bin/' + name
        : ctx.fs.exists('/usr/bin/' + name) ? '/usr/bin/' + name : '/usr/bin/' + name;
      ctx.out(bin + '\n');
    } else code = 1;
  }
  return code;
}, 'which - locate a command\n\nUsage: which COMMAND...');

register('whereis', async (ctx, args) => {
  for (const name of args) {
    const paths = [];
    if (ctx.fs.exists('/bin/' + name)) paths.push('/bin/' + name);
    if (ctx.fs.exists('/usr/bin/' + name)) paths.push('/usr/bin/' + name);
    if (Commands[name]) paths.push(`/usr/share/man/man1/${name}.1.gz`);
    ctx.out(`${name}: ${paths.join(' ')}\n`);
  }
  return 0;
}, 'whereis - locate the binary, source, and manual page files for a command');

register('history', async (ctx, args) => {
  if (args[0] === '-c') { ctx.shell.history.length = 0; return 0; }
  const start = args[0] ? Math.max(0, ctx.shell.history.length - parseInt(args[0])) : 0;
  ctx.shell.history.slice(start).forEach((h, i) => {
    ctx.out(`${String(start + i + 1).padStart(5)}  ${h}\n`);
  });
  return 0;
}, 'history - display the command history list\n\nUsage: history [N]\n\n  -c     clear the history list');

/* ================= users / privilege ================= */

register('su', async (ctx, args) => {
  const dashLogin = args.includes('-') || args.includes('-l');
  const target = args.filter(a => !a.startsWith('-') || a === '-')[0] === '-'
    ? (args.filter(a => a !== '-' && a !== '-l')[0] || 'root')
    : (args.filter(a => !a.startsWith('-'))[0] || 'root');
  const entry = ctx.shell.userdb[target];
  if (!entry) { ctx.err(`su: user ${target} does not exist or the user entry does not contain all the required fields\n`); return 1; }
  const doSwitch = () => {
    ctx.shell.userStack.push({ user: ctx.shell.user, cwd: ctx.shell.cwd });
    ctx.shell.becomeUser(target);
    if (dashLogin) ctx.shell.cwd = ctx.shell.env.HOME;
  };
  if (ctx.user === 'root' || target === ctx.user) { doSwitch(); return 0; }
  const pw = await ctx.term.readSecret('Password: ');
  if (entry.pw !== null && pw === entry.pw) { doSwitch(); return 0; }
  ctx.err('su: Authentication failure\n');
  return 1;
}, "su - run a command with substitute user\n\nUsage: su [-] [USER]\n\nWith no USER, switches to root. Type 'exit' to return to the previous user.");

let sudoAuthed = false;
register('sudo', async (ctx, args) => {
  if (!args.length) { ctx.err('usage: sudo -h | -K | -k | -V\nusage: sudo [command]\n'); return 1; }
  if (ctx.user === 'root') {
    // already root, just run
  } else {
    if (!ctx.shell.groupsOf(ctx.user).includes('sudo')) {
      if (!sudoAuthed) await ctx.term.readSecret(`[sudo] password for ${ctx.user}: `);
      ctx.err(`${ctx.user} is not in the sudoers file.  This incident will be reported.\n`);
      return 1;
    }
    if (!sudoAuthed) {
      const expected = (ctx.shell.userdb[ctx.user] || {}).pw;
      const pw = await ctx.term.readSecret(`[sudo] password for ${ctx.user}: `);
      if (pw !== expected) {
        ctx.err('Sorry, try again.\n');
        const pw2 = await ctx.term.readSecret(`[sudo] password for ${ctx.user}: `);
        if (pw2 !== expected) {
          ctx.err('sudo: 2 incorrect password attempts\n');
          return 1;
        }
      }
      sudoAuthed = true;
    }
  }
  // run command as root
  const savedUser = ctx.shell.user;
  ctx.shell.user = 'root';
  const subCtx = { ...ctx, user: 'root', cwd: ctx.shell.cwd, sudoRealUser: savedUser };
  let code;
  try {
    if (args[0] === 'su' && args.length === 1) {
      ctx.shell.userStack.push({ user: savedUser, cwd: ctx.shell.cwd });
      ctx.shell.becomeUser('root');
      return 0;
    }
    code = await ctx.shell.runCommand(subCtx, args);
  } finally {
    // don't restore if the command opened a root session (sudo su / docker exec)
    if (args[0] !== 'su' && !ctx.shell.containerCtx && ctx.shell.user === 'root') {
      ctx.shell.user = savedUser;
    }
  }
  return code;
}, 'sudo - execute a command as another user (root)\n\nUsage: sudo COMMAND [ARG]...\n\nsudo su   become root');

register('exit', async (ctx) => {
  if (ctx.shell.containerCtx) {
    // leave a docker exec session
    const saved = ctx.shell.containerCtx.saved;
    ctx.shell.fs = saved.fs;
    ctx.shell.fs.groupLookup = (u) => ctx.shell.groupsOf(u);
    ctx.shell.user = saved.user;
    ctx.shell.cwd = saved.cwd;
    Object.assign(ctx.shell.env, saved.env);
    ctx.shell.containerCtx = null;
    ctx.out('exit\n');
    return 0;
  }
  if (ctx.shell.userStack.length) {
    const prev = ctx.shell.userStack.pop();
    ctx.shell.becomeUser(prev.user);
    ctx.shell.cwd = prev.cwd;
    ctx.out('exit\n');
    return 0;
  }
  ctx.out('logout\n\nThis is a lab session — the terminal stays open. (In a real shell, the window would close.)\n');
  return 0;
}, 'exit - exit the shell (returns to the previous user after su, or leaves a container)');

register('logout', Commands['exit'] ? Commands['exit'].fn : async () => 0, 'logout - exit a login shell');

register('passwd', async (ctx, args) => {
  const target = args.filter(a => !a.startsWith('-'))[0] || ctx.user;
  const db = ctx.shell.userdb;
  if (!db[target]) { ctx.err(`passwd: user '${target}' does not exist\n`); return 1; }
  if (target !== ctx.user && ctx.user !== 'root') {
    ctx.err(`passwd: You may not view or modify password information for ${target}.\n`); return 1;
  }
  ctx.out(`Changing password for ${target}.\n`);
  if (ctx.user !== 'root') {
    const cur = await ctx.term.readSecret('Current password: ');
    if (cur !== db[target].pw) { ctx.err('passwd: Authentication token manipulation error\npasswd: password unchanged\n'); return 1; }
  }
  const p1 = await ctx.term.readSecret('New password: ');
  const p2 = await ctx.term.readSecret('Retype new password: ');
  if (p1 !== p2) { ctx.err('Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\n'); return 1; }
  if (!p1) { ctx.err('No password has been supplied.\npasswd: password unchanged\n'); return 1; }
  db[target].pw = p1;
  ctx.out('passwd: password updated successfully\n');
  return 0;
}, 'passwd - change user password\n\nUsage: passwd [USER]\n\nChanging another user\'s password requires root (use sudo).');

register('useradd', async (ctx, args) => {
  if (ctx.user !== 'root') { ctx.err('useradd: Permission denied.\nuseradd: cannot lock /etc/passwd; try again later.\n'); return 1; }
  const { rest } = parseFlags(args);
  const name = rest[rest.length - 1];
  if (!name) { ctx.err('Usage: useradd [options] LOGIN\n'); return 2; }
  const passwd = ctx.fs.lookup('/etc/passwd');
  if (passwd.content.includes(`\n${name}:`) || passwd.content.startsWith(`${name}:`)) {
    ctx.err(`useradd: user '${name}' already exists\n`); return 9;
  }
  // next free uid/gid >= 1001
  let uid = 1001;
  const used = new Set(passwd.content.split('\n').map(l => parseInt(l.split(':')[2])).filter(n => !isNaN(n)));
  while (used.has(uid)) uid++;
  passwd.content += `${name}:x:${uid}:${uid}::/home/${name}:/bin/bash\n`;
  const group = ctx.fs.lookup('/etc/group');
  if (group && !group.content.split('\n').some(l => l.startsWith(name + ':'))) {
    group.content += `${name}:x:${uid}:\n`;
  }
  const shadow = ctx.fs.lookup('/etc/shadow');
  if (shadow) shadow.content += `${name}:!:19908:0:99999:7:::\n`;
  ctx.shell.userdb[name] = { pw: null };
  if (args.includes('-m')) {
    ctx.fs.mkdir(`/home/${name}`, { owner: name, group: name });
    ctx.fs.writeFile(`/home/${name}/.bashrc`, '# ~/.bashrc\n', { owner: name, group: name });
    ctx.fs.writeFile(`/home/${name}/.bash_history`, '', { owner: name, group: name, mode: 0o600 });
  }
  return 0;
}, 'useradd - create a new user\n\nUsage: useradd [options] LOGIN\n\n  -m     create the user home directory\n\nRequires root (use sudo).');

register('adduser', Commands['useradd'].fn, 'adduser - add a user to the system (see useradd)');

register('userdel', async (ctx, args) => {
  if (ctx.user !== 'root') { ctx.err('userdel: Permission denied.\n'); return 1; }
  const name = args.filter(a => !a.startsWith('-'))[0];
  if (!name) { ctx.err('Usage: userdel [options] LOGIN\n'); return 2; }
  const passwd = ctx.fs.lookup('/etc/passwd');
  const lines = passwd.content.split('\n').filter(l => l && !l.startsWith(name + ':'));
  if (lines.length === passwd.content.split('\n').filter(Boolean).length) {
    ctx.err(`userdel: user '${name}' does not exist\n`); return 6;
  }
  passwd.content = lines.join('\n') + '\n';
  return 0;
}, 'userdel - delete a user account\n\nUsage: userdel LOGIN\n\nRequires root (use sudo).');

register('groupadd', async (ctx, args) => {
  if (ctx.user !== 'root') { ctx.err('groupadd: Permission denied.\n'); return 1; }
  const name = args.filter(a => !a.startsWith('-'))[0];
  if (!name) { ctx.err('Usage: groupadd [options] GROUP\n'); return 2; }
  const group = ctx.fs.lookup('/etc/group');
  group.content += `${name}:x:${1001 + (group.content.match(/\n/g) || []).length}:\n`;
  return 0;
}, 'groupadd - create a new group\n\nUsage: groupadd GROUP\n\nRequires root (use sudo).');

/* ================= networking (simulated) ================= */

register('ping', async (ctx, args) => {
  const { rest } = parseFlags(args);
  const host = rest[0];
  if (!host) { ctx.err('ping: usage error: Destination address required\n'); return 1; }
  const ip = host === 'localhost' ? '127.0.0.1' : host.match(/^\d+\.\d+\.\d+\.\d+$/) ? host : '93.184.215.14';
  let count = 4;
  const cIdx = args.indexOf('-c');
  if (cIdx !== -1) count = parseInt(args[cIdx + 1]) || 4;
  count = Math.min(count, 10);
  ctx.out(`PING ${host} (${ip}) 56(84) bytes of data.\n`);
  const times = [];
  for (let i = 1; i <= count; i++) {
    const t = (0.3 + Math.random() * 20).toFixed(1);
    times.push(parseFloat(t));
    await new Promise(r => setTimeout(r, 200));
    ctx.term.write(`64 bytes from ${ip}: icmp_seq=${i} ttl=64 time=${t} ms\n`);
  }
  const min = Math.min(...times).toFixed(3), max = Math.max(...times).toFixed(3);
  const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(3);
  ctx.out(`\n--- ${host} ping statistics ---\n`);
  ctx.out(`${count} packets transmitted, ${count} received, 0% packet loss, time ${count * 1000 - 800}ms\n`);
  ctx.out(`rtt min/avg/max/mdev = ${min}/${avg}/${max}/2.110 ms\n`);
  return 0;
}, 'ping - send ICMP ECHO_REQUEST to network hosts\n\nUsage: ping [-c COUNT] DESTINATION\n\n  -c COUNT   stop after sending COUNT packets (default 4 here)');

register('ip', async (ctx, args) => {
  const sub = args[0];
  if (sub === 'a' || sub === 'addr' || sub === 'address') {
    ctx.out('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n');
    ctx.out('    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n');
    ctx.out('    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n');
    ctx.out('2: enp0s3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n');
    ctx.out('    link/ether 08:00:27:8d:c0:4d brd ff:ff:ff:ff:ff:ff\n');
    ctx.out('    inet 10.0.2.15/24 brd 10.0.2.255 scope global dynamic enp0s3\n       valid_lft 85942sec preferred_lft 85942sec\n');
    return 0;
  }
  if (sub === 'r' || sub === 'route') {
    ctx.out('default via 10.0.2.2 dev enp0s3 proto dhcp src 10.0.2.15 metric 100\n');
    ctx.out('10.0.2.0/24 dev enp0s3 proto kernel scope link src 10.0.2.15 metric 100\n');
    return 0;
  }
  ctx.err('Usage: ip [ OPTIONS ] OBJECT { COMMAND }\nwhere  OBJECT := { address | route | link }\n');
  return 1;
}, 'ip - show / manipulate routing, network devices\n\nUsage: ip addr | ip route');

register('ifconfig', async (ctx) => {
  ctx.out('enp0s3: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n');
  ctx.out('        inet 10.0.2.15  netmask 255.255.255.0  broadcast 10.0.2.255\n');
  ctx.out('        ether 08:00:27:8d:c0:4d  txqueuelen 1000  (Ethernet)\n');
  ctx.out('        RX packets 1420  bytes 1834027 (1.8 MB)\n        TX packets 968  bytes 84512 (84.5 KB)\n\n');
  ctx.out('lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n');
  ctx.out('        inet 127.0.0.1  netmask 255.0.0.0\n        loop  txqueuelen 1000  (Local Loopback)\n');
  return 0;
}, 'ifconfig - configure a network interface (display only here)');

const netStub = (name) => async (ctx, args) => {
  ctx.err(`${name}: network access is not available in this lab environment\n`);
  return 1;
};
register('wget', netStub('wget'), 'wget - network downloader (network disabled in lab)');
register('curl', netStub('curl'), 'curl - transfer a URL (network disabled in lab)');
register('ssh', async (ctx, args) => {
  const host = args.filter(a => !a.startsWith('-'))[0] || '';
  ctx.err(`ssh: connect to host ${host.includes('@') ? host.split('@')[1] : host || 'unknown'} port 22: Network is unreachable\n`);
  return 255;
}, 'ssh - OpenSSH remote login client (network disabled in lab)');

/* ================= package management (simulated) ================= */

register('apt', async (ctx, args) => {
  const sub = args[0];
  if ((sub === 'install' || sub === 'update' || sub === 'upgrade' || sub === 'remove') && ctx.user !== 'root') {
    ctx.err('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n');
    ctx.err('E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n');
    return 100;
  }
  if (sub === 'update') {
    ctx.out('Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease\n');
    ctx.out('Hit:2 http://archive.ubuntu.com/ubuntu jammy-updates InRelease\n');
    ctx.out('Hit:3 http://archive.ubuntu.com/ubuntu jammy-security InRelease\n');
    ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\n');
    ctx.out('All packages are up to date.\n');
    return 0;
  }
  if (sub === 'install') {
    const pkg = args[1] || '';
    if (!pkg) { ctx.err('E: Unable to locate package\n'); return 100; }
    ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
    ctx.out(`${pkg} is already the newest version (simulated).\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n`);
    return 0;
  }
  ctx.out('apt 2.4.12 (amd64)\nUsage: apt [options] command\n\nMost used commands:\n  update  install  remove  upgrade  list  search\n');
  return 0;
}, 'apt - command-line package manager\n\nUsage: sudo apt update | sudo apt install PKG\n\n(Package operations are simulated in this lab.)');
register('apt-get', Commands['apt'].fn, 'apt-get - APT package handling utility (see apt)');

const powerStub = (name) => async (ctx) => {
  if (ctx.user !== 'root') {
    ctx.err(`${name}: Permission denied. Try 'sudo ${name}'.\n`);
    return 1;
  }
  ctx.out(`${name}: this is a lab environment — the system will not actually ${name === 'reboot' ? 'reboot' : 'shut down'}.\nUse the Reset button in the lab panel to restart the environment.\n`);
  return 0;
};
register('reboot', powerStub('reboot'), 'reboot - reboot the machine (disabled in lab)');
register('shutdown', powerStub('shutdown'), 'shutdown - power off the machine (disabled in lab)');
register('poweroff', powerStub('poweroff'), 'poweroff - power off the machine (disabled in lab)');

/* ================= archives ================= */

register('tar', async (ctx, args) => {
  const flagStr = (args[0] || '').replace(/^-/, '');
  const rest = args.slice(1);
  if (flagStr.includes('c') && flagStr.includes('f')) {
    const archive = rest[0];
    const files = rest.slice(1);
    if (!archive || !files.length) { ctx.err('tar: Cowardly refusing to create an empty archive\n'); return 2; }
    const entries = [];
    for (const f of files) {
      const p = resolvePath(ctx, f);
      const node = ctx.fs.lookup(p);
      if (!node) { ctx.err(`tar: ${f}: Cannot stat: No such file or directory\n`); return 2; }
      const collect = (n, name) => {
        entries.push({ name, type: n.type, content: n.content, mode: n.mode });
        if (flagStr.includes('v')) ctx.out(name + (n.type === 'dir' ? '/' : '') + '\n');
        if (n.type === 'dir') for (const [cn, c] of Object.entries(n.children)) collect(c, name + '/' + cn);
      };
      collect(node, f.replace(/\/$/, ''));
    }
    ctx.fs.writeFile(resolvePath(ctx, archive), 'TARBALL:' + JSON.stringify(entries),
      { owner: ctx.user, group: ctx.user });
    return 0;
  }
  if ((flagStr.includes('x') || flagStr.includes('t')) && flagStr.includes('f')) {
    const archive = rest[0];
    const node = ctx.fs.lookup(resolvePath(ctx, archive));
    if (!node) { ctx.err(`tar: ${archive}: Cannot open: No such file or directory\n`); return 2; }
    if (!node.content || !node.content.startsWith('TARBALL:')) {
      ctx.err(`tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n`);
      return 2;
    }
    const entries = JSON.parse(node.content.slice(8));
    for (const e of entries) {
      if (flagStr.includes('t') || flagStr.includes('v')) ctx.out(e.name + (e.type === 'dir' ? '/' : '') + '\n');
      if (flagStr.includes('x')) {
        const p = resolvePath(ctx, e.name);
        if (e.type === 'dir') { if (!ctx.fs.exists(p)) ctx.fs.mkdir(p, { owner: ctx.user, group: ctx.user, mode: e.mode }); }
        else ctx.fs.writeFile(p, e.content || '', { owner: ctx.user, group: ctx.user, mode: e.mode });
      }
    }
    return 0;
  }
  ctx.err("tar: You must specify one of the '-Acdtrux' options\nTry 'tar --help' for more information.\n");
  return 2;
}, 'tar - an archiving utility\n\nUsage:\n  tar -cvf archive.tar FILE...   create archive\n  tar -xvf archive.tar           extract archive\n  tar -tvf archive.tar           list archive contents');

register('gzip', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  for (const f of rest) {
    const p = resolvePath(ctx, f);
    if (flags.has('d')) {
      const node = ctx.fs.lookup(p.endsWith('.gz') ? p : p + '.gz');
      const src = p.endsWith('.gz') ? p : p + '.gz';
      if (!node) { ctx.err(`gzip: ${f}: No such file or directory\n`); return 1; }
      ctx.fs.writeFile(src.slice(0, -3), (node.content || '').replace(/^GZIP:/, ''), { owner: ctx.user, group: ctx.user });
      ctx.fs.remove(src);
    } else {
      const node = ctx.fs.lookup(p);
      if (!node) { ctx.err(`gzip: ${f}: No such file or directory\n`); return 1; }
      ctx.fs.writeFile(p + '.gz', 'GZIP:' + (node.content || ''), { owner: ctx.user, group: ctx.user });
      ctx.fs.remove(p);
    }
  }
  return 0;
}, 'gzip - compress or expand files\n\nUsage: gzip FILE (compress)\n       gzip -d FILE.gz (decompress)');
register('gunzip', async (ctx, args) => Commands['gzip'].fn(ctx, ['-d', ...args]),
  'gunzip - decompress files (same as gzip -d)');

/* ================= editors ================= */

register('nano', async (ctx, args) => {
  const path = args.filter(a => !a.startsWith('-'))[0];
  if (!path) { ctx.err('nano: no file name given (this emulator requires a filename)\n'); return 1; }
  const p = resolvePath(ctx, path);
  const node = ctx.fs.lookup(p);
  if (node && node.type === 'dir') { ctx.err(`nano: ${path}: Is a directory\n`); return 1; }
  if (node && !ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`nano: ${path}: Permission denied\n`); return 1; }
  const info = ctx.fs.parentOf(p);
  if (!info) { ctx.err(`nano: ${path}: No such file or directory\n`); return 1; }
  const canWrite = node ? ctx.fs.can(node, 'w', ctx.user) : ctx.fs.can(info.parent, 'w', ctx.user);
  const result = await ctx.term.openEditor('nano', path, node ? node.content || '' : '', canWrite);
  if (result.saved && canWrite) {
    ctx.fs.writeFile(p, result.content, { owner: ctx.user, group: ctx.user });
  }
  return 0;
}, 'nano - a simple text editor\n\nUsage: nano FILE\n\nInside nano: Ctrl+O save, Ctrl+X exit');

const viFn = async (ctx, args) => {
  const path = args.filter(a => !a.startsWith('-'))[0];
  if (!path) { ctx.err('vim: this emulator requires a filename (vim FILE)\n'); return 1; }
  const p = resolvePath(ctx, path);
  const node = ctx.fs.lookup(p);
  if (node && node.type === 'dir') { ctx.err(`vim: ${path}: Is a directory\n`); return 1; }
  if (node && !ctx.fs.can(node, 'r', ctx.user)) { ctx.err(`vim: ${path}: Permission denied\n`); return 1; }
  const info = ctx.fs.parentOf(p);
  if (!info) { ctx.err(`vim: ${path}: No such file or directory\n`); return 1; }
  const canWrite = node ? ctx.fs.can(node, 'w', ctx.user) : ctx.fs.can(info.parent, 'w', ctx.user);
  const result = await ctx.term.openEditor('vi', path, node ? node.content || '' : '', canWrite);
  if (result.saved && canWrite) {
    ctx.fs.writeFile(p, result.content, { owner: ctx.user, group: ctx.user });
  }
  return 0;
};
register('vi', viFn, 'vi - screen-oriented text editor\n\nUsage: vi FILE\n\nPress i to insert, Esc then :wq to save and quit, :q! to quit without saving');
register('vim', viFn, 'vim - Vi IMproved, a text editor\n\nUsage: vim FILE\n\nPress i to insert, Esc then :wq to save and quit, :q! to quit without saving');

/* ================= misc ================= */

register('clear', async (ctx) => { ctx.term.clear(); return 0; },
  'clear - clear the terminal screen');

register('sleep', async (ctx, args) => {
  const secs = parseFloat(args[0]) || 0;
  const end = Date.now() + secs * 1000;
  // signal-aware: honors Ctrl+C (kill) and Ctrl+Z (pause) via ctx.ctrl
  while (Date.now() < end) {
    const c = ctx.ctrl;
    if (c) {
      if (c.killed) return 130;
      if (c.paused) await c.waitResume();
      if (c.killed) return 130;
    }
    await new Promise(r => setTimeout(r, 60));
  }
  return 0;
}, 'sleep - delay for a specified amount of time\n\nUsage: sleep SECONDS');

register('man', async (ctx, args) => {
  const name = args.filter(a => !a.startsWith('-'))[0];
  if (!name) { ctx.err('What manual page do you want?\nFor example, try \'man ls\'.\n'); return 1; }
  const cmd = Commands[name];
  if (!cmd || !cmd.man) { ctx.err(`No manual entry for ${name}\n`); return 16; }
  const title = name.toUpperCase() + '(1)';
  const center = 'User Commands';
  const width = 78;
  const pad = Math.max(1, Math.floor((width - title.length * 2 - center.length) / 2));
  ctx.out(title + ' '.repeat(pad) + center + ' '.repeat(pad) + title + '\n\n');
  const lines = cmd.man.split('\n');
  ctx.out('NAME\n       ' + lines[0] + '\n');
  if (lines.length > 1) {
    ctx.out('\nDESCRIPTION\n');
    for (const l of lines.slice(1)) ctx.out(l ? '       ' + l + '\n' : '\n');
  }
  ctx.out('\n' + ' '.repeat(width - title.length) + title + '\n');
  return 0;
}, 'man - an interface to the system reference manuals\n\nUsage: man COMMAND');

register('help', async (ctx) => {
  ctx.out('GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\n');
  ctx.out('These shell commands are available in this lab environment.\n');
  ctx.out("Type 'man <command>' to learn about a specific command.\n\n");
  const names = Object.keys(Commands).sort();
  const cols = 5, w = 16;
  for (let i = 0; i < names.length; i += cols) {
    ctx.out(names.slice(i, i + cols).map(n => n.padEnd(w)).join('') + '\n');
  }
  return 0;
}, 'help - display available commands');

register('lab', async (ctx, args) => {
  if (window.LabManager) return window.LabManager.labCommand(ctx, args);
  ctx.err('lab: lab system not loaded\n');
  return 1;
}, 'lab - lab exercise controls\n\nUsage:\n  lab list          show all labs\n  lab start N       begin lab N\n  lab status        show progress in current lab\n  lab hint          show a hint for the current task\n  lab reset         reset the current lab');

register('seq', async (ctx, args) => {
  const nums = args.map(Number);
  let start = 1, end = 1, step = 1;
  if (nums.length === 1) end = nums[0];
  else if (nums.length === 2) { start = nums[0]; end = nums[1]; }
  else if (nums.length >= 3) { start = nums[0]; step = nums[1]; end = nums[2]; }
  const out = [];
  for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
    out.push(i);
    if (out.length > 10000) break;
  }
  ctx.out(out.join('\n') + '\n');
  return 0;
}, 'seq - print a sequence of numbers\n\nUsage: seq [FIRST [INCREMENT]] LAST');

register('yes', async (ctx, args) => {
  const s = args.join(' ') || 'y';
  ctx.out((s + '\n').repeat(20) + '^C\n(yes output truncated in this environment)\n');
  return 0;
}, 'yes - output a string repeatedly (truncated here)');

register('true', async () => 0, 'true - do nothing, successfully');
register('false', async () => 1, 'false - do nothing, unsuccessfully');

register('basename', async (ctx, args) => {
  if (!args.length) { ctx.err('basename: missing operand\n'); return 1; }
  let name = args[0].replace(/\/+$/, '').split('/').pop();
  if (args[1] && name.endsWith(args[1])) name = name.slice(0, -args[1].length);
  ctx.out(name + '\n');
  return 0;
}, 'basename - strip directory and suffix from filenames');

register('dirname', async (ctx, args) => {
  if (!args.length) { ctx.err('dirname: missing operand\n'); return 1; }
  const p = args[0].replace(/\/+$/, '');
  const idx = p.lastIndexOf('/');
  ctx.out((idx === -1 ? '.' : idx === 0 ? '/' : p.slice(0, idx)) + '\n');
  return 0;
}, 'dirname - strip last component from file name');

register('lsb_release', async (ctx, args) => {
  const { flags } = parseFlags(args);
  if (flags.has('a')) {
    ctx.out('No LSB modules are available.\nDistributor ID:\tUbuntu\nDescription:\tUbuntu 22.04.4 LTS\nRelease:\t22.04\nCodename:\tjammy\n');
  } else {
    ctx.out('No LSB modules are available.\n');
  }
  return 0;
}, 'lsb_release - print distribution-specific information\n\nUsage: lsb_release -a');

register('w', async (ctx) => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  ctx.out(` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} up  1:15,  1 user,  load average: 0.08, 0.03, 0.01\n`);
  ctx.out('USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n');
  ctx.out(`${ctx.user.padEnd(8)} pts/0    10.0.2.2         ${pad(d.getHours() - 1)}:${pad(d.getMinutes())}    0.00s  0.05s  0.00s w\n`);
  return 0;
}, 'w - show who is logged on and what they are doing');

register('who', async (ctx) => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  ctx.out(`${ctx.user.padEnd(8)} pts/0        ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours() - 1)}:${pad(d.getMinutes())} (10.0.2.2)\n`);
  return 0;
}, 'who - show who is logged on');

register('diff', async (ctx, args) => {
  const { flags, rest } = parseFlags(args);
  if (rest.length < 2) { ctx.err('diff: missing operand\n'); return 2; }
  const a = ctx.fs.lookup(resolvePath(ctx, rest[0]));
  const b = ctx.fs.lookup(resolvePath(ctx, rest[1]));
  if (!a) { ctx.err(`diff: ${rest[0]}: No such file or directory\n`); return 2; }
  if (!b) { ctx.err(`diff: ${rest[1]}: No such file or directory\n`); return 2; }
  const la = (a.content || '').replace(/\n$/, '').split('\n');
  const lb = (b.content || '').replace(/\n$/, '').split('\n');
  if (a.content === b.content) return 0;
  // naive line diff
  let out = '';
  const max = Math.max(la.length, lb.length);
  for (let i = 0; i < max; i++) {
    if (la[i] !== lb[i]) {
      if (la[i] !== undefined && lb[i] !== undefined) {
        out += `${i + 1}c${i + 1}\n< ${la[i]}\n---\n> ${lb[i]}\n`;
      } else if (la[i] !== undefined) {
        out += `${i + 1}d${i}\n< ${la[i]}\n`;
      } else {
        out += `${la.length}a${i + 1}\n> ${lb[i]}\n`;
      }
    }
  }
  ctx.out(out);
  return 1;
}, 'diff - compare files line by line\n\nUsage: diff FILE1 FILE2');

register('type', async (ctx, args) => {
  let code = 0;
  for (const name of args) {
    if (ctx.shell.aliases[name]) ctx.out(`${name} is aliased to \`${ctx.shell.aliases[name]}'\n`);
    else if (['cd', 'pwd', 'echo', 'export', 'alias', 'history', 'exit', 'type', 'help'].includes(name)) ctx.out(`${name} is a shell builtin\n`);
    else if (Commands[name]) ctx.out(`${name} is /usr/bin/${name}\n`);
    else { ctx.err(`bash: type: ${name}: not found\n`); code = 1; }
  }
  return code;
}, 'type - display information about command type');
