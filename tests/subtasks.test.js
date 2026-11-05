import test from 'node:test';
import assert from 'node:assert/strict';
import {validSubtasks,toggleSubtask,completeSubtasks,subtaskProgress} from '../public/subtasks.js';
const now='2026-11-04T03:22:00.000Z';
const items=[{id:'a',title:'第一讲1',completed:false,completedAt:''},{id:'b',title:'第一讲2',completed:false,completedAt:''}];
test('completion time belongs to each child and can be undone',()=>{
  const next=toggleSubtask(items,'a',now);assert.equal(next[0].completedAt,now);assert.equal(next[1].completed,false);assert.equal(items[0].completed,false);assert.deepEqual(subtaskProgress(next),{total:2,done:1});assert.equal(toggleSubtask(next,'a')[0].completedAt,'');
});
test('complete parent preserves existing child timestamps, undo clears all',()=>{
  const next=completeSubtasks(toggleSubtask(items,'a',now),true,'2026-11-04T04:00:00.000Z');assert.equal(next[0].completedAt,now);assert.equal(next[1].completed,true);assert(completeSubtasks(next,false).every(item=>!item.completed&&!item.completedAt));
});
test('old records remain valid, malformed or duplicated subtasks rejected',()=>{
  assert(validSubtasks(undefined));assert(validSubtasks(items));assert(!validSubtasks([...items,items[0]]));assert(!validSubtasks([{...items[0],title:' '} ]));assert(!validSubtasks([{...items[0],completed:true,completedAt:'broken'}]));assert(!validSubtasks([{...items[0],completedAt:now}]));
});
