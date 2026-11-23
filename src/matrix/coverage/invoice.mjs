// Source amounts are whole USD. Each billed line gives quantity and unit price;
// an accepted receipt is an allocation to the corresponding numbered invoice lines.
export const invoiceCases=[
  {id:'packing-supplies',tier:0,description:'Match six cartons of packing supplies on a single accepted receipt.',number:851,
    billed:[[6,12]],accepted:[[72]],expected:{gross:72,payable:72,disputed:0,credit:0,changedLines:[]}},
  {id:'courier-and-handling',tier:0,description:'Match a separately itemized courier charge and handling fee to one receipt.',number:852,
    billed:[[1,48],[1,12]],accepted:[[48,12]],expected:{gross:60,payable:60,disputed:0,credit:0,changedLines:[]}},
  {id:'split-deliveries',tier:1,description:'Combine two partial deliveries of the same line and release the complete balance.',number:853,
    billed:[[5,20],[1,35]],accepted:[[40,35],[60,0]],expected:{gross:135,payable:135,disputed:0,credit:0,changedLines:[]}},
  {id:'short-service',tier:1,description:'Dispute two unaccepted service hours while settling the accepted hours and callout fee.',number:854,
    billed:[[4,25],[1,30]],accepted:[[50,0],[0,30]],expected:{gross:130,payable:80,disputed:50,credit:0,changedLines:[]}},
  {id:'revised-order-credit',tier:2,description:'Reconcile a two-line amendment and duplicate posted credit, then renew stale authorization.',number:855,
    previous:[[2,50],[1,30]],billed:[[2,45],[1,40]],accepted:[[90,0],[0,30]],credits:[['CM-855','L1',15,'posted'],['CM-855','L1',15,'posted']],
    approval:{revision:'v1',authorized:130},expected:{gross:130,payable:105,disputed:10,credit:15,changedLines:['L1','L2']}},
  {id:'voided-credit',tier:2,description:'Apply two distinct posted credits on a revised bill and disregard a voided credit.',number:856,
    previous:[[1,85],[2,30]],billed:[[1,75],[2,30]],accepted:[[75,0],[0,60]],credits:[['CM-856A','L1',5,'posted'],['CM-856B','L2',10,'posted'],['CM-856C','L2',18,'voided']],
    expected:{gross:135,payable:120,disputed:0,credit:15,changedLines:['L1']}}
];

export function invoiceRecords(f) {
  const invoiceId='AP-'+f.number,po='PO-'+f.number,revision=f.previous?'v2':'v1';
  function document(version,items) {
    const pages=items.map(([qty,price],i)=>({page:f.tier===1?i+1:1,
      text:`Order line L${i+1} | quantity ${qty} | unit price USD ${price}.00`}));
    return {source:invoiceId+'-'+version,version,invoiceId,purchaseOrder:po,pages,
      printedTotal:items.reduce((s,[qty,price])=>s+qty*price,0)};
  }
  const current=document(revision,f.billed);
  const original=f.previous?document('v1',f.previous):current;
  const inbox={documents:f.previous?[original,current]:[current],syncStatus:'current'};
  const lines=f.billed.map(([qty,price],i)=>({line:'L'+(i+1),amount:qty*price}));
  const receiptRows=f.accepted.map((row,i)=>({id:`GR-${f.number}-${i+1}`,
    accepted:row.flatMap((amount,j)=>amount?[{line:lines[j].line,amount}]:[])}));
  const credits=(f.credits??[]).map(([id,line,amount,status])=>({id,line,amount,status}));
  const {gross,payable,disputed,credit,changedLines}=f.expected;
  const approval=f.approval??{revision,authorized:payable};
  const data={order:{id:po,lines},receipts:receiptRows,credits,approval};
  const posted=[...new Map(credits.filter(c=>c.status==='posted').map(c=>[c.id,c])).values()];
  const split=lines.map(({line},i)=>({line,amount:f.accepted.reduce((s,row)=>s+row[i],0)-
    posted.filter(c=>c.line===line).reduce((s,c)=>s+c.amount,0)})).filter(l=>l.amount>0);
  const receiptIds=receiptRows.map(r=>r.id);
  const extracted={invoiceId,po,revision,source:current.source,gross,lines,changedLines};
  const reconciled={invoiceId,revision,payable,disputed,credit,receiptIds,freshApproval:approval.revision!==revision||approval.authorized<payable};
  const final={invoiceId,revision,posted:payable,disputed,postingCount:1,disputeCount:disputed?1:0};
  return {inbox,original,data,split,extracted,reconciled,final};
}
