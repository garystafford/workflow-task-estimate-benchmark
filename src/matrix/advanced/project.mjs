import {makeStage, reader, tool, call, obj, str, num, list, bool, arrayOf, same, verifiedAfter} from '../mock.mjs';

export function advancedProject(caseSet) {
  const eastWithdraws=['case-b','case-d'].includes(caseSet);
  const staffLoss=['case-c','case-d'].includes(caseSet);
  const ledgerChanged=caseSet==='case-c', workbookChanged=caseSet==='case-d';
  const projectId='INTAKE-33';
  const sites=eastWithdraws?['Bay','Oak']:['Bay','Elm'];
  const withdrawn=eastWithdraws?'Elm':'Oak';
  const claims=[
    ['E1','Elm','clerk','I retype the address nearly every time.'],
    ['E2','Elm','manager','Manual re-entry is uncommon here.'],
    ['E3','Elm','intake','Addresses go into two separate screens.'],
    ['B1','Bay','analyst','A second approval queue delays many cases.'],
    ['B2','Bay','manager','Only an occasional case waits for a second review.'],
    ['O1','Oak','clerk','Duplicate checks force me to validate the same file twice.'],
    ['O2','Oak','manager','Repeat checks are rare on my shift.'],
    ['O3','Oak','lead','The second checklist repeats the first one.'],
  ];
  const comments=[...claims.map(([id,site,role,text])=>({id,site,role,text})),
    {id:'B1-copy',copyOf:'B1',site:'Bay',role:'analyst',text:claims[3][3]},
    {id:'X1',site:'Bay',role:'vendor',text:'Every case waits six weeks.'}];
  const participation={cutoff:16,sponsorRecord:{initialSites:['Elm','Bay','Oak'],
    amendments:[{site:withdrawn,effective:14,signed:true,action:'withdraw'},
      {site:'Bay',effective:17,signed:true,action:'withdraw'}]},consentRevoked:ledgerChanged?['X1','E2']:['X1']};
  const evidence=claims.filter(([id,site])=>sites.includes(site)&&!participation.consentRevoked.includes(id)).map(([id])=>id);
  const feedback={projectId,sites,withdrawn,topics:eastWithdraws?['approval_wait','repeat_checks']:['approval_wait','duplicate_entry'],
    disputedFrequencySites:ledgerChanged?['Bay']:sites,evidenceIds:evidence};
  const siteRates={Elm:16,Bay:12,Oak:workbookChanged?20:18};
  const packages={Elm:'ELM-FORM',Bay:'BAY-QUEUE',Oak:'OAK-CHECK'};
  const priority=eastWithdraws?'Oak':'Elm',packageId=packages[priority];
  const numerator={Elm:16,Bay:24,Oak:workbookChanged?20:18};
  const workbook={id:'WB-17',rows:[
    {site:'Elm',grossEvents:25,reopens:5,denominator:100},
    {site:'Bay',grossEvents:31,reopens:7,denominator:200},
    {site:'Oak',grossEvents:workbookChanged?32:30,reopens:8,denominator:100}]};
  const adjustments={id:'ADJ-9',cutoff:16,entries:[
    {site:'Elm',id:'E-4',effective:15,signed:true,removeTraining:4},
    {site:'Elm',id:'E-4',effective:15,signed:true,removeTraining:4},
    {site:'Oak',id:'O-4',effective:14,signed:true,removeTraining:4},
    {site:'Bay',id:'B-9',effective:17,signed:true,removeTraining:10}],
    definition:'Rank participating packages by normalized workbook rate at or above 10%. Compare each workbook numerator and denominator against the independent ledger. For the leading candidate recommend funding only if its counts agree; otherwise withhold that candidate for review. Never substitute a runner-up for a disputed leader.'};
  const ledger={id:'LED-31',records:[{site:'Elm',events:ledgerChanged?15:16,total:100},{site:'Bay',events:24,total:200},{site:'Oak',events:18,total:100}],packages};
  const figures=sites.map(site=>({site,affected:numerator[site],denominator:site==='Bay'?200:100,ratePercent:siteRates[site]}));
  const fundingStatus=ledgerChanged||workbookChanged?'withhold':'recommend';
  const statusField={type:'string',enum:['recommend','withhold']};
  const discrepancies=ledgerChanged?[{site:'Elm',workbookEvents:16,ledgerEvents:15}]:
    workbookChanged?[{site:'Oak',workbookEvents:20,ledgerEvents:18}]:[];
  const finding={projectId,packageId,fundingStatus,discrepancies,eligibleSites:sites,figures,sources:['ADJ-9','LED-31','WB-17']};
  const findingsSchema={projectId:str,packageId:str,fundingStatus:statusField,
    discrepancies:arrayOf(obj({site:str,workbookEvents:num,ledgerEvents:num})),eligibleSites:list,
    figures:arrayOf(obj({site:str,affected:num,denominator:num,ratePercent:num})),sources:list};
  const state={report:null};
  function deliveryPacket(id) {
    const oak=id===packages.Oak,engineerHours=oak?32:24;
    return {packageId:id,buildHours:engineerHours,reviewHours:8,deadlineDays:oak?6:4,budgetUSD:oak?2300:2000,
    roster:[{id:'Ana',role:'engineer',hoursPerDay:8,rate:50},{id:'Dee',role:'engineer',hoursPerDay:8,rate:65},
      {id:'Val',role:'contract engineer',hoursPerDay:8,rate:80},{id:'Lee',role:'reviewer',hoursPerDay:4,rate:50}],
    plans:[{id:'phased',engineers:[{id:'Ana',hours:engineerHours}]},
      {id:'parallel',engineers:[{id:'Ana',hours:engineerHours-16},{id:'Dee',hours:16}]},
      {id:'contract',engineers:[{id:'Val',hours:engineerHours}]}],
    review:'Lee reviews the complete build from the next workday. Engineers can work concurrently. Partial days round up separately per worker. Use whole workdays, starting day 1.'};
  }
  let handoffPackage=null;
  let surveyContext=[];
  const validSources=ids=>Array.isArray(ids) && new Set(ids).size===ids.length &&
    finding.sources.every(id=>ids.includes(id)) &&
    ids.every(id=>finding.sources.includes(id)||surveyContext.includes(id));
  const rosterEvidence={cutoff:16,changes:[
    {id:'Ana',hoursPerDay:4,effective:14,signed:staffLoss},{id:'Dee',hoursPerDay:0,effective:14,signed:staffLoss},
    {id:'Val',hoursPerDay:12,effective:15,signed:ledgerChanged},
      {id:'Lee',hoursPerDay:0,effective:17,signed:true}],
    rateChanges:[{id:'Val',rate:55,effective:15,signed:ledgerChanged}],
    rule:'Only signed changes effective by cutoff override hours or rates. An assigned person with zero capacity makes that plan unavailable.'};
  const chosen=ledgerChanged?'contract':staffLoss||eastWithdraws?'phased':'parallel';
  const finish=ledgerChanged?4:staffLoss?10:eastWithdraws?6:4;
  const solution={projectId,packageId,fundingStatus,plan:chosen,staff:ledgerChanged?['Val','Lee']:chosen==='parallel'?['Ana','Dee','Lee']:['Ana','Lee'],
    feasible:!workbookChanged,costUSD:ledgerChanged?1720:chosen==='parallel'?1840:2000,finishDay:finish,extensionDays:workbookChanged?4:0};
  const stages=[
    makeStage('RR-02','Determine participating sites as of the signed sponsor cutoff. Deduplicate comments by original respondent record and honor consent revocation. Give eligible original evidence IDs, withdrawn site, themes and sites with conflicting accounts of frequency. Use theme codes duplicate_entry, approval_wait and repeat_checks. Explain what can and cannot be concluded from each eligible group.',
      {projectId:str,sites:list,withdrawn:str,topics:list,disputedFrequencySites:list,evidenceIds:list},feedback,[
        reader('get_responses','Get attributed original and retransmitted comments.',comments),
        reader('get_participation','Read signed sponsor changes, effective times and consent.',participation),
      ],[call('get_responses'),call('get_participation')],{minReads:{get_responses:1,get_participation:1}}),
    makeStage('RR-06','Reconcile each participating site against the workbook, signed adjustments and independent ledger. Report normalized workbook figures for each site. List discrepancies using the normalized workbook count and ledger count, or an empty list if all agree. Follow the ranking rule and identify the leading candidate package even if funding is withheld. Save and verify the decision, figures, discrepancies and source IDs. Cite the workbook, adjustments and ledger for numerical findings. Eligible original survey IDs from the handoff may be retained as context.',
      findingsSchema,finding,[reader('get_workbook','Retrieve the consolidated workbook.',workbook),
        reader('get_adjustments','Read the approved method and signed corrections.',adjustments),
        reader('get_site_ledger','Read eligible site counts and work-package identifiers.',ledger),
        tool('save_finding','Save the selected work package and reconciled site results.',findingsSchema,a=>{
          if(!Object.values(packages).includes(a.packageId))throw Error('Unknown work package ID');
          state.report={...a,eligibleSites:[...a.eligibleSites].sort(),sources:[...a.sources].sort(),
            figures:[...a.figures].sort((x,y)=>x.site.localeCompare(y.site))};return {saved:true};
        }),
        tool('read_finding','Retrieve the persisted finding.',{},()=>structuredClone(state.report)),
      ],[call('get_workbook'),call('get_adjustments'),call('get_site_ledger'),call('save_finding',finding),call('read_finding')],{
        minReads:{get_workbook:1,get_adjustments:1,get_site_ledger:1},fieldChecks:{sources:validSources},
        handoffIssue(input){
          surveyContext=evidence.filter(id=>input?.evidenceIds?.includes(id));
          return input?.projectId===projectId&&Array.isArray(input.sites)&&input.sites.length>0&&
            input.sites.every(site=>Object.hasOwn(packages,site)) ? null : 'Invalid project or site scope';
        },
        stateCheck(trace,answer){
          const ids=state.report?.sources;
          const ok=validSources(ids) && Array.isArray(answer?.sources) && same(ids,[...answer.sources].sort()) &&
            same({...state.report,sources:finding.sources},finding);
          return [...(!ok?['incorrect reconciled finding']:[]),
            ...(!verifiedAfter(trace,'read_finding',['save_finding'])?['missing report verification']:[])];
        },
      }),
    makeStage('SD-05','Carry forward the verified fundingStatus and packageId. Preserve the recorded funding disposition in both the fields and explanation. Describe a hold only for a withheld package; a recommendation is distinct from a hold or a release of funds. Use the exact package to look up options and apply effective staffing and rate changes. Evaluate all three plans, including the separate review dependency. Choose the cheapest on-time plan within budget or the least deadline extension within budget, breaking ties by cost. Set feasible according to whether the selected plan meets the original deadline and budget. Report a late fallback with feasible=false and the required extension. Report finish day and rejected alternatives separately from funding.',
      {projectId:str,packageId:str,fundingStatus:statusField,plan:str,staff:list,feasible:bool,costUSD:num,finishDay:num,extensionDays:num},solution,[
        tool('get_delivery_capacity','Read resources for the selected package by its exact upstream identifier.',{packageId:str},a=>{
          if(!handoffPackage||a.packageId!==handoffPackage)throw Error('Package ID differs from the handoff');
          return deliveryPacket(a.packageId);
        }),reader('get_staffing_changes','Read signed roster changes and cutoff.',rosterEvidence),
      ],[call('get_delivery_capacity',{packageId}),call('get_staffing_changes')],{
        minReads:{get_delivery_capacity:1,get_staffing_changes:1},
        handoffIssue(input,connected){
          handoffPackage=null;
          if(!input||input.projectId!==projectId||!Object.values(packages).includes(input.packageId))return 'Invalid project or package identifier';
          if(!statusField.enum.includes(input.fundingStatus))return 'Funding disposition missing in handoff';
          if(connected&&(!state.report||state.report.packageId!==input.packageId||state.report.fundingStatus!==input.fundingStatus))return 'Package or funding decision differs from persisted finding';
          handoffPackage=input.packageId;
          return null;
        },
      })
  ];
  return {caseRef:projectId,stages,state};
}
