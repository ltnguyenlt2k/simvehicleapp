import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export type Port = { id: string; label: string; role: 'flow' | 'result' };
export type BlockData = {
  title: string;
  subtitle: string;
  inputs: Port[];
  outputs: Port[];
  category: 'trigger' | 'robot' | 'flow' | 'log';
  phase?: string;
  invalid?: boolean;
};
export type CanvasNode = Node<BlockData, 'block'>;

export const BlockNode = memo(function BlockNode({ data, selected }: NodeProps<CanvasNode>) {
  return <article className={`workflow-node ${data.category} ${selected ? 'selected' : ''} ${data.phase ? 'phase-'+data.phase.toLowerCase() : ''} ${data.invalid ? 'invalid' : ''}`}>
    {data.inputs.map((port, index) => <Handle key={port.id} id={port.id} type="target"
      position={Position.Left} style={{ top: 30 + index * 22 }}
      aria-label={`Input ${port.label}`} />)}
    <span className="node-category">{{trigger:"Kích hoạt",robot:"Robot",flow:"Logic",log:"Ghi nhận"}[data.category]}</span>
    <strong>{data.title}</strong>
    <span className="node-description">{data.subtitle}</span>
    <div className="node-ports">{data.outputs.map((port, index) => <div key={port.id}>
      <span>{port.label}</span>
      <Handle id={port.id} type="source" position={Position.Right}
        style={{ top: 90 + index * 22 }} aria-label={`Output ${port.label}`}
        className={port.role === 'result' ? 'result-port' : ''} />
    </div>)}</div>
  </article>;
});
