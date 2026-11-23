// Hosted resource discovery is separate from the local booking tools.
export function discoveryRecord(item) {
  const field={list_mcp_resources:'resources',list_mcp_resource_templates:'resourceTemplates'}[item.name];
  if(item.type!=='mcp_call' || !field)return null;
  const record={tool:item.name,status:item.status,error:item.error??null};
  const content=item.output?.content?.find(part=>part.type==='text');
  if(content){
    try {
      const identifiers=JSON.parse(content.text)[field];
      if(Array.isArray(identifiers))record.returned=identifiers.length;
    } catch { /* Some discovery errors contain plain text instead of a listing. */ }
  }
  return record;
}

export async function bookingAccess(step) {
  const {default:OpenAI}=await import('openai');
  const sessions=new OpenAI({maxRetries:3}).beta.agents.sessions;
  const session=await sessions.retrieve(step.sessionId);
  const discovery=[];
  for await(const item of sessions.turns.items.list(step.turnId,{session_id:step.sessionId,order:'asc'})){
    const entry=discoveryRecord(item);
    if(entry)discovery.push(entry);
  }
  return {sessionId:step.sessionId,turnId:step.turnId,environment:session.environment.type,
    directTools:session.agent.tools.map(t=>t.name),discovery};
}
