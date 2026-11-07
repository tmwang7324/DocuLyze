import { describe, expect, it } from "vitest";
import { hashPassword, hashSessionCookie } from "@/_lib/database";

describe("credential hashes", () => {
    it("salts password hashes independently and never embeds the password", async () => {
        const password = "correct horse battery staple";
        const [first, second] = await Promise.all([
            hashPassword(password),
            hashPassword(password),
        ]);

        expect(first).toMatch(/^scrypt\$32768\$8\$1\$/);
        expect(second).toMatch(/^scrypt\$32768\$8\$1\$/);
        expect(first).not.toBe(second);
        expect(first).not.toContain(password);
        expect(second).not.toContain(password);
    });

    it("hashes a session cookie deterministically without retaining it", () => {
        const cookie = "firebase-session-cookie";
        const first = hashSessionCookie(cookie);

        expect(first).toMatch(/^sha256\$/);
        expect(first).toBe(hashSessionCookie(cookie));
        expect(first).not.toContain(cookie);
        expect(first).not.toBe(hashSessionCookie(`${cookie}-other`));
    });
});
