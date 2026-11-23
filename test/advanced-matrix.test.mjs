import test from 'node:test';
import assert from 'node:assert/strict';
import {advancedCases,control,workflows} from '../src/matrix/catalog.mjs';
import {referenceClients} from '../src/matrix/advanced/reference.mjs';
import {callInterface,inspect} from '../src/matrix/mock.mjs';
import {stageEvidence} from '../src/matrix/judge-context.mjs';

const tier=3;
function harness(domain,set,index) {
  const scenario=workflows[domain](tier,set);
  const stage=scenario.stages[index];
  const trace=[];
  return {scenario,stage,trace,invoke:callInterface(stage,trace)};
}
function stripNarrative(answer){
  const {explanation,...data}=answer;
  return data;
}

test('the same ledger and the same workbook independently yield opposite funding decisions when the other source changes',()=>{
  const bySet=Object.fromEntries(advancedCases.map(set=>[set,control('project',tier,set).checks]));
  const [a,b,c,d]=advancedCases.map(set=>bySet[set]);
  const source=(checks,name)=>checks[1].trace.find(t=>t.name===name).result;
  assert.deepEqual(b[0].answer,d[0].answer);
  assert.deepEqual(source(b,'get_site_ledger'),source(d,'get_site_ledger'));
  assert.deepEqual(source(b,'get_adjustments'),source(d,'get_adjustments'));
  assert.deepEqual(source(a,'get_workbook'),source(c,'get_workbook'));
  assert.deepEqual(source(a,'get_adjustments'),source(c,'get_adjustments'));
  assert.deepEqual(a[0].answer.sites,c[0].answer.sites);
  assert.deepEqual([a,b,c,d].map(s=>s[1].answer.fundingStatus),['recommend','recommend','withhold','withhold']);
  assert.deepEqual(c[1].answer.discrepancies,[{site:'Elm',workbookEvents:16,ledgerEvents:15}]);
  assert.deepEqual(d[1].answer.discrepancies,[{site:'Oak',workbookEvents:20,ledgerEvents:18}]);
  assert.ok([c,d].every(s=>s[2].answer.fundingStatus==='withhold'));
  assert.deepEqual([c[2].answer.plan,c[2].answer.feasible,c[2].answer.costUSD],['contract',true,1720]);
  assert.deepEqual([d[2].answer.plan,d[2].answer.feasible,d[2].answer.extensionDays],['phased',false,4]);
});

test('grading distinguishes signed source records and available approval authority from an approval actually issued',()=>{
  for(const set of ['case-a','case-b']){
    const stages=workflows.invoice(tier,set).stages;
    const checks=control('invoice',tier,set).checks;
    const handoff={upstream:checks[0].answer};
    const evidence=stageEvidence(stages[1],{request:handoff,trace:checks[1].trace});
    assert.deepEqual(evidence.request,handoff);
    assert.match(evidence.toolContracts.find(t=>t.name==='get_goods_records').description,/signed receipt/);
    assert.deepEqual(evidence.expectedFields,stages[1].expected);
    const settlement=stageEvidence(stages[2],{request:{upstream:checks[1].answer},trace:checks[2].trace});
    const approval=settlement.toolContracts.find(t=>t.name==='request_approval');
    assert.match(approval.description,/signed line authorization/);
    assert.ok(approval.arguments.properties.revision);
    assert.equal(settlement.observedActions.some(t=>t.name==='request_approval'),set==='case-b');
  }
});

for(const set of advancedCases){
  for(const domain of Object.keys(workflows)){
    test(domain+' '+set+' completes end to end from visible records; each isolated stage agrees',()=>{
      const result=control(domain,tier,set);
      assert.equal(result.checks.length,3);
      for(const [i,check] of result.checks.entries()){
        const {scenario,stage,trace,invoke}=harness(domain,set,i);
        const input=i?structuredClone(result.checks[i-1].answer):null;
        assert.equal(stage.handoffIssue?.(input,false)??null,null);
        const answer=referenceClients[stage.id](invoke,input,scenario.caseRef);
        assert.deepEqual(answer,stripNarrative(check.answer));
        assert.deepEqual(inspect(stage,{...answer,explanation:'Isolated local control.'},trace),[]);
      }
    });
  }
}

