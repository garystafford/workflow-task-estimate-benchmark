import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expenseControl,expensePlan,expenseMix,travelExpense} from '../src/matrix/travel-expense.mjs';
import {callInterface,inspect} from '../src/matrix/mock.mjs';

test('case mix schedules only active specialists',()=>{
  const {controls,jobs}=expensePlan();
  assert.equal(controls.length,13);
  assert.equal(jobs.filter(j=>j.stage<0).length,39);
  assert.equal(jobs.filter(j=>j.stage>=0).length,96);
  assert.equal(new Set(jobs.map(j=>j.key)).size,jobs.length);
  const weighted = key => expenseMix.reduce((n,f)=>n+f.monthly_reports*f[key],0);
  assert.equal(weighted('policy_lookup'),400);
  for (const c of controls) {
    const f=expenseMix.find(f=>f.case_id===c.caseSet);
    assert.deepEqual(c.checks.map(s=>s.id),f.policy_lookup?['TE-01','TE-02','TE-03']:['TE-01','TE-03']);
    for(let i=1;i<c.checks.length;i++) assert.deepEqual(c.checks[i].input,c.checks[i-1].answer);
    assert.deepEqual(travelExpense(['Routine','Standard','Complex','Advanced'].indexOf(f.tier),c.caseSet).state,{postings:[],reviews:[]});
  }
});

test('receipt, policy and settlement grading reject credible shortcuts independently',()=>{
  const fixture=travelExpense(1,'meal-cap');
  const [intake,policy,settlement]=fixture.stages;
  const checks=expenseControl(1,'meal-cap').checks;
  assert.ok(inspect(intake,{...checks[0].answer,grossCents:6000},checks[0].trace).includes('incorrect grossCents'));
  const stale={...checks[1].answer,policyId:'US-26A',mealCapCents:5000};
  assert.ok(inspect(policy,stale,checks[1].trace).includes('incorrect policyId'));
  // A plausible wrong policy must survive the live handoff for the actual downstream cost to be measured.
  assert.equal(settlement.handoffIssue(stale),null);
  assert.match(settlement.handoffIssue({...stale,reportId:'unrelated'}),/identity/);
  const trace=[];
  const wrong=settlement.reference(callInterface(settlement,trace),stale);
  const errors=inspect(settlement,{...wrong,explanation:'Applied the selected cap.'},trace);
  assert.equal(wrong.postedCents,5375);
  assert.ok(errors.includes('incorrect postedCents'));
  assert.ok(errors.includes('incorrect reimbursement ledger or review queue'));
  for (const [tier,key,wrongCents] of [[1,'duplicate-scan',10570],[2,'fx-company',14521],[2,'fx-refund',11001],[3,'amendment-approved',58300]]) {
    const c=expenseControl(tier,key).checks.at(-1);
    const stage=travelExpense(tier,key).stages.at(-1);
    assert.ok(inspect(stage,{...c.answer,postedCents:wrongCents},c.trace).includes('incorrect postedCents'));
  }
});

test('opposite timeout outcomes require read-before-retry and exactly one verified posting',()=>{
  for (const [key,writes] of [['timeout-posted',1],['timeout-missing',2]]) {
    const c=expenseControl(3,key).checks.at(-1);
    assert.equal(c.trace.filter(e=>e.name==='post_reimbursement').length,writes);
    assert.equal(c.trace.at(-1).result.postings.length,1);
    assert.equal(c.answer.postedCents,16351);
    const stage=travelExpense(3,key).stages.at(-1);
    const trace=[],invoke=callInterface(stage,trace);
    invoke('read_authorization');
    const payload=c.trace.find(e=>e.name==='post_reimbursement').args;
    assert.throws(()=>invoke('post_reimbursement',payload),/timeout/);
    invoke('post_reimbursement',payload);
    invoke('read_settlement');
    const issues=inspect(stage,c.answer,trace);
    assert.ok(issues.includes('unverified timeout recovery'));
    if (writes===1) assert.ok(issues.includes('incorrect reimbursement ledger or review queue'));
  }
});

