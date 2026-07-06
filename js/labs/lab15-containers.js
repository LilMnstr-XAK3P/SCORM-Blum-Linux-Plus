/* Lab 15 — based on Exercise 29.1: deploying an Apache web server in a
   Docker container. */
'use strict';

defineLab({
  id: 'lab15',
  title: 'Lab 15: Working with Containers (Ex 29.1)',
  intro: 'Install Docker, pull the httpd (Apache) container image, run it with a published port, verify the web server responds, shell into the container, and clean everything up. The book checks the port in a browser; here curl does the same job.',

  setup(fs, shell) {
    shell.sys.dockerInstalled = false;
    shell.sys.packages.delete('docker');
    shell.sys.docker = { pulled: new Set(), containers: {} };
  },

  tasks: [
    {
      text: 'Install the Docker software from the package repository',
      hint: 'Type: sudo apt install docker',
      check: (c) => c.shell.sys.dockerInstalled,
    },
    {
      text: 'Confirm Docker is running by listing containers (none yet)',
      hint: 'Type: sudo docker ps',
      check: (c) => c.line.includes('docker') && c.line.includes('ps') && c.code === 0,
    },
    {
      text: 'Pull the Apache web server container image',
      hint: 'Type: sudo docker pull docker.io/library/httpd:latest (or simply: sudo docker pull httpd)',
      check: (c) => c.shell.sys.docker.pulled.has('httpd'),
    },
    {
      text: 'Deploy the image as a container named myApache, publishing container port 80 as host port 8088',
      hint: 'Type: sudo docker run -d -t -p 8088:80 --name myApache httpd — Docker prints the new container ID.',
      check: (c) => {
        const k = c.shell.sys.docker.containers.myApache;
        return k && k.running && k.port === '8088:80';
      },
    },
    {
      text: 'Verify the container is up and shows the port mapping',
      hint: 'Type: sudo docker ps',
      check: (c) => c.line.includes('docker') && c.line.includes('ps') &&
        c.shell.sys.docker.containers.myApache && c.shell.sys.docker.containers.myApache.running,
    },
    {
      text: 'Connect to the web server through the published port',
      hint: 'Type: curl http://localhost:8088 — Apache answers with its "It works!" page.',
      check: (c) => c.argv[0] === 'curl' && c.line.includes('8088') && c.code === 0,
    },
    {
      text: 'Open an interactive Bash shell inside the running container',
      hint: 'Type: sudo docker exec -i -t myApache bash — the prompt changes to root@<container-id> in /usr/local/apache2. Look around: ls htdocs',
      check: (c) => c.shell.containerCtx !== null && c.shell.containerCtx !== undefined && !!c.shell.containerCtx,
    },
    {
      text: 'Leave the container shell and return to the host',
      hint: 'Type: exit',
      check: (c) => !c.shell.containerCtx,
    },
    {
      text: 'Stop the running container',
      hint: 'Type: sudo docker stop myApache',
      check: (c) => {
        const k = c.shell.sys.docker.containers.myApache;
        return k && !k.running;
      },
    },
    {
      text: 'Remove the container, then remove the image',
      hint: 'Type: sudo docker rm myApache and then sudo docker rmi httpd',
      check: (c) => !c.shell.sys.docker.containers.myApache &&
        !c.shell.sys.docker.pulled.has('httpd'),
    },
  ],
});
