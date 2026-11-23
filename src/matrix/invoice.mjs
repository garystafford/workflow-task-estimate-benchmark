import {makeStage, reader, tool, call, obj, str, num, list, bool, arrayOf, same, verifiedAfter} from './mock.mjs';

import {invoiceRecords} from './coverage/invoice.mjs';

function baseRecords(t) {
  const standard=t===1, complex=t===2;
  const invoiceId='AP-'+(740+t), po='PO-'+(820+t), revision=(complex)?'v2':'v1';
  const amounts=[[100],[20,50,30],[60,60]][t];
  const lines=amounts.map((amount,i)=>({line:'L'+(i+1),amount}));
  const gross=[100,100,120][t], payable=[100,70,90][t], disputed=[0,30,20][t];
  const supported=[[100],[20,50,0],[60,40]][t], credit=complex?10:0;
  function document(version,values) {
    const pages=values.map((n,i)=>({page:standard&&i===2?2:1,text:'Order line L'+(i+1)+' | quantity 1 | unit price USD '+n+'.00'}));
    return {source:invoiceId+'-'+version,version,invoiceId,purchaseOrder:po,pages,printedTotal:values.reduce((a,b)=>a+b,0)};
  }
  const current=document(revision,amounts);
  const inbox={documents:complex?[document('v1',[60,80]),current]:[current],syncStatus:'current'};
  const receipts=complex?['GR-21','GR-22']:standard?['GR-11','GR-12']:['GR-10'];
  const data={order:{id:po,lines},receipts:receipts.map((id,i)=>({id,accepted:lines.flatMap((l,j)=>
    j%receipts.length===i&&supported[j]?[{line:l.line,amount:supported[j]}]:[])})),
    credits:complex?[{id:'CM-4',line:'L1',amount:credit,status:'posted'},{id:'CM-4',line:'L1',amount:credit,status:'posted'}]:[],
    approval:{revision:revision,authorized:payable}};
  const extracted={invoiceId,po,revision,source:current.source,gross,lines,changedLines:(complex?['L2']:[])};
  const reconciled={invoiceId,revision,payable,disputed,credit,receiptIds:receipts,freshApproval:false};
  const final={invoiceId,revision,posted:payable,disputed,postingCount:1,disputeCount:disputed?1:0};
  const split=complex?[{line:'L1',amount:50},{line:'L2',amount:40}]:lines.map((l,i)=>({line:l.line,amount:supported[i]})).filter(l=>l.amount);
  return {inbox,data,split,extracted,reconciled,final};
}

