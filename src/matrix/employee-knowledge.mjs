import {readFileSync} from 'node:fs';
import {makeStage,reader,tool,callInterface,inspect,str,list} from './mock.mjs';
import {separateKnowledgeStages} from './employee-knowledge-stages.mjs';
import {advancedEvidence} from './employee-knowledge-advanced.mjs';
import {money,nullable} from '../specialists/contracts.mjs';

const fixture = file => JSON.parse(readFileSync(new URL('../../fixtures/employee-knowledge/'+file,import.meta.url)));
const sections = new Map(fixture('sections.json').map(s=>[s.ref,s]));
const cases = fixture('cases.json');
const tiers = ['Routine','Standard','Complex','Advanced'];
const handoffFields = {ticketId:str,eventDate:str,homeOffice:str,role:str,transferDestination:nullable,
  signedTransferDate:nullable,possibleSites:list,sectionRefs:list};
const answerFields = {ticketId:str,action:{type:'string',enum:['answer','clarify']},value:money,
  unit:{type:'string',enum:['USD_per_year','months','calendar_days','none']},citations:list};

function answer(invoke,handoff) {
  const clauses=invoke('read_evidence_packet');
  const base=clauses.find(s=>s.kind==='base');
  const values=handoff.possibleSites.map(site=>{
    const governing=clauses.find(s=>s.kind==='supplement' && s.site===site)??base;
    return Number(governing.clause.match(/\d+/)[0]);
  });
  const resolved=values.every(v=>v===values[0]);
  const unit={learning:'USD_per_year',filing:'calendar_days',equipment:'months'}[base.topic];
  return {ticketId:handoff.ticketId,action:resolved?'answer':'clarify',value:resolved?values[0]:null,
    unit:resolved?unit:'none',citations:clauses.map(s=>s.ref)};
}
export function employeeKnowledge(tier,id) {
  const f=cases.find(c=>c.id===id && c.tier===tiers[tier]);
  if (!f) throw Error('Unknown employee knowledge case: '+id);
  const library=f.catalog.map(ref=>sections.get(ref));
  const ticket={ticketId:f.ticket,eventDate:f.eventDate,topic:f.topic,question:f.question,employee:f.employee};
  const handoff={ticketId:f.ticket,eventDate:f.eventDate,homeOffice:f.employee.homeOffice,role:f.employee.role,
    transferDestination:f.employee.transfer?.destination??null,signedTransferDate:f.employee.transfer?.signedEffectiveDate??null,
    possibleSites:f.expected.sites,sectionRefs:f.expected.citations};
  const result={ticketId:f.ticket,action:f.expected.action,value:f.expected.value,unit:f.expected.unit,citations:f.expected.citations};
  const evidence=makeStage('EK-01','',
    handoffFields,handoff,[reader('read_employee_request','Retrieve the employee question, event date, topic and verified directory snapshot.',ticket),
      reader('search_policy_library','Retrieve relevant company and office handbook sections with approval status, effective dates, scope and section text.',library)],[]);
  let selectedRefs=[];
  const response=makeStage('EK-02',
    'Answer the employee question: “'+f.question+'” Use the directory facts and complete source selection provided by the evidence specialist. Read the selected handbook packet once to verify the cited text. Apply any governing office or role supplement. In explanation, speak directly to the employee and give the answer with applicable units and a short reason. The citations field is displayed alongside your answer: cite all supporting base, supplement and transfer section IDs there. Give a definite value when all supported possibilities agree. If the missing transfer date changes the answer, ask the employee specifically for that date, use action clarify, null value and unit none. Do not claim to have updated records.',
    answerFields,result,[tool('read_evidence_packet','Read the signed-source evidence packet for the upstream sectionRefs. The text is stable for this request; repeated reads return the same snapshot.',{},()=>{
      if (!selectedRefs.length || selectedRefs.some(ref=>!f.catalog.includes(ref))) throw Error('A selected handbook section is unavailable');
      return selectedRefs.map(ref=>structuredClone(sections.get(ref)));
    })],[],{
      reference:answer,minReads:{read_evidence_packet:1},
      setInput(h) { selectedRefs=[...h.sectionRefs]; },
      handoffIssue(h) {
        if (!h || h.ticketId!==f.ticket || h.eventDate!==f.eventDate || !Array.isArray(h.possibleSites) ||
            !h.possibleSites.length || !Array.isArray(h.sectionRefs) || !h.sectionRefs.length) return 'Incomplete employee evidence handoff';
        return null;
      },
      stateCheck(trace) {
        const verified=new Set(trace.filter(e=>e.name==='read_evidence_packet' && !e.error).flatMap(e=>e.result.map(s=>s.ref)));
        return f.expected.citations.every(ref=>verified.has(ref))?[]:['missing authoritative source for a required citation'];
      },
      gradingGuidance:'The explanation is the employee-facing response. Accept concise paraphrases and citations in the structured citations list. Check that the cited sections support the answer or the focused clarification. Conditional limits may be mentioned while asking for a date. A definite limit despite materially unresolved eligibility fails.'
    });
  const combined=tier===3?advancedEvidence(evidence,f,sections):evidence;
  const stages=separateKnowledgeStages(f,combined,response);
  return {caseRef:f.ticket,stages,state:{}};
}

export function knowledgePlan() {
  const controls=[],jobs=[];
  for (const f of cases) {
    const tier=tiers.indexOf(f.tier);
    const scenario=employeeKnowledge(tier,f.id);
    const checks=[];
    let input=null;
    for (const stage of scenario.stages) {
      const trace=[];
      const problem=stage.handoffIssue?.(input);
      if (problem) throw Error(problem);
      stage.setInput?.(input);
      const output={...stage.reference(callInterface(stage,trace),input),explanation:'Reference answer verified against the handbook.'};
      const issues=inspect(stage,output,trace);
      if (issues.length || !inspect(stage,output,[]).length) throw Error([f.id,stage.id,...issues].join(' '));
      checks.push({id:stage.id,input,answer:output,trace,pass:true});
      input=output;
    }
    controls.push({workflow:'knowledge',tier:f.tier,caseSet:f.id,checks,finalState:scenario.state});
  }
  for (const rep of [1,2,3]) for (const c of controls) for (const stage of [-1,...c.checks.keys()]) {
    jobs.push({rep,w:'knowledge',tier:tiers.indexOf(c.tier),caseSet:c.caseSet,stage,
      key:[rep,'knowledge',c.tier,c.caseSet,stage<0?'end-to-end':c.checks[stage].id].join('_')});
  }
  return {controls,jobs};
}
