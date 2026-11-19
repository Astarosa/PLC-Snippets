import { describe, expect, it } from "vitest";
import { formatAppVersion } from "./app-version";

describe("version affichée", () => {
  it("affiche la version et le numéro de build", () => {
    expect(formatAppVersion("0.3.4", "12")).toBe("v0.3.4 (build 12)");
    expect(formatAppVersion("0.3.4", "dev")).toBe("v0.3.4 (dev)");
  });
});
