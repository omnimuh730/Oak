import type { DomNode } from '../types';
import './DomTreeView.css';

interface Props {
  tree: DomNode;
}

export function DomTreeView({ tree }: Props) {
  return (
    <div className="tree-container">
      <div className="tree-canvas">
        <TreeNode node={tree} depth={0} isLast />
      </div>
    </div>
  );
}

interface TreeNodeProps {
  node: DomNode;
  depth: number;
  isLast: boolean;
  prefix?: string;
}

function TreeNode({ node, depth, isLast, prefix = '' }: TreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const branch = prefix + (isLast ? '└── ' : '├── ');
  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  const label = formatLabel(node);

  return (
    <div className={`tree-branch depth-${Math.min(depth, 8)}`}>
      <div className="tree-line">
        {depth > 0 && <span className="tree-glyph">{branch}</span>}
        <div className="node-card" title={label}>
          <span className="tag">{node.tag}</span>
          {node.id && <span className="node-id">#{node.id}</span>}
          {node.classes && node.classes.length > 0 && (
            <span className="node-class">.{node.classes.join('.')}</span>
          )}
          {node.text && <span className="node-text">"{node.text}"</span>}
          {hasChildren && (
            <span className="child-badge">{node.childCount}</span>
          )}
        </div>
      </div>

      {hasChildren &&
        node.children.map((child, i) => (
          <TreeNode
            key={`${child.tag}-${depth}-${i}`}
            node={child}
            depth={depth + 1}
            isLast={i === node.children.length - 1}
            prefix={childPrefix}
          />
        ))}
    </div>
  );
}

function formatLabel(node: DomNode): string {
  let label = `<${node.tag}`;
  if (node.id) label += ` id="${node.id}"`;
  if (node.classes?.length) label += ` class="${node.classes.join(' ')}"`;
  label += '>';
  if (node.text) label += ` ${node.text}`;
  return label;
}
