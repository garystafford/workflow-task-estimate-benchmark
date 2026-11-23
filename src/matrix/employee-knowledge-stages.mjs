import {makeStage,str} from './mock.mjs';
import {nullable} from '../specialists/contracts.mjs';

const factFields={ticketId:str,eventDate:str,topic:str,homeOffice:str,role:str,transferOrigin:nullable,
  transferDestination:nullable,signedTransferDate:nullable,handbookRef:nullable};

export function readTransfer(invoke,fileRef) {
  let ref=fileRef,origin=null,destination=null,signedDate=null;
  while(ref) {
    const record=invoke('open_hr_record',{ref});
    if(record.origin && record.kind!=='withdrawn request') {
      origin=record.origin;
      destination=record.destination;
    }
    if(record.kind.startsWith('executed ')) signedDate=record.effectiveDate;
    if(record.kind==='execution envelope') signedDate=record.signedEffectiveDate;
    ref=record.nextRef;
  }
  return {transferOrigin:origin,transferDestination:destination,signedTransferDate:signedDate};
}

function establishFacts(invoke) {
  const t=invoke('read_employee_request');
  const transfer=t.transferFileRef?readTransfer(invoke,t.transferFileRef):{
    transferOrigin:t.employee.transfer?.origin??null,transferDestination:t.employee.transfer?.destination??null,
    signedTransferDate:t.employee.transfer?.signedEffectiveDate??null};
  return {ticketId:t.ticketId,eventDate:t.eventDate,topic:t.topic,role:t.employee.role,
    homeOffice:t.employee.homeOffice,handbookRef:t.handbookRef??null,...transfer};
}

function selectPolicies(invoke,facts) {
  const {ticketId,eventDate,homeOffice,role,transferOrigin,transferDestination,signedTransferDate,topic,handbookRef}=facts;
  let possibleSites=[homeOffice];
  if(transferDestination) {
    possibleSites=signedTransferDate?[eventDate<signedTransferDate?transferOrigin:transferDestination]:[transferOrigin,transferDestination];
  }
  let governing;
  if(handbookRef) {
    const base=invoke('read_policy_section',{ref:handbookRef});
    const mobility=invoke('read_policy_section',{ref:base.mobilityRef});
    const supplements=possibleSites.map(office=>invoke('lookup_office_supplement',{register:base.officeRegister,office}));
    governing=[base,mobility,...supplements];
  } else {
    governing=invoke('search_policy_library').filter(s=>s.status==='signed' && s.start<=eventDate && eventDate<=s.end
      && s.topic===topic && (s.role==='all' || s.role===role) && (s.site==='all' || possibleSites.includes(s.site)));
  }
  return {ticketId,eventDate,homeOffice,role,transferDestination,signedTransferDate,possibleSites,
    sectionRefs:governing.map(s=>s.ref)};
}

function missingRefs(trace,required) {
  const seen=new Set(trace.filter(e=>!e.error).flatMap(e=>[e.result].flat().map(s=>s.ref)));
  return required.filter(ref=>!seen.has(ref)).map(ref=>'missing primary evidence: '+ref);
}

export function separateKnowledgeStages(f,combined,response) {
  const hrTools=new Set(['read_employee_request','open_hr_record']);
  const expected=combined.expected;
  const facts=makeStage('EK-03',[
    'Establish the employee facts for the next policy specialist. Read the request and carry its ticket ID, event date, exact topic, directory home office and role.',
    'If a transfer filing is linked, follow amendments, replacements and signature envelopes to establish the active origin, destination and signed effective date. A target or proposed date is insufficient. Use null for absent transfer fields.',
    'Carry the handbookRef from intake when supplied, otherwise null. Briefly explain the source of the facts. Policy selection and the employee answer belong to the downstream specialists.'
  ].join(' '),factFields,{ticketId:f.ticket,eventDate:f.eventDate,topic:f.topic,homeOffice:f.employee.homeOffice,
    role:f.employee.role,transferOrigin:f.employee.transfer?.origin??null,transferDestination:expected.transferDestination,
    signedTransferDate:expected.signedTransferDate,handbookRef:combined.handbookRoot??null},
    combined.tools.filter(t=>hrTools.has(t.definition.name)),[],{
      minReads:{read_employee_request:1},reference:establishFacts,
      stateCheck:trace=>missingRefs(trace,combined.filingRefs??[])
    });
  const policy={...combined,request:[
    'Select the handbook sections that govern the employee question using the facts in the actual upstream handoff. Preserve the ticket ID, event date, directory home office, role, transfer destination and signed effective date.',
    'Use the linked handbook reference when supplied, otherwise search the policy library. Read the signed company base in force on the event date (inclusive), and the applicable signed office or role supplements.',
    'For a transfer, read the mobility rule, then apply it to the course date. Resolve possibleSites to the governing office when the date is signed, or keep both possible offices when the date is unestablished, even if the allowances agree.',
    'Return only governing section IDs in sectionRefs, including the mobility rule for a transfer. Omit supplements for offices outside possibleSites. Explain the selection briefly.'
  ].join(' '),tools:combined.tools.filter(t=>!hrTools.has(t.definition.name)),reference:selectPolicies,
    minReads:combined.handbookRoot?{read_policy_section:1}:{search_policy_library:1},
    setInput:combined.setPolicyInput,
    handoffIssue:h=>!h || h.ticketId!==f.ticket || !h.eventDate || !h.topic || !h.homeOffice || !h.role
      ?'Incomplete employee fact handoff':null,
    stateCheck:trace=>missingRefs(trace,expected.sectionRefs)};
  return [facts,policy,response];
}
