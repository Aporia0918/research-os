import { describe, expect, it } from "vitest";
import { codeFromHash, pairLink } from "./pairLink";

describe("pairing QR link", () => {
  it("round-trips the code through the fragment", () => {
    const url = pairLink("https://192.168.1.5:8765/#/pair", "AB7KQ9XZ");
    expect(url).toBe("https://192.168.1.5:8765/#/pair?code=AB7KQ9XZ");
    expect(codeFromHash(new URL(url).hash)).toBe("AB7KQ9XZ");
  });

  it("is empty without a code and strips anything that is not a code character", () => {
    expect(codeFromHash("#/pair")).toBe("");
    expect(codeFromHash("#/pair?code=ab7k-q9xz<script>")).toBe("AB7KQ9XZSCRIPT");
  });
});
