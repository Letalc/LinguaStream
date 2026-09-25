type CryptoWithOptionalUuid = Pick<Crypto, "getRandomValues"> &
  Partial<Pick<Crypto, "randomUUID">>;

/** UUID v4 for browser identities that do not protect secrets or grant access. */
export function compatibleRandomUUID(cryptoApi: Pick<Crypto, "getRandomValues"> = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}` as ReturnType<Crypto["randomUUID"]>;
}

/**
 * `crypto.randomUUID` is restricted to secure contexts in some mobile browsers.
 * Convex Presence uses it for a non-secret instance id, so install a getRandomValues
 * based implementation before its React hook renders on a LAN HTTP origin.
 */
export function installRandomUUID(cryptoApi: CryptoWithOptionalUuid) {
  if (typeof cryptoApi.randomUUID === "function") return;
  Object.defineProperty(cryptoApi, "randomUUID", {
    configurable: true,
    value: () => compatibleRandomUUID(cryptoApi),
  });
}

if (typeof globalThis.crypto !== "undefined") installRandomUUID(globalThis.crypto);
