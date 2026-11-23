import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryRecord} from '../src/matrix/booking-access.mjs';
import {stageEvidence} from '../src/matrix/judge-context.mjs';
import {workflows} from '../src/matrix/catalog.mjs';

test('resource discovery preserves successful empty listings separately from failures and unknown result formats',()=>{
  for(const [name,key] of [['list_mcp_resources','resources'],['list_mcp_resource_templates','resourceTemplates']]){
    const item={type:'mcp_call',name,status:'completed',output:{content:[{type:'text',text:JSON.stringify({[key]:[]})}]}};
    assert.deepEqual(discoveryRecord(item),{tool:name,status:'completed',error:null,returned:0});
    item.output.content[0].text='No structured listing';
    assert.equal(discoveryRecord(item).returned,undefined);
    item.status='failed';item.error='unavailable';
    assert.equal(discoveryRecord(item).error,'unavailable');
  }
  assert.equal(discoveryRecord({type:'function_call',name:'get_offers'}),null);
});

test('the booking judge receives only the access evidence for that worker and turn',()=>{
  const stage=workflows.shipment(2,'regional-waiver').stages[2];
  const step={sessionId:'s',turnId:'t',request:{},trace:[]};
  const access={sessionId:'s',turnId:'t',environment:'none',directTools:['get_offers'],discovery:[]};
  assert.deepEqual(stageEvidence(stage,step,undefined,access).hostedAccess,
    {environment:'none',directTools:['get_offers'],discovery:[]});
  assert.throws(()=>stageEvidence(stage,step,undefined,{...access,turnId:'other'}));
  assert.throws(()=>stageEvidence(stage,step,undefined,{...access,sessionId:'other'}));
});
