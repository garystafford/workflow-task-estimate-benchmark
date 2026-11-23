import { isDeepStrictEqual } from 'node:util';
import Ajv from 'ajv';
import { obj, str, num, list } from '../specialists/contracts.mjs';
export { obj, str, num, list };
export const bool = {type: 'boolean'};
export const arrayOf = items => ({type:'array', items});
const ajv = new Ajv({strict:false});
export const same = (a,b) => isDeepStrictEqual(a,b);
export function reader(name, description, value) {
  return tool(name, description, {}, () => structuredClone(value));
}
export function tool(name, description, fields, handle) {
  const parameters = obj(fields);
  return {definition:{type:'function', name, description, parameters, strict:true}, handle, validate:ajv.compile(parameters)};
}
export function makeStage(id, request, fields, expected, tools, controls, options={}) {
  return {id, request, schema:obj({...fields, explanation:str}), expected, tools, controls, ...options};
}
export function callInterface(stage, trace) {
  const byName=new Map(stage.tools.map(t=>[t.definition.name,t]));
  return (name,args={}) => {
    const parsed=typeof args==='string'?JSON.parse(args):args;
    const t=byName.get(name);
    if (!t || !t.validate(parsed)) throw Error('Invalid tool or arguments: '+name);
    const entry={name,args:structuredClone(parsed)};
    trace.push(entry);
    try {
      const result=t.handle(parsed);
      entry.result=structuredClone(result);
      return result;
    } catch(e) {entry.error=e.message;throw e;}
  };
}
// Compare domain identifiers and amounts exactly. Output array ordering has no business significance.
function normalized(x) {
  if(Array.isArray(x)) return x.map(normalized).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(x && typeof x==='object') return Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalized(x[k])]));
  return x;
}
export function inspect(stage, answer, trace) {
  const issues=[];
  if(!ajv.validate(stage.schema,answer)) issues.push('invalid output schema');
  for(const [key,value] of Object.entries(stage.expected)) {
    const matches=stage.fieldChecks?.[key];
    const ok=matches?matches(answer?.[key]):same(normalized(answer?.[key]),normalized(value));
    if(!ok) issues.push('incorrect '+key);
  }
  if(!answer?.explanation?.trim()) issues.push('missing explanation');
  // Require source access and post-write verification. Independent reads can occur in any order.
  for(const [name,n] of Object.entries(stage.minReads??{})) {
    if(trace.filter(e=>e.name===name&&!e.error).length<n) issues.push('missing evidence: '+name);
  }
  if(stage.stateCheck) issues.push(...stage.stateCheck(trace,answer));
  return issues;
}
export const call = (name,args={}) => ({name,args});
export function verifiedAfter(trace, read, writes) {
  const lastWrite=trace.findLastIndex(e=>writes.includes(e.name));
  return lastWrite>=0 && trace.slice(lastWrite+1).some(e=>e.name===read && !e.error);
}
// A referenced record counts as evidence only after the index that identifies it was read.
export function linkedReadCheck(indexName, recordName, field, expectedRef) {
  return trace=>{
    const index = trace.findIndex(e=>e.name===indexName && !e.error);
    const found = index>=0 && trace.slice(index+1).some(e=>
      e.name===recordName && !e.error && e.args[field]===expectedRef);
    return found?[]:['missing linked evidence: '+expectedRef];
  };
}
export function timeoutChecked(trace,write,read) {
  const i=trace.findIndex(e=>e.name===write && e.error);
  if(i<0) return false;
  const rest=trace.slice(i+1);
  const check=rest.findIndex(e=>e.name===read && !e.error);
  const repeat=rest.findIndex(e=>e.name===write);
  return check>=0 && (repeat<0 || check<repeat);
}