export function invoice(t,fixture) {
  const {inbox,data,split,extracted,reconciled,final}=fixture?invoiceRecords(fixture):baseRecords(t);
  const {invoiceId,revision}=extracted;
  const {payable,disputed,receiptIds:evidence,freshApproval}=reconciled;
  const lineFields={line:str,amount:num};
  const allocationFields={line:str,accepted:num,appliedCredits:arrayOf(obj({id:str,amount:num})),payable:num};
  const postedCredits=new Map(data.credits.filter(c=>c.status==='posted').map(c=>[c.id,c]));
  const acceptedLines=data.receipts.flatMap(receipt=>receipt.accepted);
  const lineAllocations=extracted.lines.map(({line})=>{
    const accepted=acceptedLines.filter(part=>part.line===line).reduce((sum,part)=>sum+part.amount,0);
    const appliedCredits=[...postedCredits.values()].filter(c=>c.line===line).map(({id,amount})=>({id,amount}));
    const payable=accepted-appliedCredits.reduce((sum,c)=>sum+c.amount,0);
    return {line,accepted,appliedCredits,payable};
  });
  const state={postings:[],disputes:[],approval:structuredClone(data.approval)};
  const approvals=()=>({approval:state.approval,lineAuthorizations:split});
  const posting={invoiceId,revision,amount:payable};
  const dispute={invoiceId,revision,amount:disputed,evidence};
  const stages=[
    makeStage('FP-03','Extract the latest invoice into whole USD. Retain the exact source, PO and line identifiers. Compare versions and report changed line IDs (empty for an original). If an upload is in flight refresh the inbox before handing off.',{invoiceId:str,po:str,revision:str,source:str,gross:num,lines:arrayOf(obj(lineFields)),changedLines:list},extracted,[
      reader('read_invoice_inbox','Read scanned invoice page transcriptions and source metadata.',inbox)
    ],[call('read_invoice_inbox')],{minReads:{read_invoice_inbox:1}}),
    makeStage('FP-04','Reconcile the handed-off invoice against the PO, receipts and distinct posted credits. Report the net payable and disputed amounts, total applied credit, every supporting receipt ID, and whether the approval must be refreshed for this revision. For every billed line, hand off its accepted receipt amount, each distinct posted credit ID and amount applied to that line, and the resulting net payable. Include lines with zero payable and use an empty credit list when appropriate.',{invoiceId:str,revision:str,payable:num,disputed:num,credit:num,receiptIds:list,freshApproval:bool,lineAllocations:arrayOf(obj(allocationFields))},{...reconciled,lineAllocations},[
      reader('read_purchase_records','Retrieve order, accepted receipts, credits and existing approval.',data)
    ],[call('read_purchase_records')],{
      minReads:{read_purchase_records:1},
      gradingGuidance:'The specialist receives the upstream invoice and can read purchasing records. An explanation may say it could not independently access an upstream source. Distinguish that stage-local limitation from a claim of a system outage, a failed tool call or a missing upstream verification. Require evidence for those claims.'
    }),
    makeStage('FP-06','Settle the handed-off recommendation in whole USD. Treat the reconciled handoff as the verified invoice record. Compare its revision directly with the revision returned by read_approval and match each net line payable to its authorization. These are the records used for settlement; an independent scan or filesystem read is unnecessary. A zero-payable line needs no posting authority. Check that accepted amounts less the listed credits equal the line payables and that they sum to the recommended total. Obtain current approval if needed. When the checks agree and the authorized payment is absent from the ledger, call post_ledger for the authorized total and verify it by readback. If already posted, verify the existing entry and avoid a duplicate. Route a positive disputed balance with the supporting receipt IDs. Read back both records, including all revisions, before reporting the counts. After uncertain writes check ledger state before any retry.',{invoiceId:str,revision:str,posted:num,disputed:num,postingCount:num,disputeCount:num},final,[
      tool('read_approval','Read approval for this invoice and the authorized line amounts.',{},approvals),
      tool('request_approval','Request a decision from the simulated authorizer for the specified revision and amount.',{revision:str,amount:num},a=>{
        if(a.revision!==revision || a.amount!==split.reduce((s,l)=>s+l.amount,0))throw Error('Approval denied');
        state.approval={revision:a.revision,authorized:a.amount};return approvals();
      }),
      tool('post_ledger','Create a ledger posting. Check ledger state if the acknowledgment is lost.',{invoiceId:str,revision:str,amount:num},a=>{
        if(a.invoiceId!==invoiceId||a.revision!==state.approval.revision||a.amount!==state.approval.authorized)throw Error('Invalid authorization');
        state.postings.push({...a});

        return {accepted:true};
      }),
      tool('open_dispute','Open a dispute with supporting receipt IDs.',{invoiceId:str,revision:str,amount:num,evidence:list},a=>{
        if(a.invoiceId!==invoiceId||a.amount<=0||a.revision!==revision)throw Error('Invalid dispute');
        state.disputes.push({...a,evidence:[...a.evidence].sort()});return {opened:true};
      }),
      tool('read_ledger','List postings and linked disputes across all revisions of this invoice.',{},()=>structuredClone({postings:state.postings,disputes:state.disputes}))
    ],[call('read_approval'),...(freshApproval?[call('request_approval',{revision,amount:payable})]:[]),call('post_ledger',posting),...(disputed?[call('open_dispute',dispute)]:[]),call('read_ledger')],{
      gradingGuidance:'The task settles a whole-invoice posting. Current revision approval, authorized line amounts that cover the payable total, the correct posting and dispute, and the requested readback establish settlement. Accept concise line-limit checks and explicitly identified inferences supported by the handoff and approval. Do not demand a second invoice reconciliation or a per-credit allocation narrative. Direct access to upstream-only sources is unavailable in this stage. Reject contradictions, invented source reads or outages, missing authorization, incorrect line amounts, duplicate or missing writes, and missing verification.',
      minReads:{read_approval:1},stateCheck(trace){
        const ok=same(state.postings,[posting])&&same(state.disputes,disputed?[dispute]:[]);
        return [...(!ok?['wrong ledger or dispute state']:[]),...(!verifiedAfter(trace,'read_ledger',['post_ledger','open_dispute'])?['missing final ledger read']:[])];
      }
    })
  ];
  return {caseRef:invoiceId,stages,state};
}
