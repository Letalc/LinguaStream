import { expect, test, vi } from "vitest";
import { compatibleRandomUUID, installRandomUUID } from "./crypto-compat";

function deterministicCrypto(): Pick<Crypto, "getRandomValues"> {
  return {
    getRandomValues: vi.fn((array) => {
      const bytes = array as Uint8Array;
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
      return array;
    }),
  };
}

test("creates a UUID v4 using getRandomValues when randomUUID is unavailable", () => {
  expect(compatibleRandomUUID(deterministicCrypto())).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("installs the compatibility method without replacing a native implementation", () => {
  const legacyCrypto = deterministicCrypto() as Pick<Crypto, "getRandomValues"> &
    Partial<Pick<Crypto, "randomUUID">>;
  installRandomUUID(legacyCrypto);
  expect(legacyCrypto.randomUUID?.()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  let nativeCalls = 0;
  const native: Crypto["randomUUID"] = () => {
    nativeCalls += 1;
    return "11111111-1111-4111-8111-111111111111";
  };
  const modernCrypto = { ...deterministicCrypto(), randomUUID: native };
  installRandomUUID(modernCrypto);
  expect(modernCrypto.randomUUID()).toBe("11111111-1111-4111-8111-111111111111");
  expect(nativeCalls).toBe(1);
});
