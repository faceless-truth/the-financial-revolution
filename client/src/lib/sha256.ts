/**
 * sha256 — compute a hex SHA-256 digest using the browser's built-in Web Crypto API.
 * No external dependencies. Works in all modern browsers and Node 18+.
 */
export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