test('a stale approval can never authorize the matched amendment, even when it covers the dollars',()=>{
  const approved=expenseControl(3,'amendment-approved').checks.at(-1);
  const held=expenseControl(3,'amendment-held').checks.at(-1);
  assert.equal(approved.answer.eligibleCents,held.answer.eligibleCents);
  assert.equal(held.answer.outcome,'hold');
  assert.equal(held.answer.postedCents,0);
  const stage=travelExpense(3,'amendment-held').stages.at(-1);
  const trace=[],invoke=callInterface(stage,trace);
  const auth=invoke('read_authorization');
  assert.ok(auth.limitCents>=held.answer.eligibleCents);
  const payload=approved.trace.find(e=>e.name==='post_reimbursement').args;
  assert.throws(()=>invoke('post_reimbursement',{...payload,reportId:held.answer.reportId,employeeId:held.answer.employeeId}),/authorization/);
  assert.deepEqual(invoke('read_settlement'),{postings:[],reviews:[]});
  assert.ok(inspect(stage,held.answer,trace).includes('incorrect reimbursement ledger or review queue'));
});

test('local replay reports production-weighted costs and success from connected attempts including a held-up handoff',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'travel-mix-replay-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  execFileSync(process.execPath,['src/matrix/run.mjs','validate',dir,'travel-expense']);
  const json=async p=>JSON.parse(await readFile(join(dir,p)));
  const save=(p,v)=>writeFile(join(dir,p),JSON.stringify(v));
  const plan=await json('manifest.json');
  const schedule=await json('schedule.json');
  const controls=await json('controls.json');
  const cases=new Map(controls.map(c=>[c.caseSet,c]));
  await mkdir(join(dir,'grades'));await mkdir(join(dir,'runs'));
  const pass={usd:0,verdict:{pass:true}};
  for (const job of schedule) {
    const {key,stage,caseSet}=job;
    const c=cases.get(caseSet),steps=[];
    const bad=caseSet==='rail' && stage<0;
    for (const [i,check] of c.checks.entries()) {
      if ((stage>=0 && i!==stage) || (bad && i>0)) continue;
      const id=key+check.id;
      steps.push({index:i,task:check.id,answer:check.answer,request:i?{upstream:check.input}:{},
        trace:check.trace,issues:[],sessionId:id,turnId:id,seconds:1,usd:null,usage:{input_tokens:job.rep===1?0:7500,output_tokens:0}});
      await save('grades/'+key+'_'+check.id+'.json',pass);
    }
    if(stage<0) await save('grades/'+key+'_workflow.json',pass);
    await save('runs/'+key+'.json',{...job,steps,effort:plan.effort,model:plan.model,mode:stage<0?'workflow':'isolated',
      seconds:steps.length,handoffError:bad?'Invalid receipt handoff':null,finalState:bad?{postings:[],reviews:[]}:c.finalState});
  }
  execFileSync('python3',['scripts/report-workflow-matrix.py',dir]);
  const text=await readFile(join(dir,'expense-monthly-mix.csv'),'utf8');
  const [header,...body]=text.trim().split(/\r?\n/).map(line=>line.split(','));
  const overall=Object.fromEntries(header.map((key,i)=>[key,body.at(-1)[i]]));
  const repetitions=await readFile(join(dir,'repetitions.csv'),'utf8');
  const [columns,first,second]=repetitions.trimEnd().split(/\r?\n/).map(line=>line.split(','));
  assert.equal(first[columns.indexOf('cached_share')],'');
  assert.equal(Number(second[columns.indexOf('cached_share')]),0);
  // 2 stages per report, 400 lookups, less 660 unexecuted settlement stages, at a mean of $0.01 per stage.
  assert.ok(Math.abs(Number(overall.monthly_uncached_usd)-37.4)<1e-8);
  assert.ok(Math.abs(Number(overall.pass_rate)-0.67)<1e-10);
  assert.ok(Math.abs(Number(overall.uncached_usd_per_success)-37.4/1340)<1e-10);
  assert.equal((await json('summary.json')).unexecuted_stages,3);
});
