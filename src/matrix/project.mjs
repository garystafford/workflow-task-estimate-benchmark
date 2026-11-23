import {makeStage, reader, tool, call, str, num, list, bool, same, verifiedAfter, linkedReadCheck} from './mock.mjs';

import {projectRecords} from './coverage/project.mjs';

function baseRecords(t) {
  const standard=t===1, complex=t===2;
  const projectId='INTAKE-'+(30+t);
  const comment=(id,site,role,text)=>({id,site,role,text});
  const comments=[comment('C1','Elm','clerk','I key the address again in the second form.'),comment('C2','Elm','clerk','I retype the same fields on most intakes.')];
  if(standard)comments.push(comment('C3','Elm','manager','I see a repeated entry only occasionally.'));
  if(complex) comments.push(comment('C3','Elm','clerk','The second entry screen repeats what we already captured.'),comment('C4','Bay','agent','Approval waits are the problem here.'));
  const eligible=(complex?['Elm','Bay']:['Elm']);
  const packet={projectId,comments,participatingSites:eligible,participationStatus:'confirmed'};
  const feedback={projectId,sites:eligible,topics:complex?['duplicate_entry','approval_wait']:['duplicate_entry'],disagreement:standard,excluded:[]};
  const scope='ELM-FORM';
  const workbookId='WB-'+projectId, ledgerId='LED-'+projectId, methodId='METHOD-2';
  const sources=[workbookId,ledgerId,methodId].sort();
  const records=[{site:'Elm',topic:'duplicate_entry',workbookEvents:standard||complex?16:12,reopened:standard||complex?4:0,cases:100,ledgerDistinct:12,package:scope}];
  if(complex)records.push({site:'Bay',topic:'approval_wait',workbookEvents:13,reopened:6,cases:100,ledgerDistinct:7,package:'BAY-APPROVAL'});
  const operational={workbookId,ledgerId,methodId,approvedMethod:'Exclude repeat events on reopened cases. Rate is distinct affected cases divided by total cases for that site. Recommend a site package only at or above 10 percent. Exclude sites outside the current handoff.',records};
  const finding={projectId,scope,affected:12,denominator:100,ratePercent:12,sources};
  const hours=complex?24:16,deadlineDays=5,cap=complex?1800:2000;
  const person=(id,site,skill,daily,rate)=>({id,site,skill,availableHoursPerDay:daily,usdPerHour:rate});
  const people=[person('Ana','Elm','forms',standard?0:8,60)];
  if(standard)people.push(person('Bo','Elm','forms',4,55));
  if(complex)people.push(person('Bo','Elm','forms',8,75));

  const plans=complex?[{id:'phased',assignment:[{person:'Ana',hours:24}]},{id:'parallel',assignment:[{person:'Ana',hours:12},{person:'Bo',hours:12}]}]:
    standard?[{id:'proposed',assignment:[{person:'Ana',hours:16}]},{id:'substitute',assignment:[{person:'Bo',hours:16}]}]:
    [{id:'proposed',assignment:[{person:'Ana',hours}]}];
  const resources={projectId,participatingSites:eligible,packages:[{scope,skill:'forms',hours,budgetUsd:cap,deadlineDays,plans},...(complex?[{scope:'BAY-APPROVAL',skill:'legal',hours:10,budgetUsd:900,deadlineDays:5,plans:[]}]:[])],people,
    rules:'Work starts on day 1. Staff on a plan work concurrently. Each needs the listed skill and must belong to a participating site. Finish day is the longest assigned duration rounded up. Return the least-cost plan meeting all constraints. If infeasible, give the least deadline extension for an otherwise feasible plan, including its plan ID, staffing and cost.'};
  const solution={projectId,scope,feasible:true,plan:complex?'phased':standard?'substitute':'proposed',staff:[standard?'Bo':'Ana'],costUsd:complex?1440:standard?880:960,finishDay:complex?3:standard?4:2,extensionDays:0};
  return {packet,feedback,operational,finding,resources,solution};
}

// Confirmed daily availability can reverse the choice based on nominal staffing.
const planningCalendars={
  'INTAKE-32':{ref:'CAL-281',hours:{Ana:4,Bo:8},
    plan:'parallel',staff:['Ana','Bo'],costUsd:1620,finishDay:3,extensionDays:0},
  'INTAKE-45':{ref:'CAL-614',hours:{Fox:8,Nia:0},
    plan:'solo',staff:['Fox'],costUsd:1200,finishDay:3,extensionDays:0},
  'INTAKE-46':{ref:'CAL-957',hours:{Val:8,Paz:0,Ren:10},
    plan:'solo',staff:['Val'],costUsd:1500,finishDay:4,extensionDays:1},
};

