import {readFileSync} from 'node:fs';
import {parse} from 'csv-parse/sync';
import {makeStage, reader, tool, obj, str, num, arrayOf, same, timeoutChecked, verifiedAfter, callInterface, inspect} from './mock.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const fixtures = JSON.parse(read('fixtures/travel-expense/cases.json'));
export const expenseMix = parse(read('fixtures/travel-expense/case-mix.csv'), {columns:true, cast:true});
const tiers = ['Routine', 'Standard', 'Complex', 'Advanced'];
export const expenseCaseSets = tier => fixtures.filter(x => x.tier === tiers[tier]).map(x => x.caseId);
const lines = arrayOf(obj({receiptLine:str, category:str, paidBy:str, refundOf:str, usdCents:num}));
const handoffFields = {reportId:str, employeeId:str, revision:num, tripDate:str, region:str, lines, grossCents:num, policyId:str, mealCapCents:num};
const allocation = arrayOf(obj({receiptLine:str, eligibleCents:num}));
const writeFields = {reportId:str, employeeId:str, revision:num, policyId:str, allocations:allocation};
const rowsById = rows => [...rows].sort((a,b) => a.receiptLine.localeCompare(b.receiptLine));
const total = (rows, key) => rows.reduce((sum,row) => sum + row[key], 0);
const policies = [
  {policyId:'US-26A',region:'US',from:'2026-01-01',through:'2026-09-30',status:'signed',mealCapCents:5000},
  {policyId:'US-26B',region:'US',from:'2026-10-01',through:'2026-12-31',status:'signed',mealCapCents:6000},
  {policyId:'EU-26A',region:'EU',from:'2026-01-01',through:'2026-09-30',status:'signed',mealCapCents:5500},
  {policyId:'EU-26B',region:'EU',from:'2026-10-01',through:'2026-12-31',status:'signed',mealCapCents:7000},
  {policyId:'EU-26C',region:'EU',from:'2026-10-01',through:'2026-12-31',status:'draft',mealCapCents:9000},
];
const applicable = (p, report) => p.status==='signed' && p.region===report.region && p.from<=report.tripDate && report.tripDate<=p.through;
function lineAnswer(receipt, usdCents) {
  const {receiptLine,category,paidBy,refundOf} = receipt;
  return {receiptLine,category,paidBy,refundOf,usdCents};
}

// Deterministic reference clients see only business tools and the actual preceding answer.
function extract(invoke) {
  const {reportId,employeeId,region,tripDate,packets,attachedPolicy,exchangeRates} = invoke('read_report');
  const packet = packets.filter(p => p.signature==='verified').sort((a,b) => b.revision-a.revision)[0];
  const seen = new Map();
  for (const receipt of packet.receipts) {
    const {numerator,denominator} = exchangeRates[receipt.currency];
    const cents = Math.sign(receipt.amountMinor) * Math.round(Math.abs(receipt.amountMinor)*numerator/denominator);
    seen.set(receipt.receiptLine,lineAnswer(receipt,cents));
  }
  const lines = [...seen.values()];
  return {reportId,employeeId,revision:packet.revision,region,tripDate,lines,grossCents:total(lines,'usdCents'),
    policyId:attachedPolicy?.policyId ?? '',mealCapCents:attachedPolicy?.mealCapCents ?? 0};
}
function selectPolicy(invoke, upstream) {
  const {explanation, ...report} = upstream;
  const policy = invoke('list_travel_policies').find(p => applicable(p,report));
  return {...report,policyId:policy.policyId,mealCapCents:policy.mealCapCents};
}
function settle(invoke, report) {
  const auth = invoke('read_authorization');
  const allocations = rowsById(report.lines.map(line => {
    const parent = line.refundOf ? report.lines.find(p=>p.receiptLine===line.refundOf) : line;
    let eligibleCents = line.usdCents;
    if (parent.paidBy==='company' || parent.category==='personal') eligibleCents=0;
    else if (line.category==='meal') eligibleCents=Math.min(eligibleCents,report.mealCapCents);
    return {receiptLine:line.receiptLine,eligibleCents};
  }));
  const eligibleCents = total(allocations,'eligibleCents');
  const {reportId,employeeId,revision,policyId} = report;
  const payload = {reportId,employeeId,revision,policyId,allocations};
  const authorized = auth.reportId===reportId && auth.employeeId===employeeId && auth.revision===revision && auth.decision==='approved' && auth.limitCents>=eligibleCents;
  let records;
  if (authorized) {
    try { invoke('post_reimbursement',payload); }
    catch (e) {
      if (!e.message.includes('timeout')) throw e;
      records = invoke('read_settlement');
      if (!records.postings.length) { invoke('post_reimbursement',payload); records = undefined; }
    }
  } else invoke('queue_review',{reportId,employeeId,revision,reason:'approval_required'});
  records ??= invoke('read_settlement');
  return {reportId,employeeId,revision,policyId,allocations,eligibleCents,excludedCents:report.grossCents-eligibleCents,
    outcome:records.postings.length?'posted':'hold',postedCents:records.postings[0]?.amountCents ?? 0};
}

