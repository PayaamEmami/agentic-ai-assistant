/** Rounding slack. Any real scroll up leaves the tail and stops follow. */
export const MESSAGE_LIST_PIN_THRESHOLD_PX = 8;

export function isPinnedToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= MESSAGE_LIST_PIN_THRESHOLD_PX;
}