test('invoice authority changes despite identical attachments; credits, returns and line caps change the settlement',()=>{
  const a=control('invoice',tier,'case-a').checks,b=control('invoice',tier,'case-b').checks;
  assert.deepEqual(a[0].trace[0].result,b[0].trace[0].result);
  assert.deepEqual([a[0].answer.revision,a[0].answer.gross,a[1].answer.payable,a[1].answer.disputed],['v2',150,100,40]);
  assert.deepEqual([b[0].answer.revision,b[0].answer.gross,b[1].answer.payable,b[1].answer.disputed],['v3',120,90,20]);
  assert.equal(a[1].answer.credit,10);
  assert.deepEqual(b[1].answer.payLines.map(l=>l.amount),[50,20,20]);
  assert.equal(b[1].answer.freshApproval,true);
  assert.ok(!a[2].trace.some(e=>e.name==='request_approval'));
  assert.ok(b[2].trace.some(e=>e.name==='request_approval'));
});
test('invoice intake rejects the newest attachment without verified provenance; duplicate credits and omitted returns cannot earn a pass',()=>{
  const ctl=control('invoice',tier,'case-a').checks;
  const stages=workflows.invoice(tier,'case-a').stages;
  const forged={...ctl[0].answer,revision:'v3',source:'DOC-A04'};
  assert.ok(inspect(stages[0],forged,ctl[0].trace).includes('incorrect revision'));
  for(const changes of [{credit:20,payable:90},{payable:110,disputed:30}]){
    assert.ok(inspect(stages[1],{...ctl[1].answer,...changes},ctl[1].trace).length>0);
  }
  assert.ok(stages[2].handoffIssue({...ctl[1].answer,payable:999},true));
});
for(const [committed,missing] of [['case-a','case-c'],['case-b','case-d']]){
  test('invoice identical timeout changes retry decision for '+committed+' and '+missing,()=>{
    const a=control('invoice',tier,committed), b=control('invoice',tier,missing);
    assert.deepEqual(a.checks[0],b.checks[0]);
    if(committed==='case-a')assert.deepEqual(a.checks[1],b.checks[1]);
    const writes=x=>x.checks[2].trace.filter(e=>e.name==='post_ledger');
    assert.equal(writes(a)[0].error,writes(b)[0].error);
    assert.equal(writes(a).length,1);assert.equal(writes(b).length,2);
    if(committed==='case-a')assert.deepEqual(a.finalState,b.finalState);
    else assert.deepEqual([a.checks[1].answer.payable,b.checks[1].answer.payable],[90,75]);
  });
}
for(const [domain,set,write,read] of [
  ['invoice','case-a','post_ledger','read_ledger'],['invoice','case-c','post_ledger','read_ledger'],
  ['shipment','case-a','reserve_offer','read_carrier'],['shipment','case-c','reserve_offer','read_carrier']
]){
  test(domain+' '+set+' rejects blind retry even when it accidentally yields correct state',()=>{
    const {stage,trace,invoke}=harness(domain,set,2);
    const input=control(domain,tier,set).checks[1].answer;
    const client=(name,args)=>{
      try{return invoke(name,args);}catch(e){
        if(name===write&&/timeout/i.test(e.message))return invoke(write,args);
        throw e;
      }
    };
    try{referenceClients[stage.id](client,input);}catch{/* final system state is graded even on an operational error */}
    const issues=inspect(stage,{...stage.expected,explanation:'Reported success.'},trace);
    assert.ok(issues.includes('missing authoritative lookup before retry'));
    assert.ok(trace.some(e=>e.name===write&&e.error));
  });
}
test('invoice mock blocks superseded authorization and equal-total but incorrect line allocations before posting',()=>{
  const {scenario,stage,invoke}=harness('invoice','case-b',2);
  const stale={invoiceId:scenario.caseRef,revision:'v2',lines:[{line:'L1',amount:50},{line:'L2',amount:30},{line:'L3',amount:20}]};
  assert.throws(()=>invoke('post_ledger',stale),/authorization/);
  const wrong=[{line:'L1',amount:50},{line:'L2',amount:10},{line:'L3',amount:30}];
  assert.throws(()=>invoke('request_approval',{revision:'v3',lines:wrong}),/denied/);
  assert.deepEqual(scenario.state.postings,[]);
  const correct=control('invoice',tier,'case-b').checks[1].answer;
  assert.equal(stage.handoffIssue(correct),null);
});

