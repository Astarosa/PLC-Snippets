import { describe, expect, it } from "vitest";
import { convertStl, detectMnemonic } from "./mnemonics";

const DE = `// Marche / arrêt
      U(    
      O     E 0.0
      O     A 4.0
      )     
      UN    E 0.1
      =     A 4.0
M001: L     EW 10
      T     MW 20
      SPB   M002
      ZV    Z 3
      SE    T 5
      SV    T 6
      AUF   DB 10
      U     "Capteur"
      UN    #Defaut
      U     %E1.2
      BEA   `;

const EN = `// Marche / arrêt
      A(    
      O     I 0.0
      O     Q 4.0
      )     
      AN    I 0.1
      =     Q 4.0
M001: L     IW 10
      T     MW 20
      JC    M002
      CU    C 3
      SD    T 5
      SE    T 6
      OPN   DB 10
      A     "Capteur"
      AN    #Defaut
      A     %I1.2
      BEU   `;

describe("convertStl", () => {
  it("convertit allemand → anglais en gardant la mise en page", () => {
    expect(convertStl(DE, "DE", "EN")).toBe(EN);
  });

  it("convertit anglais → allemand", () => {
    expect(convertStl(EN, "EN", "DE")).toBe(DE);
  });

  it("ne confond pas l'instruction ET anglaise « A » et la sortie allemande « A »", () => {
    expect(convertStl("A Q 4.0;", "EN", "DE")).toBe("U A 4.0;");
    expect(convertStl("U A 4.0;", "DE", "EN")).toBe("A Q 4.0;");
  });

  it("applique la table une seule fois (SE / SV des temporisations)", () => {
    expect(convertStl("SV T1\nSE T2", "DE", "EN")).toBe("SE T1\nSD T2");
    expect(convertStl("SE T1\nSD T2", "EN", "DE")).toBe("SV T1\nSE T2");
  });

  it("convertit les paramètres d'un CALL et garde points-virgules et commentaires", () => {
    const de =
      'CALL "FB_Moteur", "DB_Moteur"\n  Marche := E 0.0\n  Sortie := A 4.1 // KM1\nU     E 0.3;  // capteur';
    const en =
      'CALL "FB_Moteur", "DB_Moteur"\n  Marche := I 0.0\n  Sortie := Q 4.1 // KM1\nA     I 0.3;  // capteur';
    expect(convertStl(de, "DE", "EN")).toBe(en);
    expect(convertStl(en, "EN", "DE")).toBe(de);
  });

  it("laisse intacts mnémoniques, locales, mémentos et DB", () => {
    const src = 'L "Consigne"\nT #Valeur\nU M 10.0\nL DB1.DBW2\nL 16#FF';
    expect(convertStl(src, "DE", "EN")).toBe(src.replace("U M", "A M"));
  });
});

describe("detectMnemonic", () => {
  it("reconnaît chaque langue", () => {
    expect(detectMnemonic(DE)).toBe("DE");
    expect(detectMnemonic(EN)).toBe("EN");
    expect(detectMnemonic('L "X"\nT "Y"')).toBeNull();
  });
});
