import { describe, expect, it } from "vitest";
import { projectChronicleDateLabel } from "./chronicle-schedule";

const clock = {
  stepLabel: "season",
  stepLabelPlural: "seasons",
  stepsPerYear: 4,
  minSpan: 1,
  maxSpan: 4,
  epoch: { year: 264, month: 3, day: 1, era: "BCE" as const },
};

describe("projectChronicleDateLabel", () => {
  it("gives same-turn events unique, chronological dates", () => {
    const labels = [0, 1, 2, 3].map((position) =>
      projectChronicleDateLabel({ atStep: 1 }, position, 4, clock),
    );

    expect(labels).toEqual([
      "19th of March 264 BCE",
      "6th of April 264 BCE",
      "25th of April 264 BCE",
      "13th of May 264 BCE",
    ]);
    expect(new Set(labels)).toHaveLength(labels.length);
  });

  it("keeps entries distinct when a scenario has no calendar anchor", () => {
    const labels = [0, 1].map((position) =>
      projectChronicleDateLabel({ atStep: 1 }, position, 2, { ...clock, epoch: undefined }),
    );

    expect(labels).toEqual(["Step 1, day 30", "Step 1, day 61"]);
  });
});
