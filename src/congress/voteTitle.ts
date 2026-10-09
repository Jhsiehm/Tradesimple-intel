/**
 * A roll call's readable name. House Clerk XML often gives the bare words "Roll call" as the question,
 * and the vote index repeats the bill number there; skip both for the first real question, else name the roll.
 */
export function voteTitle(roll: number, bill: string, ...questions: (string | null | undefined)[]) {
  const asked = questions.map((q) => (q || "").trim()).find((q) => q && !/^roll call$/i.test(q) && q !== bill.trim());
  return asked || (bill ? `${bill} · Roll call #${roll}` : `Roll call #${roll}`);
}
