import { createContext, useContext } from 'react';
import { ArrowUpDown, ArrowLeftRight } from 'lucide-react';

export const ComparisonEditorPosition = createContext<{
  pane: 0 | 1;
  landscape: boolean;
  toggle: () => void;
} | null>(null);

/** One compact action in the existing editor heading; absent outside comparison. */
export function ComparisonEditorPositionButton({ kind }: { kind: '路线' | '标记' }) {
  const position = useContext(ComparisonEditorPosition);
  if (!position) return null;
  const target = position.landscape ? position.pane === 0 ? '右' : '左'
    : position.pane === 0 ? '下' : '上';
  return <button type="button" className="comparison-editor-position-button"
    aria-label={`${kind}编辑窗口移到${target}图`} title={`移到${target}图`}
    onClick={position.toggle}>
    {position.landscape ? <ArrowLeftRight size={16}/> : <ArrowUpDown size={16}/>}
  </button>;
}
