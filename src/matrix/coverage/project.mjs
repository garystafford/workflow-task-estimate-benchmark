// Metric tuples are site, theme, workbook events, reopened events, total cases,
// independently counted ledger cases and the candidate package.
export const projectCases=[
  {id:'approval-reminders',tier:0,description:'Validate approval delays and cost a small reminder pilot.',number:41,
    comments:[['R1','Alder','clerk','Requests sit waiting for supervisor approval.'],['R2','Alder','lead','We wait for signatures on approval requests.']],
    metrics:[['Alder','approval_wait',9,0,60,9,'ALDER-REMIND']],topics:['approval_wait'],disagreement:false,
    scope:'ALDER-REMIND',affected:9,denominator:60,rate:15,skill:'automation',hours:12,budget:800,deadline:4,
    people:[['Kai','Alder','automation',6,50]],plans:[['reminder',[['Kai',12]]]],
    solution:[true,'reminder',['Kai'],600,2,0]},
  {id:'address-import',tier:0,description:'Validate re-entry of addresses and choose between two qualified implementers.',number:42,
    comments:[['I1','Pine','agent','We copy each mailing address into a second form.'],['I2','Pine','clerk','Typing addresses twice causes rework.']],
    metrics:[['Pine','duplicate_entry',8,0,50,8,'PINE-IMPORT']],topics:['duplicate_entry'],disagreement:false,
    scope:'PINE-IMPORT',affected:8,denominator:50,rate:16,skill:'forms',hours:10,budget:700,deadline:3,
    people:[['Rin','Pine','forms',5,60],['Teo','Pine','forms',5,44]],plans:[['lead',[['Rin',10]]],['local',[['Teo',10]]]],
    solution:[true,'local',['Teo'],440,2,0]},
  {id:'threshold-pilot',tier:1,description:'Resolve disagreement about repeat entry, remove reopened events, and apply the inclusive threshold.',number:43,
    comments:[['T1','Cedar','clerk','I repeat the intake entry most days.'],['T2','Cedar','manager','Duplicate entry happens only rarely here.']],
    metrics:[['Cedar','duplicate_entry',13,5,80,8,'CEDAR-FORM']],topics:['duplicate_entry'],disagreement:true,
    scope:'CEDAR-FORM',affected:8,denominator:80,rate:10,skill:'forms',hours:15,budget:950,deadline:4,
    people:[['Dev','Cedar','analysis',8,40],['Uma','Cedar','forms',5,55]],plans:[['analyst',[['Dev',15]]],['specialist',[['Uma',15]]]],
    solution:[true,'specialist',['Uma'],825,3,0]},
  {id:'review-calendar',tier:1,description:'Reconcile approval delays and identify the one-day staffing extension.',number:44,
    comments:[['D1','Lake','reviewer','Approval queues hold up files every week.'],['D2','Lake','clerk','Waiting on approvals is our recurring delay.']],
    metrics:[['Lake','approval_wait',18,3,100,15,'LAKE-ALERT']],topics:['approval_wait'],disagreement:false,
    scope:'LAKE-ALERT',affected:15,denominator:100,rate:15,skill:'automation',hours:18,budget:1100,deadline:3,
    people:[['Sol','Lake','automation',5,50],['Ivy','Lake','automation',0,40]],plans:[['on-duty',[['Sol',18]]],['on-leave',[['Ivy',18]]]],
    solution:[false,'on-duty',['Sol'],900,4,1]},
  {id:'switch-site',tier:2,description:'Normalize two sites, switch scope to the qualifying approval queue, and meet the deadline with parallel staff.',number:45,
    comments:[['S1','Ash','clerk','We type contacts into two forms.'],['S2','Reed','agent','Approval queues are long most weeks.'],['S3','Reed','manager','Approval delays here are rare.']],
    metrics:[['Ash','duplicate_entry',21,7,200,14,'ASH-FORM'],['Reed','approval_wait',17,5,60,12,'REED-QUEUE']],topics:['duplicate_entry','approval_wait'],disagreement:true,
    scope:'REED-QUEUE',affected:12,denominator:60,rate:20,skill:'automation',hours:24,budget:1700,deadline:3,
    people:[['Fox','Reed','automation',5,50],['Nia','Reed','automation',5,70]],plans:[['solo',[['Fox',24]]],['parallel',[['Fox',12],['Nia',12]]]],
    solution:[true,'parallel',['Fox','Nia'],1440,3,0]},
  {id:'competing-pilots',tier:2,description:'Rank two qualifying sites by incidence and select the smallest affordable deadline extension.',number:46,
    comments:[['P1','Pond','agent','Sign-off waiting time delays intake.'],['P2','Glen','clerk','The portal asks us to enter each address twice.'],['P3','Glen','manager','Repeated address entry affects our team.']],
    metrics:[['Pond','approval_wait',22,4,120,18,'POND-QUEUE'],['Glen','duplicate_entry',15,5,50,10,'GLEN-IMPORT']],topics:['approval_wait','duplicate_entry'],disagreement:false,
    scope:'GLEN-IMPORT',affected:10,denominator:50,rate:20,skill:'forms',hours:30,budget:1900,deadline:3,
    people:[['Val','Glen','forms',6,50],['Paz','Glen','forms',3,70],['Ren','Glen','forms',10,80]],
    plans:[['solo',[['Val',30]]],['paired',[['Val',18],['Paz',12]]],['fast',[['Ren',30]]]],
    solution:[false,'paired',['Val','Paz'],1740,4,1]}
];

