import test from 'node:test';
import assert from 'node:assert/strict';
import {coveragePlan,tiers,lowerCases,workflows} from '../src/matrix/catalog.mjs';
import {callInterface,inspect} from '../src/matrix/mock.mjs';
import {stageEvidence} from '../src/matrix/judge-context.mjs';

test('all three workflows have thirteen cases with three repetitions per case',()=>{
  const all=coveragePlan();
  assert.equal(all.controls.length,39);
  assert.equal(new Set(all.jobs.map(j=>j.key)).size,468);
  const unique=new Set();
  for(const [name,fixtures] of Object.entries(lowerCases)) {
    for(const tier of [0,1,2]){
      assert.equal(fixtures.filter(f=>f.tier===tier).length,2);
      assert.equal(all.controls.filter(c=>c.workflow===name && c.tier===tiers[tier]).length,3);
    }
    for(const f of fixtures){
      const r=workflows[name](f.tier,f.id);
      assert.ok(!unique.has(r.caseRef));unique.add(r.caseRef);
    }
  }
});

test('running one workflow schedules exactly its own cases and repetitions', () => {
  const combined = coveragePlan();
  for (const workflow of Object.keys(workflows)) {
    const {controls, jobs} = coveragePlan([workflow]);
    assert.deepEqual(controls, combined.controls.filter(c => c.workflow === workflow));
    assert.deepEqual(jobs, combined.jobs.filter(j => j.w === workflow));
    assert.equal(jobs.filter(job => job.stage < 0).length, 39);
    assert.equal(jobs.filter(job => job.stage >= 0).length, 117);
  }
});

test('invoice gold outcomes reconcile to independent item, receipt, credit and approval arithmetic',()=>{
  for(const f of lowerCases.invoice){
    const [extract,reconcile]=workflows.invoice(f.tier,f.id).stages;
    const docs=extract.tools[0].handle({}).documents;
    const current=docs.at(-1),records=reconcile.tools[0].handle({});
    const amounts=d=>d.pages.map(p=>{
      const [,qty,price]=p.text.match(/quantity (\d+) \| unit price USD (\d+)/);
      return Number(qty)*Number(price);
    });
    const lines=amounts(current),prior=amounts(docs[0]);
    assert.equal(lines.reduce((a,b)=>a+b),extract.expected.gross);
    assert.deepEqual(lines.flatMap((v,i)=>v!==prior[i]?['L'+(i+1)]:[]),extract.expected.changedLines);
    const accepted=records.receipts.flatMap(r=>r.accepted).reduce((n,l)=>n+l.amount,0);
    const posted=new Map(records.credits.filter(c=>c.status==='posted').map(c=>[c.id,c.amount]));
    const credits=[...posted.values()].reduce((a,b)=>a+b,0);
    assert.equal(reconcile.expected.credit,credits);
    assert.equal(reconcile.expected.payable,accepted-credits);
    assert.equal(reconcile.expected.disputed,extract.expected.gross-accepted);
    assert.equal(reconcile.expected.freshApproval,records.approval.revision!==current.version || records.approval.authorized<accepted-credits);
  }
});

test('shipment decisions follow rule precedence, vehicle capacity, timing and cost',()=>{
  for(const f of lowerCases.shipment){
    const [route,select,book]=workflows.shipment(f.tier,f.id).stages;
    const ticket=route.tools[0].handle({}),{procedures}=select.tools[0].handle({});
    const leg=ticket.scans.find(s=>s.source==='carrier' && s.status==='missed pickup').leg;
    assert.equal(leg,route.expected.leg);
    const eligible=procedures.filter(p=>p.status==='approved' && [ticket.region,'all'].includes(p.region));
    const ranked=eligible.sort((a,b)=>Number(b.region===ticket.region)-Number(a.region===ticket.region) || b.version-a.version);
    const base=ranked[0], entry=base.regionalExceptions?.find(e=>e.region===ticket.region);
    const rule=entry?select.tools[1].handle({exceptionRef:entry.exceptionRef}):base;
    assert.equal(rule.id,select.expected.runbook);
    assert.equal(rule.needsApproval,select.expected.needsApproval);
    const market=book.tools[0].handle({});
    const quotes=market.quotes.filter(q=>rule.eligibleCarriers.includes(q.carrier) && q.units>=market.units &&
      q.departure<=rule.departureCutoffHour && q.arrival<=market.deliveries[0].byHour && q.price<=market.cap);
    const best=quotes.sort((a,b)=>a.price-b.price)[0];
    assert.deepEqual(book.expected.quoteIds,[best.id]);assert.equal(book.expected.spend,best.price);
  }
});

