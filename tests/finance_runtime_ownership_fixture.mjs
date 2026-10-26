import assert from 'node:assert/strict';
import {parse} from 'acorn';

function* walk(node, parents = []) {
  if (!node || typeof node.type !== 'string') return;
  yield {node, parents};
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {for (const child of value) yield* walk(child, [...parents, node]);}
    else if (value && typeof value.type === 'string') yield* walk(value, [...parents, node]);
  }
}
// Prove membership AND consumption of the actual production runtime lists.
// Comments and unused calls cannot substitute for the owning capability's join.
export function assertFinanceRuntimeJoined(source, reference) {
  const entries = [...walk(parse(source, {ecmaVersion:'latest', sourceType:'module'}))];
  const variable = name => entries.find(({node}) => node.type === 'VariableDeclarator' && node.id.name === name)?.node.init;
  const token = node => source.slice(node.start, node.end).replace(/\s+/g, '');
  const list = variable('ownedRuntimes')?.body;
  assert.equal(list?.callee?.property?.name, 'filter');
  assert.equal(list.arguments[0]?.name, 'Boolean');
  const elements = list.callee.object.elements;
  const direct = elements.filter(node => node.type !== 'SpreadElement').map(token);
  if (!direct.includes(reference)) {
    assert.ok(elements.some(node => node.type === 'SpreadElement' && token(node.argument) === 'presentation?.runtimes||[]'), 'presentation runtime list must join the common list');
    const assignment = entries.find(({node}) => node.type === 'AssignmentExpression' && node.left.name === 'presentation' && node.right.type === 'ObjectExpression')?.node.right;
    const ui = assignment?.properties.find(node => node.key.name === 'runtimes')?.value;
    assert.ok(ui?.elements.some(node => token(node) === reference), reference);
  }
  const runtime = variable('runtime');
  for (const [method, iterator] of [['isPending', 'some'], ['drain', 'map'], ['dispose', 'forEach']]) {
    const implementation = runtime.properties.find(node => node.key.name === method)?.value;
    assert.ok(implementation, method);
    const match = [...walk(implementation)].find(({node, parents}) => {
      if (node.type !== 'CallExpression' || node.callee?.property?.name !== iterator || node.callee.object?.callee?.name !== 'ownedRuntimes') return false;
      const callback = node.arguments[0], parameter = callback?.params?.[0]?.name;
      if (!parameter || ![...walk(callback.body)].some(({node:call}) => call.type === 'CallExpression' && call.callee?.object?.name === parameter && call.callee?.property?.name === method)) return false;
      if (method !== 'drain') return true;
      const all = parents.at(-1);
      return all?.type === 'CallExpression' && all.callee?.object?.name === 'Promise' && all.callee?.property?.name === 'all' && parents.at(-2)?.type === 'AwaitExpression';
    });
    assert.ok(match, `${reference}: ${method} must consume the owning runtime list`);
  }
}
