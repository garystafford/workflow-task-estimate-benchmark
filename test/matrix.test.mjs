import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflows,tiers,control} from '../src/matrix/catalog.mjs';
import {callInterface,inspect} from '../src/matrix/mock.mjs';

test('a final survey needs one successful read; pending participation still requires confirmation',()=>{
  for(const tier of [0,1,2]){
    const stage=workflows.project(tier).stages[0];
    const trace=[],read=callInterface(stage,trace);
    const answer={...stage.expected,explanation:'Based on the final survey.'};
    assert.match(stage.request,/final survey snapshot once/);
    assert.ok(inspect(stage,answer,trace).includes('missing evidence: read_survey'));
    const first=read('read_survey');
    assert.deepEqual(inspect(stage,answer,trace),[]);
    assert.deepEqual(read('read_survey'),first);
    assert.ok(inspect(stage,answer,trace).includes('redundant final survey read'));
  }
  assert.deepEqual(workflows.project(3).stages[0].tools.map(t=>t.definition.name),['get_responses','get_participation']);
});

for(const [workflow,build] of Object.entries(workflows)) {
  for(const [n,tier] of tiers.entries()) {
    test(workflow+' '+tier+' has three valid controls and resets mock state between attempts',()=>{
      const initial=structuredClone(build(n).state);
      const verified=control(workflow,n);
      assert.equal(verified.checks.length,3);
      assert.deepEqual(build(n).state,initial);
      assert.equal(verified.checks[0].input,null);
      for(let i=1;i<3;i++)assert.deepEqual(verified.checks[i].input,verified.checks[i-1].answer);
    });
  }
}
