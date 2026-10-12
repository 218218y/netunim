import {EventEmitter} from 'node:events';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

export function previewFixture(createSession, {prepare, terminate, respond} = {}) {
  const children = [], jobs = new Map(), logs = [];
  let timerId = 0, preparations = 0;
  const timers = {
    setTimeout: (callback, timeout) => { const id = ++timerId; jobs.set(id, {callback, timeout}); return id; },
    clearTimeout: id => jobs.delete(id),
  };
  function launch() {
    const child = new EventEmitter();
    child.pid = children.length + 1;
    child.killed = false;
    child.exitCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = child.stderr.setEncoding = () => {};
    child.commands = [];
    child.stdin = {writable: true, write: (line, encoding, callback) => {
      const [id, command, ...args] = line.trimEnd().split('\t');
      child.commands.push({id, command, args, line, callback});
      callback(null);
      if (respond) respond(child, {id, command, args});
      else queueMicrotask(() => child.stdout.emit('data', `${id}\tOK\t${command}-done\r\n`));
    }};
    child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('exit', 0, null); };
    children.push(child);
    return child;
  }
  const host = {
    prepare: async () => { preparations++; await prepare?.(); }, launch,
    terminate: async child => { await terminate?.(child); child.kill(); },
  };
  const session = createSession({host, timers, log: async message => logs.push(message)});
  return {session, children, jobs, logs, timers, preparations: () => preparations,
    expire: () => { for (const [id, job] of [...jobs]) { jobs.delete(id); job.callback(); } }};
}
