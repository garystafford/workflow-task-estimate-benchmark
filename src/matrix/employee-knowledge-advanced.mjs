import {readFileSync} from 'node:fs';
import {str,tool} from './mock.mjs';

const filings=JSON.parse(readFileSync(new URL('../../fixtures/employee-knowledge/transfer-filings.json',import.meta.url)));
const handbookRoot='LEARN-B.2';
const officeRegister='Learning / local supplements';

export function advancedEvidence(stage,employeeCase,sections) {
  const f=employeeCase;
  const filing=filings[f.ticket];
  const hrRefs=new Set(),policyRefs=new Set(),offices=new Set();
  let registerOpen=false;
  const tools=[
    tool('read_employee_request','Read the question, employee directory entry, transfer filing reference and company handbook reference.',{},()=>{
      hrRefs.add(filing.fileRef);
      policyRefs.add(handbookRoot);
      offices.add(f.employee.homeOffice);
      return {ticketId:f.ticket,question:f.question,eventDate:f.eventDate,topic:f.topic,
        employee:{homeOffice:f.employee.homeOffice,role:f.employee.role},
        transferFileRef:filing.fileRef,handbookRef:handbookRoot};
    }),
    tool('open_hr_record','Read one HR filing or signature envelope using an exact reference returned by the ticket or a previously opened filing.',{ref:str},({ref})=>{
      if(!hrRefs.has(ref)) throw Error('Use an HR reference returned by the ticket or an opened filing.');
      const record=filing.records[ref];
      if(record.nextRef) hrRefs.add(record.nextRef);
      if(record.origin) offices.add(record.origin);
      if(record.destination) offices.add(record.destination);
      return {ref,...record};
    }),
    tool('read_policy_section','Read one linked handbook section. The learning policy identifies its office register and its cross-reference for transfers.',{ref:str},({ref})=>{
      if(!policyRefs.has(ref)) throw Error('Use a handbook reference returned by the ticket or an opened section.');
      const section=sections.get(ref);
      if(section.kind!=='base') return structuredClone(section);
      policyRefs.add('MOB.6');
      registerOpen=true;
      return {...section,officeRegister,mobilityRef:'MOB.6'};
    }),
    tool('lookup_office_supplement','Read the signed supplement in force on the course date for one office identified in the employee records. Supply the register named by the company policy.',{register:str,office:str},({register,office})=>{
      if(!registerOpen || register!==officeRegister || !offices.has(office))
        throw Error('Use the register from the company policy and an office identified in the employee records.');
      const match=f.catalog.map(ref=>sections.get(ref)).find(s=>s.kind==='supplement' && s.topic===f.topic &&
        s.site===office && s.status==='signed' && s.start<=f.eventDate && f.eventDate<=s.end);
      if(!match) throw Error('No applicable supplement for this office in the case register.');
      return structuredClone(match);
    })
  ];
  return {...stage,tools,handbookRoot,filingRefs:Object.keys(filing.records),
    setPolicyInput(h) {
      policyRefs.clear();
      offices.clear();
      registerOpen=false;
      if(h.handbookRef===handbookRoot) policyRefs.add(h.handbookRef);
      for(const office of [h.homeOffice,h.transferOrigin,h.transferDestination]) if(office) offices.add(office);
    }
  };
}
