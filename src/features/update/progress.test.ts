import { describe, expect, it } from "vitest";
import { formatBytes, progressPercent } from "./progress";

describe("progression du téléchargement", () => {
  it("calcule le pourcentage, borné à 100", () => {
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(300, 200)).toBe(100);
    expect(progressPercent(10, null)).toBeNull();
  });
  it("affiche les tailles en français", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1536)).toBe("1,5 Ko");
    expect(formatBytes(12.3 * 1024 * 1024)).toBe("12,3 Mo");
  });
});
