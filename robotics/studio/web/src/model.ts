export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Text = { vi?: string; en?: string };
export type Descriptor = { type: string; title?: Text; default?: Json; required?: boolean; minimum?: number; maximum?: number; values?: Json[]; labels?: Record<string, Text>; unit?: string };
export type Block = { id: string; version: number; category: 'trigger'|'robot'|'flow'|'log'; title: Text; semantics: Text;
  ports: { inputs: Record<string, { role: string; required: boolean; fanIn?: boolean }>; outputs: Record<string, { role: string; required: boolean }> }; props: Record<string, Descriptor> };
export type FlowNode = { id: string; block: string; v: number; props: Record<string, Json>; ui?: { x: number; y: number } };
export type FlowEdge = { from: [string,string]; to: [string,string] };
export type Variable = { type: 'bool'|'int32'|'float64'|'string'; initial: boolean|number|string; unit?: string };
export type Workflow = { schema: 'robotflow.v1'; rss: { version: string; catalogHash: string }; profile: string; vars: Record<string, Variable>; nodes: FlowNode[]; edges: FlowEdge[] };
export type Project = { id: string; name: string; revision: number; updatedAt: string; workflow: Workflow };
export type ProjectSummary = Omit<Project,'workflow'>;
export type Build = { id: string; projectId: string; projectRevision: number; artifactHash: string; runtimePackageHash: string; allowRemoteArm: boolean; identities: Record<string,string> };
export type Deployment = { id: string; projectId: string; buildId: string; artifactHash: string; mode: 'sim'|'live'; projectName: string; createdAt: string };
export type Diagnostic = { code: string; severity: string; nodeId?: string; field?: string; message: Text; data?: Record<string,unknown> };
export type CatalogNode = { kind: string; type: string; unit?: string; description?: string; enum?: string[] };
export type Catalog = { catalogHash: string; nodes: Record<string,CatalogNode> };
export type Trace = { event: string; nodeId: string|null; seq: number; monotonicNs: string; runId: string; data: Record<string,unknown> };
export type Snapshot = { unavailable?: boolean; status?: { mode: string; job: null | { id: string; deploymentId: string; phase: string; exitCode?: number; safeResult?: { confirmed?: boolean }; artifactHash?: string } }; live?: { online: boolean; samples: Record<string,{value: Json;quality:string}> }; logs?: { jobId: string|null; entries: {seq:number;text:string}[]; gap: boolean; latest: number } };
export const portLabels: Record<string,string> = { in:'Vào', next:'Tiếp theo', succeeded:'Thành công', failed:'Lỗi', rejected:'Từ chối', cancelled:'Đã hủy', timed_out:'Quá hạn', then:'Đúng', else:'Sai', body:'Thân vòng lặp', done:'Hoàn tất', branch1:'Nhánh 1', branch2:'Nhánh 2' };
export const categoryLabels = { trigger:'Kích hoạt', robot:'Robot', flow:'Logic', log:'Ghi nhận' };
export function title(text: Text|undefined, fallback='') { return text?.vi || text?.en || fallback; }
export function edgeId(edge: FlowEdge) { return edge.from.join(':')+'→'+edge.to.join(':'); }
export function uuid() { if (typeof crypto.randomUUID==='function') return crypto.randomUUID(); const bytes=crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20); }
export function newNode(block: Block, position: {x:number;y:number}, id='step_'+uuid().replaceAll('-','')): FlowNode {
  const props: Record<string,Json> = {};
  for (const [key,descriptor] of Object.entries(block.props)) if (descriptor.default !== undefined) props[key] = structuredClone(descriptor.default);
  return { id, block:block.id, v:block.version, props, ui:position };
}
export function canConnect(workflow: Workflow, blocks: Block[], source:string|null, sourcePort:string|null|undefined, target:string|null, targetPort:string|null|undefined) {
  if (!source || !target || source===target || !sourcePort || !targetPort) return false;
  const a=workflow.nodes.find(n=>n.id===source), b=workflow.nodes.find(n=>n.id===target);
  const output=blocks.find(block=>block.id===a?.block)?.ports.outputs[sourcePort];
  const input=blocks.find(block=>block.id===b?.block)?.ports.inputs[targetPort];
  if (!output || !input || workflow.edges.some(e=>e.from[0]===source && e.from[1]===sourcePort)) return false;
  return input.fanIn || !workflow.edges.some(e=>e.to[0]===target && e.to[1]===targetPort);
}
export function removeNodes(workflow: Workflow, ids: Set<string>): Workflow {
  return { ...workflow, nodes:workflow.nodes.filter(n=>!ids.has(n.id)), edges:workflow.edges.filter(e=>!ids.has(e.from[0])&&!ids.has(e.to[0])) };
}
export function layout(workflow: Workflow): Workflow {
  return { ...workflow, nodes:workflow.nodes.map((node,index)=>({...node,ui:{x:(index%5)*310+50,y:Math.floor(index/5)*290+50}})) };
}
export function nodeSubtitle(node: FlowNode, block: Block) {
  const props=node.props;
  if (props.name !== undefined) return title(block.props.name?.labels?.[String(props.name)],String(props.name));
  if (props.when !== undefined) return String(props.when);
  if (props.durationMs !== undefined) return String(props.durationMs)+' ms';
  if (node.block==='rf.loop') return props.forever ? 'Lặp đến khi dừng' : String(props.count)+' vòng';
  if (props.message !== undefined) return String(props.message);
  return node.id;
}
export async function request<T>(path:string,method='GET',data?:unknown):Promise<T> {
  const response=await fetch('/api'+path,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  if (!response.ok) { let message='Không hoàn tất yêu cầu ('+response.status+').'; try { const body=await response.json(); message=typeof body.detail==='string'?body.detail:body.error||message; } catch {} throw new Error(message); }
  return response.json();
}
