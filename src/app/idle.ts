// Monotonic time is authoritative during ordinary use. Wall time can only
// shorten a session after a clock rollback or a suspend that stops the clock.
export function idleExpired(lastMono: number, lastWall: number, nowMono: number, nowWall: number, timeout: number): boolean {
  const wallGap = nowWall - lastWall;
  return nowMono - lastMono >= timeout || wallGap >= timeout || wallGap < -1000;
}
