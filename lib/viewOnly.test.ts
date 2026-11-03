import { afterEach, describe, expect, it } from "vitest";
import {
  isViewOnly,
  VIEWER_READONLY_MESSAGE,
  viewerReadonlyPayload,
} from "./viewOnly";

describe("viewOnly", () => {
  const prev = process.env.NEXT_PUBLIC_VIEW_ONLY;

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_VIEW_ONLY;
    else process.env.NEXT_PUBLIC_VIEW_ONLY = prev;
  });

  it("is false when unset", () => {
    delete process.env.NEXT_PUBLIC_VIEW_ONLY;
    expect(isViewOnly()).toBe(false);
  });

  it("is true only for literal true", () => {
    process.env.NEXT_PUBLIC_VIEW_ONLY = "true";
    expect(isViewOnly()).toBe(true);
    process.env.NEXT_PUBLIC_VIEW_ONLY = "1";
    expect(isViewOnly()).toBe(false);
    process.env.NEXT_PUBLIC_VIEW_ONLY = "false";
    expect(isViewOnly()).toBe(false);
  });

  it("exposes a stable viewer message payload", () => {
    expect(VIEWER_READONLY_MESSAGE).toMatch(/visor/i);
    expect(viewerReadonlyPayload()).toEqual({
      error: VIEWER_READONLY_MESSAGE,
      viewOnly: true,
    });
  });
});
