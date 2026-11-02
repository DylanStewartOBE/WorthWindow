import { roundToPrecision } from "./format";
import type { KneeWall } from "./types";

export interface KneeWallRun {
  id: string;
  columnIndex: number;
  endColumnIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getKneeWallRuns(kneeWalls: KneeWall[]): KneeWallRun[] {
  const sorted = [...kneeWalls].sort((left, right) => left.columnIndex - right.columnIndex);
  const runs: KneeWallRun[] = [];

  sorted.forEach((kneeWall) => {
    const currentRun = runs[runs.length - 1];
    const canExtend =
      currentRun &&
      kneeWall.columnIndex === currentRun.endColumnIndex + 1 &&
      roundToPrecision(kneeWall.height) === roundToPrecision(currentRun.height);

    if (!canExtend) {
      runs.push({
        id: kneeWall.id,
        columnIndex: kneeWall.columnIndex,
        endColumnIndex: kneeWall.columnIndex,
        x: kneeWall.x,
        y: kneeWall.y,
        width: kneeWall.width,
        height: kneeWall.height
      });
      return;
    }

    currentRun.id = `${currentRun.id}-${kneeWall.id}`;
    currentRun.endColumnIndex = kneeWall.columnIndex;
    currentRun.width = roundToPrecision(kneeWall.x + kneeWall.width - currentRun.x);
  });

  return runs;
}