export function travelExpense(tier,caseId) {
  const f = fixtures.find(row=>row.tier===tiers[tier] && row.caseId===caseId);
  if (!f) throw Error('Unknown travel expense case for '+tiers[tier]+': '+caseId);
  const {reportId,employeeId,region,tripDate,oracle} = f;
  const identity = {reportId,employeeId,revision:oracle.revision};
  const policy = policies.find(p=>applicable(p,f));
  const report = {reportId,employeeId,region,tripDate,packets:f.packets,attachedPolicy:f.policyAttached?policy:null,
    exchangeRates:{USD:{numerator:1,denominator:1},EUR:{numerator:11,denominator:10}}};
  const source = f.packets.find(p=>p.revision===oracle.revision);
  const lines = Object.entries(oracle.usdByLine).map(([key,cents])=>lineAnswer(source.receipts.find(r=>r.receiptLine===key),cents));
  const extracted = {...identity,region,tripDate,lines,grossCents:total(lines,'usdCents'),
    policyId:f.policyAttached?oracle.policyId:'',mealCapCents:f.policyAttached?oracle.mealCapCents:0};
  const resolved = {...extracted,policyId:oracle.policyId,mealCapCents:oracle.mealCapCents};
  const allocations = rowsById(Object.entries(oracle.eligibleByLine).map(([receiptLine,eligibleCents])=>({receiptLine,eligibleCents})));
  const eligibleCents = total(allocations,'eligibleCents');
  const final = {...identity,policyId:oracle.policyId,allocations,eligibleCents,excludedCents:extracted.grossCents-eligibleCents,
    outcome:oracle.outcome,postedCents:oracle.postedCents};
  const posting = {...identity,policyId:oracle.policyId,allocations,amountCents:oracle.postedCents};
  const review = {...identity,reason:'approval_required'};
  const expectedState = oracle.outcome==='hold'?{postings:[],reviews:[review]}:{postings:[posting],reviews:[]};
  const state = {postings:[],reviews:[]};
  const expectedIdentity = a => a.reportId===reportId && a.employeeId===employeeId && a.revision===identity.revision;
  function validateHandoff(h, needsPolicy) {
    // The runtime checks the contract, while the grader compares business results to the oracle.
    if (!h || h.reportId!==reportId || h.employeeId!==employeeId || !Number.isInteger(h.revision) || h.revision<1 ||
        !h.region || !h.tripDate || !Array.isArray(h.lines) || !h.lines.length) return 'Invalid report identity or receipt handoff';
    const ids=new Set(h.lines.map(line=>line?.receiptLine));
    if (ids.size!==h.lines.length || h.lines.some(line=>!line?.receiptLine || !Number.isInteger(line.usdCents) ||
        (line.refundOf && !ids.has(line.refundOf))) || h.grossCents!==total(h.lines,'usdCents')) return 'Invalid receipt handoff';
    if (needsPolicy ? !h.policyId || !Number.isInteger(h.mealCapCents) || h.mealCapCents<=0 :
        h.policyId!=='' || h.mealCapCents!==0) return 'Invalid policy handoff';
    return null;
  }
  const intake = makeStage('TE-01',
    'Read the expense packet. Use the highest verified revision and count each receiptLine once. Preserve category, payer and linked credit reference. Convert each signed amount to integer USD cents at the supplied rate, rounding halves away from zero. Gross is the signed total of all unique lines before exclusions. Carry the attached policy ID and meal cap; use an empty ID and zero cap if absent.',
    handoffFields, extracted, [reader('read_report','Return report headers, signed or draft revisions, receipt transcriptions, trip exchange rates and any verified policy attachment.',report)],[],{minReads:{read_report:1},reference:extract});
  const stages = [intake];
  if (!f.policyAttached) stages.push(makeStage('TE-02',
    'Find the signed travel policy for the region effective on the trip date (inclusive). Carry forward the employee, report, trip, receipt lines and gross. Set the selected policy ID and per-receipt meal cap in USD cents. Write a fresh, one-sentence explanation naming the signed policy, its cap and why it applies to this trip.',
    handoffFields,resolved,[reader('list_travel_policies','List the travel policy register with status, region, inclusive effective dates and per-receipt meal caps.',policies)],[],
    {minReads:{list_travel_policies:1},handoffIssue:h=>validateHandoff(h,false),reference:selectPolicy,
      gradingGuidance:'Evaluate the policy explanation at the point after lookup. Accept any evidence-supported account of the selection, including explicitly historical intake values. A description of empty or default policy fields as the current result contradicts a resolved policy. Copying an intake explanation alone does not explain the selection.'}));
  let interrupted = false;
  stages.push(makeStage('TE-03',
    'Use the handed-off report and read authorization. Return one allocation per receipt line in USD cents. Exclude personal charges and company-paid lines. Cap employee meals per receipt. Apply each linked credit to its original employee business charge once, preserving its negative sign. Excluded cents are signed gross less eligible cents. Post all eligible allocations once only with approved matching employee, report, revision and sufficient limit. Otherwise queue approval_required and report hold with zero posted. After a timeout check the ledger before retrying only a missing posting. Read back final records and report verified posted cents.',
    {...writeFields,eligibleCents:num,excludedCents:num,outcome:{type:'string',enum:['posted','hold']},postedCents:num},final,[
      reader('read_authorization','Return the recorded employee, report revision, decision and maximum reimbursable USD cents.',{reportId,employeeId,...f.authorization}),
      tool('post_reimbursement','Create one reimbursement for this report revision. Submit all eligible allocations, including zero amounts and credits. On timeout the result is unknown.',writeFields,args=>{
        const amountCents=total(args.allocations,'eligibleCents');
        if (!expectedIdentity(args) || f.authorization.revision!==args.revision || f.authorization.decision!=='approved' ||
            amountCents<=0 || amountCents>f.authorization.limitCents) throw Error('Posting outside authorization');
        const fails = !interrupted && f.timeout!=='none';
        if (!fails || f.timeout==='committed') state.postings.push({...args,allocations:rowsById(args.allocations),amountCents});
        if (fails) {interrupted=true;throw Error('Posting timeout. Commit status unknown.');}
        return {saved:true};
      }),
      tool('queue_review','Record an unresolved approval for this report revision.',{reportId:str,employeeId:str,revision:num,reason:str},args=>{
        if (!expectedIdentity(args) || args.reason!=='approval_required') throw Error('Invalid approval review');
        state.reviews.push({...args}); return {saved:true};
      }),
      tool('read_settlement','Return the authoritative ledger postings and review queue entries for this employee report, across revisions.',{},()=>structuredClone(state))
    ],[],{minReads:{read_authorization:1},handoffIssue:h=>validateHandoff(h,true),reference:settle,
    gradingGuidance:'Ordinary umbrella terms in a narrative can summarize several receipt categories. Accept them when consistent with the receipts and settlement. Reject a false line-specific classification, incorrect eligibility, unsupported authority or an inaccurate claim about the ledger or review queue.',
    stateCheck(trace){
      const issues=[];
      if (!same(state,expectedState)) issues.push('incorrect reimbursement ledger or review queue');
      const write = trace.findIndex(e=>['post_reimbursement','queue_review'].includes(e.name));
      if (write<0 || !trace.slice(0,write).some(e=>e.name==='read_authorization'&&!e.error)) issues.push('missing prior authorization check');
      if (!verifiedAfter(trace,'read_settlement',['post_reimbursement','queue_review'])) issues.push('missing settlement read-back');
      if (f.timeout!=='none' && !timeoutChecked(trace,'post_reimbursement','read_settlement')) issues.push('unverified timeout recovery');
      if (trace.some(e=>e.error && !e.error.includes('timeout'))) issues.push('invalid settlement action');
      return issues;
    }}));
  return {caseRef:reportId,state,stages};
}

