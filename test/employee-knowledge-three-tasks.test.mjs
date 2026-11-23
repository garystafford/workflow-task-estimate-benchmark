import test from 'node:test';
import assert from 'node:assert/strict';
import {employeeKnowledge,knowledgePlan} from '../src/matrix/employee-knowledge.mjs';
import {callInterface,inspect} from '../src/matrix/mock.mjs';

test('all 13 employee questions use fact finding, policy selection, and a cited response',()=>{
  const {controls,jobs}=knowledgePlan();
  assert.equal(controls.length,13);
  assert.equal(new Set(jobs.map(j=>j.key)).size,156);
  const tiers=['Routine','Standard','Complex','Advanced'];
  for(const c of controls) {
    const {stages}=employeeKnowledge(tiers.indexOf(c.tier),c.caseSet);
    assert.deepEqual(stages.map(s=>s.id),['EK-03','EK-01','EK-02']);
    assert.ok(stages[0].tools.every(t=>['read_employee_request','open_hr_record'].includes(t.definition.name)));
    assert.ok(stages[1].tools.every(t=>!stages[0].tools.some(h=>h.definition.name===t.definition.name)));
  }
});

test('standalone policy lookup depends only on actual passed facts and followed policy references',()=>{
  const [facts,policy]=employeeKnowledge(3,'same-allowance').stages;
  const trace=[];
  const handoff={...facts.reference(callInterface(facts,trace)),explanation:'Verified records.'};
  assert.equal(handoff.transferDestination,'South');
  const skipped=trace.filter(e=>e.result.ref!=='HR-4271');
  assert.ok(inspect(facts,handoff,skipped).length);
  const changed={...handoff,transferDestination:'East',signedTransferDate:'2026-10-15'};
  policy.setInput(changed);
  const evidenceTrace=[];
  const output={...policy.reference(callInterface(policy,evidenceTrace),changed),explanation:'Applied the transfer rule.'};
  assert.deepEqual(output.possibleSites,['East']);
  assert.ok(output.sectionRefs.includes('LEARN-E.3') && !output.sectionRefs.includes('LEARN-S.7'));
  assert.ok(inspect(policy,output,evidenceTrace).includes('incorrect sectionRefs'));
  const read=callInterface(policy,[]);
  assert.throws(()=>read('lookup_office_supplement',{register:'Learning / local supplements',office:'South'}));
});
