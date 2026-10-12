import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {isLoopbackPortClosed} from '../netunim-kupa/bank-bridge/loopback-port.mjs';

test('TCP closure evidence distinguishes an unresponsive HTTP listener from a refused connection',async t=>{
  const sockets=new Set(),server=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))});
  t.after(()=>{for(const socket of sockets)socket.destroy();server.close()});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const port=server.address().port;
  assert.equal(await isLoopbackPortClosed({host:'127.0.0.1',port}),false);
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>server.close(resolve));
  assert.equal(await isLoopbackPortClosed({host:'127.0.0.1',port}),true);
});