test('custody reversal changes missed leg and governing regional policy despite identical initial scans',()=>{
  const a=control('shipment',tier,'case-a').checks,b=control('shipment',tier,'case-b').checks;
  assert.deepEqual(a[0].trace[0].result,b[0].trace[0].result);
  assert.deepEqual([a[0].answer.leg,a[0].answer.queue,a[1].answer.runbook,a[1].answer.capCents],['B','E-DISPATCH','E-8',60000]);
  assert.deepEqual([b[0].answer.leg,b[0].answer.queue,b[1].answer.runbook,b[1].answer.capCents],['A','W-DISPATCH','W-6',53000]);
  const stages=workflows.shipment(tier,'case-b').stages;
  for(const runbook of ['GLOBAL','W-9','E-DRAFT']){
    assert.ok(inspect(stages[1],{...b[1].answer,runbook},b[1].trace).includes('incorrect runbook'));
    assert.ok(stages[2].handoffIssue({...b[1].answer,runbook}));
  }
  assert.ok(stages[1].handoffIssue({...b[0].answer,region:'East'}));
});
test('shipping requires split, approval hold, verified retry or whole shipment, depending on evidence',()=>{
  const result=Object.fromEntries(advancedCases.map(k=>[k,control('shipment',tier,k)]));
  const last=k=>result[k].checks[2];
  assert.deepEqual(last('case-a').answer.quoteIds,['Q-73','Q-74']);
  assert.equal(last('case-a').answer.committedCents,56000);
  assert.equal(last('case-a').answer.priorityShortfallOnCheapestWhole,2);
  assert.equal(last('case-b').answer.extraApprovalCents,3000);
  assert.equal(last('case-b').answer.committedCents,0);
  assert.deepEqual(result['case-b'].finalState.notices,[]);
  assert.deepEqual(last('case-d').answer.quoteIds,['Q-71']);
  assert.equal(last('case-d').answer.proposedCents,52000);
  assert.equal(last('case-d').answer.cheapestOnTimeWholeCents,52000);
  assert.equal(last('case-a').trace.find(e=>e.error).error,last('case-c').trace.find(e=>e.error).error);
  assert.equal(last('case-a').trace.filter(e=>e.name==='reserve_offer').length,2);
  assert.equal(last('case-c').trace.filter(e=>e.name==='reserve_offer').length,3);
  assert.deepEqual(result['case-a'].finalState,result['case-c'].finalState);
});
test('a spending hold rejects attempted bookings even if the transaction fails and records look correct',()=>{
  const {stage,trace,invoke}=harness('shipment','case-b',2);
  const input=control('shipment',tier,'case-b').checks[1].answer;
  assert.throws(()=>invoke('reserve_offer',{leg:'A',runbook:'W-6',quote:'Q-72'}),/authority/);
  const answer=referenceClients[stage.id](invoke,input);
  assert.ok(inspect(stage,{...answer,explanation:'Hold.'},trace).includes('unauthorized write attempted'));
});

test('protected-leg mutations and duplicate notices fail final-state grading despite a correct structured answer',()=>{
  for(const corrupt of [
    state=>{state.bookings=state.bookings.filter(b=>b.quote!=='EXISTING');},
    state=>{state.notices.push(structuredClone(state.notices[0]));},
  ]){
    const {scenario,stage,trace,invoke}=harness('shipment','case-a',2);
    const upstream=control('shipment',tier,'case-a').checks[1].answer;
    const answer=referenceClients[stage.id](invoke,upstream);
    corrupt(scenario.state);
    assert.ok(inspect(stage,{...answer,explanation:'All confirmed.'},trace).includes('incorrect booking, dispatch or customer state'));
  }
});