test('project selection ranks reconciled eligible sites and checks every permitted staffing plan',()=>{
  for(const f of lowerCases.project){
    const [,find,plan]=workflows.project(f.tier,f.id).stages;
    const {records}=find.tools[0].handle({});
    for(const row of records) assert.equal(row.workbookEvents-row.reopened,row.ledgerDistinct);
    const ranked=records.map(r=>({...r,rate:r.ledgerDistinct*100/r.cases})).filter(r=>r.rate>=10).sort((a,b)=>b.rate-a.rate);
    assert.deepEqual([find.expected.scope,find.expected.affected,find.expected.denominator,find.expected.ratePercent],
      [ranked[0].package,ranked[0].ledgerDistinct,ranked[0].cases,ranked[0].rate]);
    const res=plan.tools[0].handle({}),pkg=res.packages.find(p=>p.scope===ranked[0].package);
    if(pkg.calendarRef){
      const calendar=plan.tools[1].handle({calendarRef:pkg.calendarRef});
      assert.equal(calendar.skill,pkg.skill);
      for(const p of res.people)p.availableHoursPerDay=calendar.staff.find(s=>s.person===p.id)?.availableHoursPerDay;
    }
    const options=[];
    for(const opt of pkg.plans){
      let cost=0,days=0,hours=0;
      for(const a of opt.assignment){
        const p=res.people.find(p=>p.id===a.person);
        if(!p.availableHoursPerDay || p.skill!==pkg.skill || !res.participatingSites.includes(p.site)){days=Infinity;break;}
        cost+=a.hours*p.usdPerHour;hours+=a.hours;days=Math.max(days,Math.ceil(a.hours/p.availableHoursPerDay));
      }
      if(hours===pkg.hours && cost<=pkg.budgetUsd && Number.isFinite(days))
        options.push({id:opt.id,cost,days,extra:Math.max(0,days-pkg.deadlineDays)});
    }
    const winner=options.sort((a,b)=>a.extra-b.extra || a.cost-b.cost)[0];
    assert.deepEqual([plan.expected.plan,plan.expected.costUsd,plan.expected.finishDay,plan.expected.extensionDays,plan.expected.feasible],
      [winner.id,winner.cost,winner.days,winner.extra,winner.extra===0]);
  }
});

test('a project finding must persist the package ID even when the worker returns the correct ID',()=>{
  const [,finding,plan]=workflows.project(0,'address-import').stages;
  const trace=[];
  const invoke=callInterface(finding,trace);
  const {records}=invoke('read_metrics');
  const report={...finding.expected,explanation:'Read back the selected package.'};
  const saveSchema=finding.tools.find(t=>t.definition.name==='save_finding').definition.parameters;
  for(const schema of [saveSchema,finding.schema,plan.schema]){
    assert.match(schema.properties.scope.description,/work-package ID/);
  }
  invoke('save_finding',{...finding.expected,scope:records[0].site});
  invoke('read_finding');
  assert.ok(inspect(finding,report,trace).includes('incorrect saved finding'));
  invoke('save_finding',{...finding.expected,scope:records[0].package});
  assert.equal(invoke('read_finding').scope,report.scope);
  assert.deepEqual(inspect(finding,report,trace),[]);
});

test('invoice reconciliation carries distinct credit IDs and net amounts through to settlement',()=>{
  const scenario=workflows.invoice(2,'voided-credit');
  const reconcile=scenario.stages[1], settle=scenario.stages[2];
  const trace=[];
  callInterface(reconcile,trace)('read_purchase_records');
  const expected={...reconcile.expected,explanation:'Matched the accepted quantities and distinct posted credits.'};
  assert.deepEqual(expected.lineAllocations,[
    {line:'L1',accepted:75,appliedCredits:[{id:'CM-856A',amount:5}],payable:70},
    {line:'L2',accepted:60,appliedCredits:[{id:'CM-856B',amount:10}],payable:50},
  ]);
  assert.deepEqual(inspect(reconcile,expected,trace),[]);
  const wrong=structuredClone(expected);
  wrong.lineAllocations[0].payable-=5;
  wrong.lineAllocations[1].payable+=5;
  assert.ok(inspect(reconcile,wrong,trace).includes('incorrect lineAllocations'));
  assert.ok(inspect(settle,{...settle.expected,explanation:'Pending.'},[]).includes('wrong ledger or dispute state'));
  const other=workflows.invoice(2,'revised-order-credit').stages[1].expected;
  assert.deepEqual(other.lineAllocations[0].appliedCredits,[{id:'CM-855',amount:15}]);
});

test('invoice settlement grading distinguishes upstream purchase evidence from settlement actions',()=>{
  const [,reconcile,settle]=workflows.invoice(2,'revised-order-credit').stages;
  const trace=[];
  callInterface(reconcile,trace)('read_purchase_records');
  const step={request:{upstream:reconcile.expected},trace:[]};
  const evidence=stageEvidence(settle,step,{task:'FP-04',trace});
  assert.equal(evidence.upstreamPurchaseReads[0].credits[0].line,'L1');
  assert.deepEqual(evidence.observedActions,[]);
  assert.equal(stageEvidence(settle,step).upstreamPurchaseReads,undefined);
});

