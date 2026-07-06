/* Lab 9 — based on Exercise 19.1: creating a LUKS-encrypted disk.
   The book exercise uses the GNOME Disks GUI; this lab adapts it to the
   command-line cryptsetup workflow, which covers the same LUKS concepts. */
'use strict';

defineLab({
  id: 'lab09',
  title: 'Lab 9: Creating an Encrypted Disk (Ex 19.1)',
  intro: 'Encrypt the USB stick (/dev/sdb1) with LUKS so its contents can only be read after entering a passphrase. The original exercise uses the Disks GUI; here you will use cryptsetup, the command-line tool behind that GUI. Remember the passphrase you choose!',

  setup(fs, shell) {
    shell.sys.usb = {
      present: true, device: 'sdb', model: 'Cruzer Blade', vendor: 'SanDisk Corp.',
      size: '7.5G',
      partitions: [{ num: 1, fs: 'ext4', size: '7.5G', label: '' }],
      mountedAt: null, userMountedAt: null, repartitioned: false,
      luks: { formatted: false, opened: false, pass: null, mapper: null, innerFs: null, mountedAt: null },
    };
    shell.ensureDeviceNodes();
    fs.remove('/home/student/vault');
  },

  tasks: [
    {
      text: 'Encrypt the USB partition with LUKS (this destroys any existing data on it)',
      hint: "Type: sudo cryptsetup luksFormat /dev/sdb1 — confirm with YES (capitals) and choose a passphrase.",
      check: (c) => c.shell.sys.usb.luks.formatted,
    },
    {
      text: 'Unlock the encrypted partition, mapping it as "secure"',
      hint: 'Type: sudo cryptsetup luksOpen /dev/sdb1 secure — enter your passphrase. This creates /dev/mapper/secure.',
      check: (c) => c.shell.sys.usb.luks.opened && c.shell.sys.usb.luks.mapper,
    },
    {
      text: 'Create an ext4 filesystem inside the encrypted volume',
      hint: 'Type: sudo mkfs -t ext4 /dev/mapper/secure',
      check: (c) => c.shell.sys.usb.luks.innerFs === 'ext4',
    },
    {
      text: 'Create a mount point named vault in your home directory and mount the encrypted volume there',
      hint: 'Type: mkdir vault and then sudo mount /dev/mapper/secure vault',
      check: (c) => !!c.shell.sys.usb.luks.mountedAt,
    },
    {
      text: 'Create a file on the encrypted volume to prove you can write to it',
      hint: 'Try: sudo touch vault/private.txt — or redirect some text into a file there.',
      check: (c) => {
        const mp = c.shell.sys.usb.luks.mountedAt;
        if (!mp) return false;
        const dir = c.fs.lookup(mp);
        return dir && Object.keys(dir.children).some(n => n !== 'lost+found');
      },
    },
    {
      text: 'Unmount the encrypted volume',
      hint: 'Type: sudo umount /dev/mapper/secure (or sudo umount vault).',
      check: (c) => c.shell.sys.usb.luks.formatted && !c.shell.sys.usb.luks.mountedAt &&
        c.shell.sys.usb.luks.opened,
    },
    {
      text: 'Lock the volume again so the data is unreadable without the passphrase',
      hint: 'Type: sudo cryptsetup luksClose secure — /dev/mapper/secure disappears until it is unlocked again.',
      check: (c) => c.shell.sys.usb.luks.formatted && !c.shell.sys.usb.luks.opened,
    },
  ],
});