test('survey and findings retain two disagreeing sites and select different packages from normalized evidence',()=>{
  for(const [set,withdrawn,winner,winnerRate] of [['case-a','Oak','ELM-FORM',16],['case-b','Elm','OAK-CHECK',18]]){
    const c=control('project',tier,set).checks;
    assert.equal(c[0].answer.withdrawn,withdrawn);
    assert.equal(c[0].answer.sites.length,2);assert.equal(c[0].answer.topics.length,2);
    assert.deepEqual(c[0].answer.disputedFrequencySites,c[0].answer.sites);
    assert.ok(!c[0].answer.evidenceIds.includes('X1')&&!c[0].answer.evidenceIds.includes('B1-copy'));
    assert.equal(c[1].answer.packageId,winner);
    assert.equal(Math.max(...c[1].answer.figures.map(f=>f.ratePercent)),winnerRate);
    assert.equal(c[1].answer.figures.find(f=>f.site==='Bay').ratePercent,12);
    const stages=workflows.project(tier,set).stages;
    assert.ok(inspect(stages[0],{...c[0].answer,sites:['Bay']},c[0].trace).includes('incorrect sites'));
    assert.ok(inspect(stages[1],{...c[1].answer,packageId:'BAY-QUEUE'},c[1].trace).includes('incorrect packageId'));
  }
});
test('wrong package IDs cannot pass through the workflow or be guessed by a downstream lookup',()=>{
  const scenario=workflows.project(tier,'case-a');
  const [survey,finding,planner]=scenario.stages;
  const use=s=>callInterface(s,[]);
  const feedback=referenceClients[survey.id](use(survey),null,scenario.caseRef);
  const saved=referenceClients[finding.id](use(finding),feedback);
  assert.throws(()=>use(finding)('save_finding',{...saved,packageId:'Elm / duplicate_entry'}),/Unknown work package/);
  for(const pkg of ['Elm / duplicate_entry','BAY-QUEUE']){
    assert.ok(planner.handoffIssue({...saved,packageId:pkg},true));
    assert.throws(()=>use(planner)('get_delivery_capacity',{packageId:'ELM-FORM'}),/differs/);
  }
  assert.equal(planner.handoffIssue(saved,true),null);
  assert.throws(()=>use(planner)('get_delivery_capacity',{packageId:'BAY-QUEUE'}),/differs/);
  assert.equal(use(planner)('get_delivery_capacity',{packageId:saved.packageId}).packageId,saved.packageId);
});
test('the same scope replans when signed staff availability changes; three plans and the separate review phase remain',()=>{
  for(const [baseline,disrupted,normalPlan,normalCost,finish,extension] of [
    ['case-a','case-c','parallel',1840,4,0],['case-b','case-d','phased',2000,10,4]
  ]){
    const a=control('project',tier,baseline).checks,b=control('project',tier,disrupted).checks;
    assert.equal(a[1].answer.packageId,b[1].answer.packageId);
    assert.equal(a[2].answer.plan,normalPlan);assert.equal(a[2].answer.costUSD,normalCost);
    assert.equal(b[2].answer.finishDay,finish);assert.equal(b[2].answer.extensionDays,extension);assert.equal(b[2].answer.feasible,extension===0);
    assert.equal(a[2].trace[0].result.plans.length,3);assert.deepEqual(a[2].trace[0].result,b[2].trace[0].result);
    const stage=workflows.project(tier,disrupted).stages[2];
    assert.ok(inspect(stage,{...b[2].answer,feasible:!b[2].answer.feasible},b[2].trace).includes('incorrect feasible'));
  }
});

test('skipping the retry after an uncommitted invoice timeout fails even when the agent reports the expected amounts',()=>{
  const {stage,trace,invoke}=harness('invoice','case-c',2);
  let attempted=false;
  for(const {name,args} of stage.controls){
    if(name==='post_ledger'&&attempted)continue;
    try{invoke(name,args);}catch(e){assert.match(e.message,/timeout/);attempted=true;}
  }
  assert.ok(inspect(stage,{...stage.expected,explanation:'Posted.'},trace).includes('wrong ledger or dispute state'));
});