export function projectRecords(f) {
  const projectId='INTAKE-'+f.number,workbookId='WB-'+projectId,ledgerId='LED-'+projectId,methodId='METHOD-2';
  const comments=f.comments.map(([id,site,role,text])=>({id,site,role,text}));
  const sites=[...new Set(comments.map(c=>c.site))];
  const packet={projectId,comments,participatingSites:sites,participationStatus:'confirmed'};
  const feedback={projectId,sites,topics:f.topics,disagreement:f.disagreement,excluded:[]};
  const records=f.metrics.map(([site,topic,workbookEvents,reopened,cases,ledgerDistinct,scope])=>
    ({site,topic,workbookEvents,reopened,cases,ledgerDistinct,package:scope}));
  const operational={workbookId,ledgerId,methodId,approvedMethod:'Exclude repeat events on reopened cases. Reconcile distinct affected cases to the ledger. Divide by all cases at the site. A site qualifies at or above 10 percent. Recommend the highest eligible site rate if more than one qualifies.',records};
  const sources=[workbookId,ledgerId,methodId].sort();
  const finding={projectId,scope:f.scope,affected:f.affected,denominator:f.denominator,ratePercent:f.rate,sources};
  const people=f.people.map(([id,site,skill,availableHoursPerDay,usdPerHour])=>({id,site,skill,availableHoursPerDay,usdPerHour}));
  const plans=f.plans.map(([id,assignments])=>({id,assignment:assignments.map(([person,hours])=>({person,hours}))}));
  const packages=records.map(row=>row.package===f.scope?{scope:f.scope,skill:f.skill,hours:f.hours,budgetUsd:f.budget,deadlineDays:f.deadline,plans}:
    {scope:row.package,skill:'triage',hours:12,budgetUsd:700,deadlineDays:4,plans:[]});
  const resources={projectId,participatingSites:sites,packages,people,rules:'Work starts on day 1. Every assigned worker must have the package skill, belong to a participating site, and have positive capacity. Assignments run concurrently. Finish day is the longest assigned duration rounded up. Choose the cheapest feasible listed plan. If none is feasible, choose the smallest deadline extension for an otherwise eligible, affordable plan and give its plan ID, staff and cost.'};
  const [feasible,plan,staff,costUsd,finishDay,extensionDays]=f.solution;
  const solution={projectId,scope:f.scope,feasible,plan,staff,costUsd,finishDay,extensionDays};
  return {packet,feedback,operational,finding,resources,solution};
}
