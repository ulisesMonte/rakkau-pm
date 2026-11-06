import { describe, expect, it } from "vitest";
import {
  isResponsableValue,
  normalizeResponsableValue,
} from "@/lib/responsable";

describe("normalizeResponsableValue", () => {
  it("maps rakkau and cliente", () => {
    expect(normalizeResponsableValue("rakkau")).toBe("rakkau");
    expect(normalizeResponsableValue("RAKKAU")).toBe("rakkau");
    expect(normalizeResponsableValue("cliente")).toBe("cliente");
    expect(normalizeResponsableValue(" Cliente ")).toBe("cliente");
  });

  it("maps fcliente → cliente", () => {
    expect(normalizeResponsableValue("fcliente")).toBe("cliente");
    expect(normalizeResponsableValue("FCliente")).toBe("cliente");
  });

  it("returns empty for unknown / blank", () => {
    expect(normalizeResponsableValue("")).toBe("");
    expect(normalizeResponsableValue(undefined)).toBe("");
    expect(normalizeResponsableValue("otros")).toBe("");
  });
});

describe("isResponsableValue", () => {
  it("accepts only canonical values", () => {
    expect(isResponsableValue("rakkau")).toBe(true);
    expect(isResponsableValue("cliente")).toBe(true);
    expect(isResponsableValue("fcliente")).toBe(true);
    expect(isResponsableValue("")).toBe(false);
  });
});
