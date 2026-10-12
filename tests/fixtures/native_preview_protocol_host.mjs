import readline from 'node:readline';

// Test child protocol only: no Windows preview handlers, files or dialogs.
readline.createInterface({input: process.stdin}).on('line', line => {
  const [id, command, ...args] = line.split('\t');
  if (command === 'DIE') { process.exit(7); return; }
  if (command === 'SILENT') return;
  const message = command === 'PING' ? 'PONG' : command === 'EXIT' ? 'BYE' : args.join('|') || command;
  process.stdout.write(`${id}\tOK\t${message}\r\n`, () => { if (command === 'EXIT') process.exit(0); });
});
