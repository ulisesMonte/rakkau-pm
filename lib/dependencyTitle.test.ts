import { describe, expect, it } from "vitest";
import {
  applyDependencyFromTitle,
  isDependencyRole,
  titleMarksDependency,
} from "@/lib/dependencyTitle";

describe("titleMarksDependency", () => {
  it("detects -D / -d suffix after trim and optional whitespace", () => {
    expect(titleMarksDependency("crear bc box kubernets -D")).toBe(true);
    expect(titleMarksDependency("crear bc box kubernets -d")).toBe(true);
    expect(titleMarksDependency("foo-D")).toBe(true);
    expect(titleMarksDependency("foo-d")).toBe(true);
    expect(titleMarksDependency("  bar -D  ")).toBe(true);
    expect(titleMarksDependency("  bar -d  ")).toBe(true);
    expect(titleMarksDependency("-D")).toBe(true);
    expect(titleMarksDependency("-d")).toBe(true);
  });

  it("rejects non-suffix endings", () => {
    expect(titleMarksDependency("foo -D bar")).toBe(false);
    expect(titleMarksDependency("foo -d bar")).toBe(false);
    expect(titleMarksDependency("Dependencia")).toBe(false);
    expect(titleMarksDependency("")).toBe(false);
    expect(titleMarksDependency(null)).toBe(false);
  });
});

describe("applyDependencyFromTitle", () => {
  it("sets isDependency and HasDependency", () => {
    expect(applyDependencyFromTitle({ title: "API gateway -D" })).toEqual({
      title: "API gateway -D",
      isDependency: true,
      HasDependency: "Sí",
    });
    expect(
      applyDependencyFromTitle({ title: "normal", HasDependency: "No" }),
    ).toEqual({ title: "normal", HasDependency: "No" });
  });
});

describe("isDependencyRole", () => {
  it("matches title -D/-d or flag; ignores bare HasDependency", () => {
    expect(isDependencyRole({ title: "x -D" })).toBe(true);
    expect(isDependencyRole({ title: "x -d" })).toBe(true);
    expect(isDependencyRole({ isDependency: true })).toBe(true);
    expect(isDependencyRole({ title: "x" })).toBe(false);
  });
});
