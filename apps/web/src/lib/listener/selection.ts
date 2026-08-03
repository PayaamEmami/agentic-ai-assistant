export function selectionInside(
  root: Node,
  selection: Pick<Selection, 'anchorNode' | 'focusNode' | 'toString'> | null,
): string {
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return '';
  }
  return selection.toString().trim().slice(0, 4000);
}
