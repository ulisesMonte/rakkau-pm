import { describe, expect, it } from "vitest";
import {
  isDependencyTitle,
  isExternalResponsable,
  titleNomenclatureRowClasses,
} from "./itemTitle";

describe("isDependencyTitle", () => {
  it("detects trailing -D / -d", () => {
    expect(isDependencyTitle("Login SSO -D")).toBe(true);
    expect(isDependencyTitle("Login SSO -d")).toBe(true);
    expect(isDependencyTitle("foo-D")).toBe(true);
    expect(isDependencyTitle("  bar-d  ")).toBe(true);
  });

  it("ignores -D in the middle or absent", () => {
    expect(isDependencyTitle("Login -D SSO")).toBe(false);
    expect(isDependencyTitle("Login SSO")).toBe(false);
    expect(isDependencyTitle("")).toBe(false);
    expect(isDependencyTitle(null)).toBe(false);
  });
});

describe("isExternalResponsable", () => {
  it("is false for rakkau / empty", () => {
    expect(isExternalResponsable("rakkau")).toBe(false);
    expect(isExternalResponsable("Rakkau")).toBe(false);
    expect(isExternalResponsable("")).toBe(false);
    expect(isExternalResponsable(null)).toBe(false);
  });

  it("is true for cliente / fcliente / other", () => {
    expect(isExternalResponsable("cliente")).toBe(true);
    expect(isExternalResponsable("fcliente")).toBe(true);
    expect(isExternalResponsable("partner")).toBe(true);
  });
});

describe("titleNomenclatureRowClasses", () => {
  it("composes dep + external classes", () => {
    expect(titleNomenclatureRowClasses("A -D", "rakkau")).toBe(
      " rk-row-has-dep",
    );
    expect(titleNomenclatureRowClasses("A", "cliente")).toBe(
      " rk-row-resp-external",
    );
    expect(titleNomenclatureRowClasses("A -D", "cliente")).toBe(
      " rk-row-has-dep rk-row-resp-external",
    );
    expect(titleNomenclatureRowClasses("A", "rakkau")).toBe("");
  });
});
