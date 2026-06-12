/** Escape %, _ and \ in user input before building SQL LIKE patterns. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
