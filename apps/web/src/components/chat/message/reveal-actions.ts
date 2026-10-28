const TAP_SLOP_PX = 8;

/**
 * A touch tap with no text selection reveals the edit control.
 * A mouse hover handles itself, and a drag that selected text keeps copy working.
 */
export function shouldRevealMessageActions(input: {
  pointerType: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  selectedText: string;
}): boolean {
  if (input.pointerType === 'mouse') {
    return false;
  }

  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) {
    return false;
  }

  return input.selectedText.trim().length === 0;
}
