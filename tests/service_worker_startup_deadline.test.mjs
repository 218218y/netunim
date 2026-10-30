import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mayStartApp} from '../shared/app-release-startup.js';

function fixture(t, {delayedRegistration = false, active = null} = {}) {
  t.mock.timers.enable({apis: ['setTimeout', 'Date']});
  const listeners = new Map(), previous = {state: 'activated'};
  let reply, closed = 0, blocked = 0, reloads = 0, registerDone, updateDone;
  const waiting = {state: 'installed', postMessage(_data, ports) {reply = value => ports[0].onmessage({data: {allowed: value}})}};
  const registration = {active, waiting: delayedRegistration || active ? null : waiting,
    update: () => delayedRegistration ? new Promise(resolve => {updateDone = resolve}) : Promise.resolve()};
  const serviceWorker = {controller: previous,
    register: () => delayedRegistration ? new Promise(resolve => {registerDone = () => resolve(registration)}) : Promise.resolve(registration),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => {if (listeners.get(name) === fn) listeners.delete(name)}};
  const timers = {now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  const run = mayStartApp({serviceWorker, timers, location: {reload: () => {reloads++}},
    onBlocked: () => {blocked++}, makeChannel: () => {
      const port = {onmessage: null, close: () => {closed++}};
      return {port1: port, port2: port};
    }});
  let result;
  void run.then(value => {result = value});
  return {run, registration, serviceWorker, listeners,
    registered: () => registerDone(), updated: () => updateDone(),
    reply: value => reply(value), values: () => ({result, closed, blocked, reloads})};
}

test('registration and update share one total startup deadline', async t => {
  const state = fixture(t, {delayedRegistration: true});
  t.mock.timers.tick(12000); state.registered(); await setImmediate();
  t.mock.timers.tick(8000); await setImmediate();
  assert.equal(state.values().result, true, 'Safe old release must start at the total deadline, not after a second 20s timer');
  state.updated(); await state.run;
  assert.equal(state.listeners.size, 0);
});

test('a timed-out activation request cannot authorize business code before a late reply', async t => {
  const state = fixture(t); await setImmediate();
  t.mock.timers.tick(20000); await setImmediate();
  assert.equal(await state.run, false, 'A previously sent activation may still replace the controller');
  assert.equal(state.values().blocked, 1);
  assert.ok(state.values().closed > 0);
  state.reply(true); await setImmediate();
  assert.equal(state.values().result, false);
  assert.equal(state.listeners.size, 0);
});

test('granted activation stays blocked when controller replacement exceeds the deadline', async t => {
  const state = fixture(t); await setImmediate();
  state.reply(true); await setImmediate();
  t.mock.timers.tick(20000); await setImmediate();
  assert.equal(await state.run, false);
  assert.equal(state.values().blocked, 1);
  assert.equal(state.values().reloads, 0);
});

test('a controller already activating at registration must settle before startup', async t => {
  const state = fixture(t, {active: {state: 'activating'}}); await setImmediate();
  assert.equal(state.values().result, undefined);
  state.serviceWorker.controller = state.registration.active;
  state.listeners.get('controllerchange')(); await setImmediate();
  assert.equal(await state.run, false);
  assert.equal(state.values().reloads, 1);
});