function planningEvidence(resources, solution, complex) {
  const index=call('get_delivery_capacity');
  if(!complex) return {solution,tools:[reader(index.name,'Read eligible plan options, staff rates, availability and delivery rules.',resources)],
    controls:[index],checks:{minReads:{get_delivery_capacity:1}}};
  const {ref,hours,...outcome}=planningCalendars[resources.projectId];
  const calendars=new Map();
  const packages=resources.packages.map((pkg,i)=>{
    const selected=pkg.scope===solution.scope;
    const calendarRef=selected?ref:ref+'-T'+(i+1);
    calendars.set(calendarRef,{calendarRef,scope:pkg.scope,skill:pkg.skill,status:'confirmed',
      staff:selected?Object.entries(hours).map(([person,availableHoursPerDay])=>({person,availableHoursPerDay})):[]});
    return {...pkg,calendarRef};
  });
  const people=resources.people.map(({availableHoursPerDay,...rest})=>({...rest,nominalHoursPerDay:availableHoursPerDay}));
  const packet={...resources,packages,people,
    rules:resources.rules+' Nominal hours are for budgeting only. Use the confirmed daily hours from the calendar referenced by the selected package and skill for every staffing decision.'};
  return {solution:{...solution,...outcome,feasible:outcome.extensionDays===0},
    tools:[reader(index.name,'Read the package list, calendar references, participating sites, nominal staffing, rates and planning rules.',packet),
      tool('read_staffing_calendar','Read confirmed staff availability for an exact package calendar reference.',{calendarRef:str},({calendarRef})=>{
        if(!calendars.has(calendarRef)) throw Error('Unknown staffing calendar');
        return structuredClone(calendars.get(calendarRef));
      })],
    controls:[index,call('read_staffing_calendar',{calendarRef:ref})],
    checks:{minReads:{get_delivery_capacity:1},stateCheck:linkedReadCheck(index.name,'read_staffing_calendar','calendarRef',ref)}};
}

export function project(t,fixture) {
  const {packet,feedback,operational,finding,resources,solution}=fixture?projectRecords(fixture):baseRecords(t);
  const {projectId}=packet;
  const planning=planningEvidence(resources,solution,t===2);
  const state={report:null};
  const packageIdField={...str,description:'Exact work-package ID from the selected operational record.'};
  const reportFields={projectId:str,scope:packageIdField,affected:num,denominator:num,ratePercent:num,sources:list};
  const surveyPolicy='Read the complete, final survey snapshot once. Its confirmed participation and comments are fixed for this review. Use that same snapshot for the summary and final verification.';
  const stages=[
    makeStage('RR-02',surveyPolicy+' Summarize the stakeholder evidence by eligible site, including conflicting views about frequency, representative comment IDs in your explanation, sample limitations and any withdrawn site. Count comments as records. Give a count of distinct respondents only when the records identify their authors. Return the applicable topic codes duplicate_entry and/or approval_wait. disagreement means contrary frequency claims within a site.',{projectId:str,sites:list,topics:list,disagreement:bool,excluded:list},feedback,[
      reader('read_survey','Read the complete immutable survey snapshot, including every comment and confirmed site. One successful read supplies the final evidence.',packet)
    ],[call('read_survey')],{minReads:{read_survey:1},
      ...({stateCheck:trace=>trace.filter(e=>e.name==='read_survey'&&!e.error).length>1?['redundant final survey read']:[]})}),
    makeStage('RR-06','Investigate the handed-off topics and participating sites. Apply the approved definition, reconcile each eligible site to its ledger, and select the qualifying work package. Copy the selected record’s package value verbatim into scope in save_finding and in your answer. Read the finding back and verify that scope equals that exact work-package ID. Cite all three current source IDs; explain exclusions and the site-level comparison. Keep case incidence separate from frequency per day or per respondent. Resolve a survey disagreement only if the metrics measure the same quantity.',reportFields,finding,[
      reader('read_metrics','Read operational evidence, methodology and package selection rules.',operational),
      tool('save_finding','Save the cited, quantified finding for delivery planning.',reportFields,a=>{state.report={...a,sources:[...a.sources].sort()};return {saved:true};}),
      tool('read_finding','Retrieve the saved finding.',{},()=>structuredClone(state.report))
    ],[call('read_metrics'),call('save_finding',finding),call('read_finding')],{minReads:{read_metrics:1},stateCheck(trace){
      return [...(!same(state.report,finding)?['incorrect saved finding']:[]),...(!verifiedAfter(trace,'read_finding',['save_finding'])?['missing read-back of finding']:[])];
    }}),
    makeStage('SD-05','Use the work-package ID in upstream.scope to select the matching capacity package. Return that exact ID in scope. Evaluate the permitted plans using skill, site, capacity, deadline and budget. Give the feasible plan or the smallest deadline extension required by the capacity rules. Explain the binding constraints, relevant alternatives and arithmetic. Report finishDay and extensionDays as whole work days.',{projectId:str,scope:packageIdField,feasible:bool,plan:str,staff:list,costUsd:num,finishDay:num,extensionDays:num},planning.solution,planning.tools,planning.controls,planning.checks)
  ];
  return {caseRef:projectId,stages,state};
}
