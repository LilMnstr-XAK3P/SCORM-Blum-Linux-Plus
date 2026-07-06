/* Lab 11 — based on Exercise 23.1: observing kernel messages and device files
   when a USB storage device is attached and removed. */
'use strict';

defineLab({
  id: 'lab11',
  title: 'Lab 11: Adding a USB Storage Device (Ex 23.1)',
  intro: 'A USB memory stick was just plugged into this system. Trace how the kernel saw it (dmesg), how it appears in the device tables (lsusb, lsblk, /dev), then eject it and watch those entries disappear.',

  setup(fs, shell) {
    const fresh = shell.defaultSysState();
    shell.sys.usb = fresh.usb;
    shell.sys.dmesgLog = fresh.dmesgLog;
    shell.ensureDeviceNodes();
  },

  tasks: [
    {
      text: 'List the USB controllers and devices connected to the system',
      hint: 'Type: lsusb — find the SanDisk entry for the memory stick.',
      check: (c) => c.argv[0] === 'lsusb' && c.shell.sys.usb.present && c.code === 0,
    },
    {
      text: 'View the kernel ring buffer and note the device name assigned to the stick',
      hint: 'Type: dmesg — the [sdb] lines show the detection sequence and partition (sdb1).',
      check: (c) => c.argv[0] === 'dmesg' && c.shell.sys.usb.present && c.code === 0,
    },
    {
      text: 'View the block device table, including where the partition is mounted',
      hint: 'Type: lsblk',
      check: (c) => c.argv[0] === 'lsblk' && c.shell.sys.usb.present && c.code === 0,
    },
    {
      text: 'List the SCSI device files and find the USB device among them',
      hint: 'Type: ls /dev/sd* — sdb and sdb1 are your USB stick.',
      check: (c) => c.argv[0] === 'ls' && c.line.includes('/dev/sd') && c.shell.sys.usb.present && c.code === 0,
    },
    {
      text: 'Safely eject the USB storage device',
      hint: 'Type: eject /dev/sdb — the desktop "safely remove" action does the same thing.',
      check: (c) => !c.shell.sys.usb.present,
    },
    {
      text: 'Check the kernel messages again to see the disconnect event',
      hint: 'Type: dmesg — the last line should report the USB disconnect.',
      check: (c) => c.argv[0] === 'dmesg' && !c.shell.sys.usb.present && c.code === 0,
    },
    {
      text: 'Confirm the sdb device files are gone',
      hint: 'Type: ls /dev/sd* — only sda entries should remain now.',
      check: (c) => c.argv[0] === 'ls' && c.line.includes('/dev/sd') && !c.shell.sys.usb.present,
    },
  ],
});
