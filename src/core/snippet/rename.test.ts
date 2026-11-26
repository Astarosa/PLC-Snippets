import { describe, expect, it } from "vitest";
import { countInText, isValidName, renameInText } from "./rename";

describe("renameInText", () => {
  it("renomme une locale, aussi devant un membre, sans toucher aux noms plus longs", () => {
    const src = "network\n  NO #Tempo.Q AND NO #Tempo2 -> #Sortie\n  TON #Tempo(IN := #Tempo.Q)";
    const r = renameInText(src, "local", "Tempo", "T_Arret");
    expect(r.count).toBe(3);
    expect(r.text).toContain("NO #T_Arret.Q AND NO #Tempo2");
    expect(r.text).toContain("TON #T_Arret(IN := #T_Arret.Q)");
  });

  it("met des guillemets si le nouveau nom n'est pas un identifiant simple", () => {
    expect(renameInText("NO #Marche", "local", "Marche", "Marche cycle").text).toBe('NO #"Marche cycle"');
    expect(renameInText('NO #"Marche cycle"', "local", "Marche cycle", "Marche").text).toBe("NO #Marche");
  });

  it("renomme une globale, aussi un DB avec membre, et pas une locale du même nom", () => {
    const src = 'NO "KM1" AND NO #KM1 -> "KM1"\nMOVE(IN := "KM1".x)';
    const r = renameInText(src, "global", "KM1", "KM_Pompe");
    expect(r.count).toBe(3);
    expect(r.text).toBe('NO "KM_Pompe" AND NO #KM1 -> "KM_Pompe"\nMOVE(IN := "KM_Pompe".x)');
  });

  it("ne touche pas aux commentaires", () => {
    const src = 'NO "KM1" // ancien "KM1"\n// "KM1" en commentaire';
    const r = renameInText(src, "global", "KM1", "KM2");
    expect(r.text).toBe('NO "KM2" // ancien "KM1"\n// "KM1" en commentaire');
    expect(countInText(src, "global", "KM1")).toBe(1);
  });

  it("valide le nouveau nom", () => {
    expect(isValidName("global", "Pompe 1")).toBe(true);
    expect(isValidName("global", 'a"b')).toBe(false);
    expect(isValidName("local", "  ")).toBe(false);
  });
});
