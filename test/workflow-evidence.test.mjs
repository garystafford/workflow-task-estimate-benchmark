import test from 'node:test';
import assert from 'node:assert/strict';
import {workflows} from '../src/matrix/catalog.mjs';
import {callInterface,inspect} from '../src/matrix/mock.mjs';
import {stageEvidence} from '../src/matrix/judge-context.mjs';

test('a reconciled finding accepts only verified survey context in addition to all quantitative sources',()=>{
  function check(saved,returned=saved,handed=['E1','E3','B1','B2']){
    const {stages}=workflows.project(3,'case-c'),s=stages[1];
    s.handoffIssue({...stages[0].expected,evidenceIds:handed});
    const trace=[],invoke=callInterface(s,trace);const f={...s.expected,sources:saved};
    for(const name of ['get_workbook','get_adjustments','get_site_ledger'])invoke(name);
    invoke('save_finding',f);invoke('read_finding');
    return inspect(s,{...f,sources:returned,explanation:'Withhold the unreconciled leading candidate.'},trace);
  }
  const req=['ADJ-9','LED-31','WB-17'];
  assert.deepEqual(check(req),[]);
  assert.deepEqual(check([...req,'E1','E3','B1','B2']),[]);
  for(const invalid of [req.slice(1),[...req,'E2'],[...req,'X1'],[...req,'made-up'],[...req,'B1','B1']])
    assert.ok(check(invalid).includes('incorrect sources'));
  assert.ok(check([...req,'E1'],[...req,'E1'],['B1']).includes('incorrect sources'));
  assert.ok(check([...req,'B1'],req).includes('incorrect reconciled finding'));
});

test('split-deliveries settlement requires one verified posting for the approved net lines',()=>{
  const {stages,state}=workflows.invoice(1,'split-deliveries');
  const [_,rec,s]=stages;
  assert.deepEqual(rec.expected.lineAllocations.map(l=>l.payable),[100,35]);
  const trace=[],invoke=callInterface(s,trace);
  const a=invoke('read_approval');assert.equal(a.approval.revision,rec.expected.revision);
  assert.equal(a.approval.authorized,135);invoke('read_ledger');
  const answer={...s.expected,explanation:'Verified approved settlement and ledger.'};
  assert.ok(inspect(s,answer,trace).includes('wrong ledger or dispute state'));
  for(const c of s.controls)invoke(c.name,c.args);
  assert.deepEqual(inspect(s,answer,trace),[]);
  assert.deepEqual(state.postings,[{invoiceId:'AP-853',revision:'v1',amount:135}]);
  const duplicate=s.controls.find(c=>c.name==='post_ledger');invoke(duplicate.name,duplicate.args);
  invoke('read_ledger');
  assert.ok(inspect(s,answer,trace).includes('wrong ledger or dispute state'));
});

test('invoice assessors receive the actual access evidence and distinguish net allocations from pre-credit amounts',()=>{
  const [,rec,settle]=workflows.invoice(3,'case-b').stages;
  const step={sessionId:'s',turnId:'t',request:{},trace:[]};
  assert.match(stageEvidence(rec,step).evidenceInterpretation,/one mismatch/);
  const access={sessionId:'s',turnId:'t',environment:'none',directTools:settle.tools.map(t=>t.definition.name),discovery:[]};
  assert.equal(stageEvidence(settle,step,null,access).hostedAccess.environment,'none');
  assert.throws(()=>stageEvidence(settle,step,null,{...access,turnId:'other'}));
});
