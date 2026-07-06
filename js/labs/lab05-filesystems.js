/* Lab 5 — based on Exercise 11.1: partitioning, formatting, and mounting a USB drive. */
'use strict';

defineLab({
  id: 'lab05',
  title: 'Lab 5: Experimenting with Filesystems (Ex 11.1)',
  intro: 'A USB memory stick (/dev/sdb) is plugged into this system and was auto-mounted. Repartition it, create an ext4 filesystem, and mount it in your home directory. All data on the stick will be erased — that is the point!',

  setup(fs, shell) {
    shell.sys.usb = {
      present: true, device: 'sdb', model: 'Cruzer Blade', vendor: 'SanDisk Corp.',
      size: '7.5G',
      partitions: [{ num: 1, fs: 'vfat', size: '7.5G', label: 'USBDATA' }],
      mountedAt: '/media/student/USBDATA', userMountedAt: null, repartitioned: false,
      luks: { formatted: false, opened: false, pass: null, mapper: null },
    };
    shell.ensureDeviceNodes();
    fs.remove('/home/student/mediatest1');
  },

  tasks: [
    {
      text: 'Check the kernel messages to find the device name assigned to the USB stick',
      hint: 'Type: dmesg | tail — look for the [sdb] lines near the end.',
      check: (c) => c.line.includes('dmesg') && c.line.includes('tail') && c.code === 0,
    },
    {
      text: 'Unmount the auto-mounted USB partition',
      hint: 'Type: sudo umount /dev/sdb1',
      check: (c) => !c.shell.sys.usb.mountedAt && !c.shell.sys.usb.userMountedAt,
    },
    {
      text: 'Use fdisk on /dev/sdb to delete the old partition, create a new primary partition 1, and write the table',
      hint: 'Type: sudo fdisk /dev/sdb — then use p (print), d (delete), n (new: p, 1, Enter, Enter), and w (write).',
      check: (c) => c.shell.sys.usb.repartitioned === true,
    },
    {
      text: 'Create an ext4 filesystem on the new partition',
      hint: 'Type: sudo mkfs -t ext4 /dev/sdb1',
      check: (c) => {
        const p = c.shell.sys.usb.partitions[0];
        return p && p.fs === 'ext4';
      },
    },
    {
      text: 'Create a mount point named mediatest1 in your home directory',
      hint: 'Type: mkdir mediatest1 (while in /home/student).',
      check: (c) => {
        const n = c.fs.lookup('/home/student/mediatest1');
        return n && n.type === 'dir';
      },
    },
    {
      text: 'Mount the new filesystem on mediatest1',
      hint: 'Type: sudo mount -t ext4 /dev/sdb1 mediatest1',
      check: (c) => c.shell.sys.usb.userMountedAt === '/home/student/mediatest1',
    },
    {
      text: 'List the contents of the freshly mounted filesystem',
      hint: 'Type: ls mediatest1 — a new ext4 filesystem contains only lost+found.',
      check: (c) => c.argv[0] === 'ls' && c.line.includes('mediatest1') && c.code === 0,
    },
    {
      text: 'Unmount the USB stick so it can be removed safely',
      hint: 'Type: sudo umount /dev/sdb1',
      check: (c) => !c.shell.sys.usb.userMountedAt && c.shell.sys.usb.partitions[0].fs === 'ext4',
    },
  ],
});
