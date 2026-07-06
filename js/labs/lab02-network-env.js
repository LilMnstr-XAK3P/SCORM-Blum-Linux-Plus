/* Lab 2 — based on Exercise 7.1: surveying the network configuration. */
'use strict';

defineLab({
  id: 'lab02',
  title: 'Lab 2: Determining the Network Environment (Ex 7.1)',
  intro: 'Survey the network setup of this system using standard tools — interfaces, wireless, routing, name resolution, and listening services. Note the IP addresses, gateway, and open ports as you go.',

  tasks: [
    {
      text: 'Display the network interfaces and their IP addresses',
      hint: 'Type: ip address show — note the inet (IPv4) address and network mask on each interface.',
      check: (c) => c.argv[0] === 'ip' && /^(a|addr|address)$/.test(c.argv[1] || '') && c.code === 0,
    },
    {
      text: 'Scan for nearby wireless access points',
      hint: 'Type: iwlist wlan0 scan',
      check: (c) => c.argv[0] === 'iwlist' && c.line.includes('scan') && c.code === 0,
    },
    {
      text: 'Show the current wireless interface settings',
      hint: 'Type: iwconfig',
      check: (c) => c.argv[0] === 'iwconfig' && c.code === 0,
    },
    {
      text: 'Display the routing table and find the default gateway',
      hint: 'Type: route — the line starting with "default" is your gateway. (ip route works too.)',
      check: (c) => (c.argv[0] === 'route' || (c.argv[0] === 'ip' && /^r/.test(c.argv[1] || ''))) && c.code === 0,
    },
    {
      text: 'View the static hostname-to-IP map',
      hint: 'Type: cat /etc/hosts',
      check: (c) => c.line.includes('/etc/hosts') && c.code === 0,
    },
    {
      text: 'View the DNS resolver configuration',
      hint: 'Type: cat /etc/resolv.conf',
      check: (c) => c.line.includes('/etc/resolv.conf') && c.code === 0,
    },
    {
      text: 'View the name-service lookup order (files vs DNS)',
      hint: 'Type: cat /etc/nsswitch.conf — the hosts: line shows whether /etc/hosts or DNS is checked first.',
      check: (c) => c.line.includes('/etc/nsswitch.conf') && c.code === 0,
    },
    {
      text: 'List the programs listening for incoming connections',
      hint: 'Type: netstat -l — entries marked "unix" are local sockets used for inter-process communication.',
      check: (c) => c.argv[0] === 'netstat' && c.line.includes('-l') && c.code === 0,
    },
    {
      text: 'Show processes with open TCP network ports',
      hint: 'Type: sudo ss -anpt — process names appear only with root privileges.',
      check: (c) => c.line.includes('ss ') && c.line.includes('-anpt') && c.code === 0,
    },
  ],
});