test('a plausible split without dispatch verification fails even when the final business records match',()=>{
  const {stage,trace,invoke}=harness('shipment','case-a',2);
  const input=control('shipment',tier,'case-a').checks[1].answer;
  let sent=false;
  const answer=referenceClients[stage.id]((name,args)=>{
    if(name==='read_dispatch'&&!sent)return {};
    if(name==='notify_customer')sent=true;
    return invoke(name,args);
  },input);
  const issues=inspect(stage,{...answer,explanation:'Confirmed.'},trace);
  assert.ok(issues.includes('missing ordered verification'));
  assert.ok(!issues.includes('incorrect booking, dispatch or customer state'));
});

test('a cheap late shipment and a feasible over-budget whole shipment both fail the full decision contract',()=>{
  const check=control('shipment',tier,'case-a').checks[2];
  for(const [quote,price] of [['Q-71',52000],['Q-72',69000]]){
    const {stage}=harness('shipment','case-a',2);
    const fabricated={...check.answer,quoteIds:[quote],proposedCents:price};
    assert.ok(inspect(stage,fabricated,check.trace).includes('incorrect quoteIds'));
  }
});

test('external shipment codes and policy time are discoverable before the agent must supply them',()=>{
  const checks=control('shipment',tier,'case-b').checks;
  const [route,policy,booking]=workflows.shipment(tier,'case-b').stages;
  const raw=checks[0].trace.find(t=>t.name==='read_ticket').result;
  assert.ok(Object.values(raw.alarmDirectory).includes(checks[0].answer.alarm));
  assert.equal(checks[0].answer.eventHour,raw.incidentEffectiveHour);
  assert.notEqual(raw.scans[0].hour,raw.incidentEffectiveHour);
  assert.ok(policy.handoffIssue({...checks[0].answer,eventHour:raw.scans[0].hour}));
  assert.ok(policy.handoffIssue({...checks[0].answer,alarm:'Missed Pickup'}));
  assert.deepEqual(booking.schema.properties.status.enum,['confirmed','needs_approval']);
  assert.ok(route.request.includes('incidentEffectiveHour'));
});

test('dispute evidence accepts the relevant receipts alone or the full verified invoice set and rejects missing or unrelated evidence',()=>{
  for(const ids of [['GR3'],['GR1','GR2','GR3','RET2']]){
    const {scenario,invoke}=harness('invoice','case-b',2);
    const args={invoiceId:scenario.caseRef,revision:'v3',lines:[{line:'L3',amount:20}]};
    assert.throws(()=>invoke('open_dispute',{...args,evidence:['GR1']}),/evidence/);
    assert.throws(()=>invoke('open_dispute',{...args,evidence:['GR3','OTHER']}),/evidence/);
    invoke('open_dispute',{...args,evidence:ids});
    assert.deepEqual(scenario.state.disputes,[{...args,evidence:['GR3']}]);
  }
});

test('project grading rejects a concentration of evidence at one site, unnormalized counts, and a cheap plan missing the review deadline',()=>{
  const checks=control('project',tier,'case-a').checks;
  const stages=workflows.project(tier,'case-a').stages;
  const survey={...checks[0].answer,evidenceIds:['E1','E2','E3'],disputedFrequencySites:['Elm']};
  assert.ok(inspect(stages[0],survey,checks[0].trace).includes('incorrect evidenceIds'));
  const finding={...checks[1].answer,figures:checks[1].answer.figures.map(f=>f.site==='Elm'?{...f,affected:25,ratePercent:25}:f)};
  assert.ok(inspect(stages[1],finding,checks[1].trace).includes('incorrect figures'));
  const plan={...checks[2].answer,plan:'phased',costUSD:1600,staff:['Ana','Lee'],finishDay:3};
  assert.ok(inspect(stages[2],plan,checks[2].trace).includes('incorrect finishDay'));
});
