import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarQueueObservation} from '../netunim-orders/site/assets/js/calendar/queue-observation.js';

test('A queue receipt closes before a write begins and stays closed after it settles',()=>{
  const queue=createCalendarQueueObservation(),receipt=queue.capture();assert.equal(receipt(),true);
  const settle=queue.beginWrite();assert.equal(receipt(),false);assert.equal(queue.isSettled(),false);
  assert.equal(settle(),true);assert.equal(receipt(),false);assert.equal(queue.capture()(),true);
});
test('An in-flight write cannot produce a current receipt even after its completion',()=>{
  const queue=createCalendarQueueObservation(),settle=queue.beginWrite(),receipt=queue.capture();
  assert.equal(receipt(),false);settle();assert.equal(receipt(),false);assert.equal(queue.capture()(),true);
});
test('Overlapping successful or aborted writes drain exactly once',()=>{
  const queue=createCalendarQueueObservation(),first=queue.beginWrite(),second=queue.beginWrite();
  first();assert.equal(first(),false);assert.equal(queue.isSettled(),false);assert.equal(queue.capture()(),false);
  second();assert.equal(second(),false);assert.equal(queue.isSettled(),true);assert.equal(queue.capture()(),true);
});
