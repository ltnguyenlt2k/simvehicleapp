import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState,
  useEdgesState, type Connection, type Edge } from '@xyflow/react';
import { BlockNode, type CanvasNode } from './BlockNode';
import '@xyflow/react/dist/style.css';
import './style.css';

const nodeTypes = { block: BlockNode };
const initialNodes: CanvasNode[] = Array.from({ length: 200 }, (_, index) => ({
  id: `block-${index}`, type: 'block', position: { x: index % 20 * 270, y: Math.floor(index / 20) * 190 },
  data: { title: `Bước ${index + 1}`, subtitle: 'Kiểm chứng canvas', category: index === 0 ? 'trigger' : 'flow',
    inputs: index === 0 ? [] : [{ id: 'in', label: 'Vào', role: 'flow' }],
    outputs: index > 0 && index % 5 === 0
      ? [{ id: 'succeeded', label: 'Thành công', role: 'result' }, { id: 'failed', label: 'Có lỗi', role: 'result' }]
      : [{ id: 'next', label: 'Tiếp theo', role: 'flow' }] },
}));
const initialEdges: Edge[] = initialNodes.slice(1).map((node, index) => ({
  id: `edge-${index}`, source: `block-${index}`, sourceHandle: initialNodes[index].data.outputs[0].id,
  target: node.id, targetHandle: 'in',
}));

function CanvasSpike() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const connect = useCallback((connection: Connection) => setEdges(current => addEdge(connection, current)), [setEdges]);
  return <main className="studio-shell">
    <header><div><span className="brand-dot" /> <strong>Robot Studio</strong>
      <span className="muted">Canvas qualification</span></div>
      <span className="mode-pill">200 blocks · simulation disconnected</span></header>
    <section className="canvas" aria-label="Workflow canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange} onConnect={connect} fitView minZoom={0.1} maxZoom={2}
        nodesFocusable edgesFocusable nodesDraggable deleteKeyCode={['Backspace', 'Delete']}
        isValidConnection={connection => connection.source !== connection.target &&
          !!nodes.find(node => node.id === connection.source)?.data.outputs.some(port => port.id === connection.sourceHandle) &&
          !!nodes.find(node => node.id === connection.target)?.data.inputs.some(port => port.id === connection.targetHandle)}>
        <Background gap={24} color="#dae1eb" /><Controls /><MiniMap pannable zoomable />
      </ReactFlow>
    </section>
    <footer>{nodes.length} blocks · {edges.length} connections · drag or use arrow keys</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><CanvasSpike /></StrictMode>);