test('booking grading can verify the specialist lacks a runbook reader',()=>{
  const [,policy,book]=workflows.shipment(2,'regional-approval').stages;
  const evidence=stageEvidence(book,{request:{upstream:policy.expected},trace:[]});
  assert.ok(evidence.toolContracts.some(tool=>tool.name==='get_booking_approval'));
  assert.ok(!evidence.toolContracts.some(tool=>tool.name==='search_runbooks'));
  assert.match(evidence.evidenceInterpretation,/independently review the runbook/);
});

test('Complex shipment and project cases use the record identified by the first lookup',()=>{
  const controls=coveragePlan().controls.filter(c=>c.tier==='Complex' && ['shipment','project'].includes(c.workflow));
  for(const c of controls){
    const t=tiers.indexOf(c.tier),project=c.workflow==='project';
    const i=project?2:1,stage=workflows[c.workflow](t,c.caseSet).stages[i];
    const {answer,trace}=c.checks[i];
    if(project)assert.deepEqual(trace[0].result.participatingSites,c.checks[0].trace[0].result.participatingSites);
    if(t!==2)continue;
    assert.equal(trace.length,2);
    const first=trace[0].result;
    const invoke=callInterface(stage,[]);
    const other=project
      ? first.packages.find(p=>p.scope!==answer.scope).calendarRef
      : first.procedures[0].regionalExceptions.find(p=>p.region!==c.checks[0].answer.region).exceptionRef;
    const key=project?'calendarRef':'exceptionRef';
    assert.throws(()=>invoke(trace[1].name,{[key]:'missing'}));
    const wrong={...trace[1],args:{[key]:other},result:invoke(trace[1].name,{[key]:other})};
    for(const shortcut of [[trace[0]],trace.toReversed(),[trace[0],wrong]]){
      assert.ok(inspect(stage,answer,shortcut).some(msg=>msg.includes('linked evidence')));
    }
    if(project)assert.equal(first.people.some(p=>'availableHoursPerDay' in p),false);
    else assert.ok(!first.procedures[0].eligibleCarriers.some(carrier=>answer.carriers.includes(carrier)));
  }
});

test('the linked record changes the winning booking or staffing plan in each Complex case',()=>{
  const cases=coveragePlan().controls.filter(c=>c.tier==='Complex' && ['shipment','project'].includes(c.workflow));
  for(const c of cases){
    if(c.workflow==='shipment'){
      const [,policy,booking]=c.checks;
      const [index,exception]=policy.trace;
      const market=booking.trace[0].result;
      const cheapest=rule=>market.quotes.filter(q=>rule.eligibleCarriers.includes(q.carrier)
        && q.units>=market.units && q.departure<=rule.departureCutoffHour
        && q.arrival<=market.deliveries[0].byHour && q.price<=market.cap).sort((a,b)=>a.price-b.price)[0].id;
      const global=cheapest(index.result.procedures[0]),regional=cheapest(exception.result);
      assert.notEqual(regional,global);
      assert.deepEqual([regional],booking.answer.quoteIds);
    }else{
      const stage=c.checks[2];
      const [index,calendar]=stage.trace;
      const catalog=index.result;
      const pkg=catalog.packages.find(p=>p.scope===stage.input.scope);
      function select(hours){
        const eligible=[];
        for(const plan of pkg.plans){
          let days=0,cost=0;
          for(const a of plan.assignment){
            const p=catalog.people.find(p=>p.id===a.person);
            if(!hours[p.id] || !catalog.participatingSites.includes(p.site) || p.skill!==pkg.skill){days=Infinity;break;}
            days=Math.max(days,Math.ceil(a.hours/hours[p.id]));
            cost+=a.hours*p.usdPerHour;
          }
          if(Number.isFinite(days) && cost<=pkg.budgetUsd)eligible.push({plan:plan.id,cost,days,extension:Math.max(0,days-pkg.deadlineDays)});
        }
        return eligible.sort((a,b)=>a.extension-b.extension || a.cost-b.cost)[0];
      }
      const nominal=select(Object.fromEntries(catalog.people.map(p=>[p.id,p.nominalHoursPerDay])));
      const confirmed=select(Object.fromEntries(calendar.result.staff.map(p=>[p.person,p.availableHoursPerDay])));
      const a=stage.answer;
      assert.notEqual(nominal.plan,confirmed.plan);
      assert.deepEqual(confirmed,{plan:a.plan,cost:a.costUsd,days:a.finishDay,extension:a.extensionDays});
    }
  }
});
