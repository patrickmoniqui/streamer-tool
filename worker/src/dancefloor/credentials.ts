interface SealedCredential { iv: number[]; data: number[] }
async function key(secret: string | undefined) {
  if (!secret || secret.length < 32) throw new Error('Dancefloor background connection encryption is not configured.');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealCredential(token: string, ownerId: string, secret?: string): Promise<SealedCredential> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(ownerId) }, await key(secret), new TextEncoder().encode(token));
  return { iv: [...iv], data: [...new Uint8Array(data)] };
}
export async function openCredential(sealed: SealedCredential, ownerId: string, secret?: string): Promise<string> {
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv), additionalData: new TextEncoder().encode(ownerId) }, await key(secret), new Uint8Array(sealed.data));
  return new TextDecoder().decode(data);
}
export type { SealedCredential };
