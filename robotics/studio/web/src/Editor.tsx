import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, MarkerType,
  useReactFlow, useNodesInitialized, useNodesState, useEdgesState, type Connection, type Edge, type NodeChange, type EdgeChange } from '@xyflow/react';
import { BlockNode, type CanvasNode } from './BlockNode';
import { type Workflow, type Block, type Catalog, type Diagnostic, type Json, type Variable,
  title, portLabels, categoryLabels, edgeId, newNode, canConnect, removeNodes, layout, nodeSubtitle } from './model';

const nodeTypes={block:BlockNode};
const NO_PHASES:Record<string,string>={};
type Props={workflow:Workflow;blocks:Block[];catalog:Catalog;diagnostics:Diagnostic[];onChange:(value:Workflow)=>void;disabled?:boolean;readOnly?:boolean;phases?:Record<string,string>;checking?:boolean;hasChecked?:boolean};
function JsonProperty({value,onChange,disabled}:{value:Json;onChange:(value:Json)=>void;disabled:boolean}) {
  const [draft,setDraft]=useState(typeof value==='string'?value:JSON.stringify(value,null,2));const focused=useRef(false);
  useEffect(()=>{if(!focused.current)setDraft(typeof value==='string'?value:JSON.stringify(value,null,2));},[value]);
  return <textarea className="json-property" disabled={disabled} value={draft} onFocus={()=>{focused.current=true;}} onBlur={()=>{focused.current=false;setDraft(typeof value==='string'?value:JSON.stringify(value,null,2));}} onChange={event=>{
    const raw=event.target.value;setDraft(raw);try{onChange(JSON.parse(raw));}catch{onChange(raw);}
  }}/>;
}
function Variables({workflow,onChange,disabled}:{workflow:Workflow;onChange:(value:Workflow)=>void;disabled:boolean}) {
  const [name,setName]=useState('');const [kind,setKind]=useState<Variable['type']>('float64');
  const [initial,setInitial]=useState('0');const [unit,setUnit]=useState('1');const [error,setError]=useState('');
  function add() {
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||name in workflow.vars){setError('Tên biến cần duy nhất và bắt đầu bằng chữ.');return;}
    let value:Variable['initial']=initial;
    if(kind==='bool')value=initial==='true';else if(kind!=='string') {value=Number(initial);if(!Number.isFinite(value)||(kind==='int32'&&!Number.isInteger(value))){setError('Giá trị ban đầu chưa đúng kiểu.');return;}}
    const declaration:Variable={type:kind,initial:value};if(kind==='float64'||kind==='int32')declaration.unit=unit||'1';
    onChange({...workflow,vars:{...workflow.vars,[name]:declaration}});setName('');setError('');
  }
  return <details className="variables"><summary>Biến workflow <span>{Object.keys(workflow.vars).length}</span></summary>
    {Object.entries(workflow.vars).map(([key,value])=><div className="variable-row" key={key}><div><strong>{key}</strong><small>{value.type} · {String(value.initial)} {value.unit==='1'?'':value.unit}</small></div><button disabled={disabled} aria-label={'Xóa biến '+key} onClick={()=>{const vars={...workflow.vars};delete vars[key];onChange({...workflow,vars});}}>×</button></div>)}
    <fieldset disabled={disabled} className="variable-form"><label>Tên biến<input value={name} onChange={e=>setName(e.target.value)} placeholder="distance"/></label>
      <label>Kiểu<select value={kind} onChange={e=>{setKind(e.target.value as Variable['type']);setInitial(e.target.value==='bool'?'false':e.target.value==='string'?'':'0');}}>{['float64','int32','bool','string'].map(type=><option key={type}>{type}</option>)}</select></label>
      <label>Giá trị ban đầu{kind==='bool'?<select value={initial} onChange={e=>setInitial(e.target.value)}><option>false</option><option>true</option></select>:<input value={initial} onChange={e=>setInitial(e.target.value)}/>}</label>
      {(kind==='float64'||kind==='int32')&&<label>Đơn vị<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="m, %, 1"/></label>}
      <button onClick={add}>Thêm biến</button>{error&&<small className="error-text">{error}</small>}
    </fieldset></details>;
}
function InnerEditor({workflow,blocks,catalog,diagnostics,onChange,disabled=false,readOnly=false,phases=NO_PHASES,checking=false,hasChecked=false}:Props) {
  const [selected,setSelected]=useState<string|null>(null);const [search,setSearch]=useState('');const [leftTab,setLeftTab]=useState<'blocks'|'rss'>('blocks');
  const [nodes,setNodes,onNodesChange]=useNodesState<CanvasNode>([]);const [edges,setEdges,onEdgesChange]=useEdgesState<Edge>([]);
  const canvas=useRef<HTMLDivElement>(null);const flow=useReactFlow<CanvasNode>();const [activeProperty,setActiveProperty]=useState<string|null>(null);
  const measured=useNodesInitialized();const initialFit=useRef(false);
  useEffect(()=>{if(measured&&!initialFit.current){initialFit.current=true;void flow.fitView({padding:.12});}},[measured,flow]);
  const source=workflow.nodes.find(node=>node.id===selected);const definition=blocks.find(block=>block.id===source?.block);
  useEffect(()=>{
    setNodes(current=>workflow.nodes.map((node,index)=>{
      const block=blocks.find(item=>item.id===node.block);const old=current.find(item=>item.id===node.id);
      return {id:node.id,type:'block' as const,position:node.ui||old?.position||{x:index%5*310,y:Math.floor(index/5)*290},selected:node.id===selected,
        data:{title:title(block?.title,node.block),subtitle:block?nodeSubtitle(node,block):node.id,category:block?.category||'flow',
          inputs:Object.keys(block?.ports.inputs||{}).map(id=>({id,label:portLabels[id]||id,role:'flow' as const})),
          outputs:Object.entries(block?.ports.outputs||{}).map(([id,port])=>({id,label:portLabels[id]||id,role:port.role==='result'?'result' as const:'flow' as const})),
          phase:phases[node.id],invalid:diagnostics.some(item=>item.nodeId===node.id&&item.severity==='error')}};
    }));
    setEdges(workflow.edges.map(edge=>({id:edgeId(edge),source:edge.from[0],sourceHandle:edge.from[1],target:edge.to[0],targetHandle:edge.to[1],markerEnd:{type:MarkerType.ArrowClosed,width:15,height:15},style:{stroke:'#90a3bb',strokeWidth:1.4}})));
  },[workflow,blocks,selected,phases,diagnostics,setNodes,setEdges]);
  const changedNodes=useCallback((changes:NodeChange<CanvasNode>[])=>{
    onNodesChange(changes);
    const chosen=changes.find(change=>change.type==='select'&&change.selected);if(chosen&&chosen.type==='select')setSelected(chosen.id);
    if(!readOnly&&!disabled){const ids=new Set(changes.filter(change=>change.type==='remove').map(change=>change.id));if(ids.size)onChange(removeNodes(workflow,ids));}
  },[onNodesChange,workflow,onChange,readOnly,disabled]);
  const changedEdges=useCallback((changes:EdgeChange[])=>{onEdgesChange(changes);if(readOnly||disabled)return;const removed=new Set(changes.filter(change=>change.type==='remove').map(change=>change.id));if(removed.size)onChange({...workflow,edges:workflow.edges.filter(edge=>!removed.has(edgeId(edge)))});},[onEdgesChange,workflow,onChange,readOnly,disabled]);
  function add(block:Block,position?:{x:number;y:number}) {if(disabled||readOnly)return;const rect=canvas.current!.getBoundingClientRect();const node=newNode(block,position||flow.screenToFlowPosition({x:rect.x+rect.width/2,y:rect.y+rect.height/2}));onChange({...workflow,nodes:[...workflow.nodes,node]});setSelected(node.id);}
  function connect(connection:Connection) {if(disabled||readOnly||!canConnect(workflow,blocks,connection.source,connection.sourceHandle,connection.target,connection.targetHandle))return;onChange({...workflow,edges:[...workflow.edges,{from:[connection.source,connection.sourceHandle!],to:[connection.target,connection.targetHandle!]}]});}
  function property(key:string,value:Json) {if(!source||readOnly||disabled)return;onChange({...workflow,nodes:workflow.nodes.map(node=>node.id===source.id?{...node,props:{...node.props,[key]:value}}:node)});}
  const filteredBlocks=useMemo(()=>blocks.filter(block=>(title(block.title)+' '+block.id).toLowerCase().includes(search.toLowerCase())),[blocks,search]);
  const signals=useMemo(()=>Object.entries(catalog.nodes).filter(([path,node])=>['sensor','attribute'].includes(node.kind)&&path.toLowerCase().includes(search.toLowerCase())),[catalog,search]);
  return <div className={'editor-grid '+(readOnly?'readonly-editor':'')}>
    <aside className="palette"><div className="palette-tabs"><button className={leftTab==='blocks'?'active':''} onClick={()=>setLeftTab('blocks')}>Các bước</button><button className={leftTab==='rss'?'active':''} onClick={()=>setLeftTab('rss')}>Tín hiệu RSS</button></div>
      <input className="palette-search" aria-label="Tìm bước hoặc tín hiệu" placeholder={leftTab==='blocks'?'Tìm bước…':'Tìm tín hiệu…'} value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="palette-list">{leftTab==='blocks'?Object.entries(categoryLabels).map(([category,label])=><section key={category}><h3>{label}</h3>{filteredBlocks.filter(block=>block.category===category).map(block=><button key={block.id} className={'palette-block '+block.category} data-block-id={block.id} disabled={disabled||readOnly} draggable={!disabled&&!readOnly} onDragStart={e=>{e.dataTransfer.setData('application/robot-block',block.id);e.dataTransfer.effectAllowed='move';}} onClick={()=>add(block)}><span>{title(block.title)}</span><small>{block.ports.outputs.succeeded?'5 nhánh kết quả':block.category==='trigger'?'Điểm bắt đầu':'Logic workflow'}</small></button>)}</section>):signals.map(([path,node])=><button className="rss-item" key={path} onClick={()=>{if(activeProperty&&source)property(activeProperty,source.props[activeProperty]?String(source.props[activeProperty])+' '+path:path);else navigator.clipboard?.writeText(path);}}><strong>{path.split('.').slice(-2).join('.')}</strong><small>{path}</small><span>{node.type} {node.unit&&'· '+node.unit}</span></button>)}</div>
      {!readOnly&&<Variables workflow={workflow} onChange={onChange} disabled={disabled}/>}
    </aside>
    <section className="canvas-area"><div className="canvas-tools"><span><strong>{workflow.nodes.length}</strong> bước · {workflow.edges.length} kết nối</span><div>{!readOnly&&<button disabled={disabled} onClick={()=>{onChange(layout(workflow));setTimeout(()=>flow.fitView({padding:.12}),50);}}>Sắp xếp</button>}<button onClick={()=>flow.fitView({padding:.12})}>Vừa khung</button></div></div>
      <div ref={canvas} className="workflow-canvas" data-testid="workflow-canvas" onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move';}} onDrop={event=>{event.preventDefault();const block=blocks.find(item=>item.id===event.dataTransfer.getData('application/robot-block'));if(block)add(block,flow.screenToFlowPosition({x:event.clientX,y:event.clientY}));}}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changedNodes} onEdgesChange={changedEdges} onConnect={connect}
          onNodeClick={(_,node)=>setSelected(node.id)} onPaneClick={()=>setSelected(null)}
          onNodeDragStop={(_,node)=>{if(!disabled&&!readOnly)onChange({...workflow,nodes:workflow.nodes.map(item=>item.id===node.id?{...item,ui:node.position}:item)});}}
          isValidConnection={c=>canConnect(workflow,blocks,c.source,c.sourceHandle,c.target,c.targetHandle)}
          nodesDraggable={!disabled&&!readOnly} nodesConnectable={!disabled&&!readOnly} nodesFocusable edgesFocusable
          deleteKeyCode={readOnly||disabled?null:['Backspace','Delete']} minZoom={.1} maxZoom={2} fitView fitViewOptions={{padding:.12}}>
          <Background gap={24} color="#dbe3ee"/><Controls/><MiniMap pannable zoomable nodeColor={node=>node.data.category==='robot'?'#81a8ec':node.data.category==='trigger'?'#baa4e3':'#b4c9d9'}/>
        </ReactFlow>
      </div>
      <div className="diagnostics" aria-label="Kết quả kiểm tra">{checking?<div className="diagnostic-pending">Đang kiểm tra workflow…</div>:!hasChecked?<div className="diagnostic-pending">Chưa có kết quả kiểm tra.</div>:diagnostics.length?diagnostics.map((item,index)=><button key={index} className={item.severity==='error'?'diagnostic-error':'diagnostic-warning'} onClick={()=>{if(item.nodeId){setSelected(item.nodeId);flow.fitView({nodes:[{id:item.nodeId}],padding:.7,maxZoom:1.2});}}}><strong>{item.severity==='error'?'Lỗi':'Lưu ý'}</strong><span>{title(item.message,item.code)} {typeof item.data?.detail==='string'&&item.data.detail}</span><small>{item.nodeId} · {item.code}</small></button>):<div className="diagnostic-ok">✓ Không có lỗi được ghi nhận</div>}</div>
    </section>
    <aside className="inspector" data-testid="node-inspector">{source&&definition?<><div className="inspector-title"><small>{categoryLabels[definition.category]}</small><h2>{title(definition.title)}</h2><code data-testid="selected-node-id">{source.id}</code></div><p className="semantics">{title(definition.semantics)}</p>
      <button className="focus-node" onClick={()=>flow.fitView({nodes:[{id:source.id}],padding:.8,maxZoom:1.2})}>Phóng tới bước</button>
      <fieldset disabled={disabled||readOnly} className="property-form">{Object.entries(definition.props).map(([key,descriptor])=>{
        const value=key in source.props?source.props[key]:descriptor.default??'';const label=title(descriptor.title,key);const invalid=diagnostics.some(item=>item.nodeId===source.id&&item.field===key);
        return <label key={source.id+key} className={invalid?'invalid-field':''}>{label}
          {descriptor.type==='boolean'?<select value={String(value)} onChange={e=>property(key,e.target.value==='true')}><option value="false">Không</option><option value="true">Có</option></select>:
           descriptor.type==='enum'?<select value={String(value)} onChange={e=>property(key,e.target.value)}>{descriptor.values?.map(option=><option key={String(option)} value={String(option)}>{title(descriptor.labels?.[String(option)],String(option))}</option>)}</select>:
           descriptor.type==='rss-path'?<select value={String(value)} onChange={e=>property(key,e.target.value)}>{Object.entries(catalog.nodes).filter(([,node])=>['sensor','attribute'].includes(node.kind)).map(([path])=><option key={path}>{path}</option>)}</select>:
           descriptor.type==='waypoints'?<JsonProperty value={value} disabled={disabled||readOnly} onChange={v=>property(key,v)}/>:
           <input type={['integer','duration'].includes(descriptor.type)?'number':'text'} value={String(value)} min={descriptor.minimum} max={descriptor.maximum} aria-invalid={invalid} onFocus={()=>setActiveProperty(descriptor.type==='expression'?key:null)} onChange={e=>{const raw=e.target.value;property(key,['integer','duration'].includes(descriptor.type)&&raw!==''?Number(raw):raw);}}/>}
          {descriptor.type==='expression'&&<small>Chọn tín hiệu ở bảng RSS để chèn vào điều kiện.</small>}
        </label>;
      })}</fieldset>
      <section className="connections"><h3>Các nhánh</h3>{Object.keys(definition.ports.outputs).map(port=>{const edge=workflow.edges.find(item=>item.from[0]===source.id&&item.from[1]===port);const destination=workflow.nodes.find(item=>item.id===edge?.to[0]);const targetBlock=blocks.find(item=>item.id===destination?.block);return <div className="connection-row" key={port}><div><strong>{portLabels[port]||port}</strong><small>{edge?title(targetBlock?.title,edge.to[0]):'Chưa nối'}</small>{!readOnly&&<select aria-label={'Đích nhánh '+(portLabels[port]||port)} disabled={disabled} value={edge?JSON.stringify(edge.to):''} onChange={event=>{const edges=workflow.edges.filter(item=>!(item.from[0]===source.id&&item.from[1]===port));if(event.target.value){const to=JSON.parse(event.target.value) as [string,string];if(canConnect({...workflow,edges},blocks,source.id,port,to[0],to[1]))edges.push({from:[source.id,port],to});}onChange({...workflow,edges});}}><option value="">Chưa nối</option>{workflow.nodes.flatMap(node=>Object.keys(blocks.find(block=>block.id===node.block)?.ports.inputs||{}).filter(input=>canConnect({...workflow,edges:workflow.edges.filter(item=>item!==edge)},blocks,source.id,port,node.id,input)).map(input=><option key={node.id+input} value={JSON.stringify([node.id,input])}>{node.id} · {input}</option>))}</select>}</div>{edge&&!readOnly&&<button disabled={disabled} aria-label={'Bỏ nối '+(portLabels[port]||port)} onClick={()=>onChange({...workflow,edges:workflow.edges.filter(item=>item!==edge)})}>×</button>}</div>;})}</section>
      {!readOnly&&<button className="delete-node" disabled={disabled} onClick={()=>{onChange(removeNodes(workflow,new Set([source.id])));setSelected(null);}}>Xóa bước này</button>}
    </>:<div className="inspector-empty"><div>◇</div><h2>Thiết kế kịch bản</h2><p>Chọn một bước để chỉnh thuộc tính. Kéo từ cổng ra sang cổng vào để nối các bước.</p><p>Mọi nhánh của lệnh robot cần được xử lý rõ ràng.</p></div>}</aside>
  </div>;
}
export function Editor(props:Props){return <ReactFlowProvider><InnerEditor {...props}/></ReactFlowProvider>;}