export function expenseControl(tier,caseId) {
  const scenario = travelExpense(tier,caseId);
  const checks=[];
  let upstream=null;
  for (const stage of scenario.stages) {
    const issue=stage.handoffIssue?.(upstream);
    if (issue) throw Error(caseId+' '+issue);
    const trace=[];
    const answer={...stage.reference(callInterface(stage,trace),upstream),explanation:'Validated with local business records.'};
    const issues=inspect(stage,answer,trace);
    if (issues.length) throw Error([caseId,stage.id,...issues].join(' '));
    if (!inspect(stage,answer,[]).length) throw Error('Missing evidence accepted for '+caseId);
    if (stage.stateCheck && !inspect(stage,answer,trace.slice(0,-1)).length) throw Error('Missing read-back accepted for '+caseId);
    checks.push({id:stage.id,input:upstream,answer,trace,pass:true});
    upstream=answer;
  }
  return {workflow:'expense',tier:tiers[tier],caseSet:caseId,checks,finalState:scenario.state};
}

export function expensePlan() {
  const controls=tiers.flatMap((_,tier)=>expenseCaseSets(tier).map(id=>expenseControl(tier,id)));
  if (new Set(expenseMix.map(row=>row.case_id)).size!==controls.length || expenseMix.length!==controls.length)
    throw Error('Each expense case needs one case-mix entry');
  for (const c of controls) {
    const f=expenseMix.find(r=>r.case_id===c.caseSet);
    const lookup=Number(c.checks.some(s=>s.id==='TE-02'));
    if (!f || f.tier!==c.tier || f.policy_lookup!==lookup || !Number.isInteger(f.monthly_reports) || f.monthly_reports<=0) throw Error('Invalid expense case mix for '+c.caseSet);
  }
  if (expenseMix.reduce((n,f)=>n+f.monthly_reports,0)!==2000 ||
      expenseMix.reduce((n,f)=>n+f.monthly_reports*f.policy_lookup,0)!==400) throw Error('Expense case mix volume changed');
  const jobs=[];
  for (const rep of [1,2,3]) {
    for (const c of controls) {
      for (const stage of [-1,...c.checks.keys()]) {
        jobs.push({rep,w:'expense',tier:tiers.indexOf(c.tier),caseSet:c.caseSet,stage,
          key:[rep,'expense',c.tier,c.caseSet,stage<0?'end-to-end':c.checks[stage].id].join('_')});
      }
    }
  }
  return {controls,jobs};
}
