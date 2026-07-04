// Offline tests for board-voice helpers. Run with: npx tsx scripts/test-board-voice.ts

import {
  clampGridPos,
  prepareBoardVoiceComponents,
  resolveGridCollisions,
} from "../src/lib/boardVoiceApply";
import { stripWakePhrases } from "../src/lib/speechRecognition";
import type { BoardVoiceItem, PanelComponent } from "../src/lib/types";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function tile(id: string, order: number, row?: number, col?: number): PanelComponent {
  return {
    id,
    order,
    row,
    col,
    type: "MCB",
    rating: "32A",
    purposeLabel: `Circuit ${order}`,
    noteIds: [],
    confidence: 1,
  };
}

console.log("stripWakePhrases:");
check(
  "strips wake and stop phrases",
  stripWakePhrases("note breaker 3 is kitchen end note") === "breaker 3 is kitchen",
);
check(
  "preserves transcript without wake words",
  stripWakePhrases("breaker 3 is the kitchen ring") === "breaker 3 is the kitchen ring",
);
check(
  "would alter normal speech if misapplied",
  stripWakePhrases("make a note for breaker 3") === "make a for breaker 3",
);

console.log("\nprepareBoardVoiceComponents:");
{
  const base = [tile("a", 1), tile("b", 2), tile("c", 3)];
  const items: BoardVoiceItem[] = [{ componentId: "c", order: 1, purposeLabel: null, rating: null, note_text: null }];
  const { components: next, preservePositions } = prepareBoardVoiceComponents(
    base,
    items,
    1,
    3,
  );
  check("order move puts tile first", next[0].id === "c" && next[0].order === 1);
  check("order-only defers grid sync to db layer", preservePositions === false);
}

{
  const base = [tile("a", 1, 1, 1), tile("b", 2, 1, 2), tile("c", 3, 1, 3)];
  const items: BoardVoiceItem[] = [
    { componentId: "c", order: 1, purposeLabel: null, rating: null, note_text: null },
    { componentId: "a", row: 2, col: 1, purposeLabel: null, rating: null, note_text: null },
  ];
  const { components: next } = prepareBoardVoiceComponents(base, items, 2, 3);
  const moved = next.find((c) => c.id === "c");
  const explicit = next.find((c) => c.id === "a");
  check("mixed move reorders c first", moved?.order === 1);
  check("non-explicit tile gets new grid slot", moved?.row === 1 && moved?.col === 1);
  check("explicit row/col kept", explicit?.row === 2 && explicit?.col === 1);
}

console.log("\nresolveGridCollisions:");
{
  const base = [tile("a", 1, 1, 1), tile("b", 2, 1, 1)];
  const resolved = resolveGridCollisions(base, 2, 3, new Set(["a"]));
  const a = resolved.find((c) => c.id === "a");
  const b = resolved.find((c) => c.id === "b");
  check("pinned tile stays put", a?.row === 1 && a?.col === 1);
  check(
    "conflicting tile relocated",
    (b?.row !== 1 || b?.col !== 1) && b?.row != null && b?.col != null,
  );
}

console.log("\nclampGridPos:");
check("clamps high", clampGridPos(9, 2) === 2);
check("clamps low", clampGridPos(0, 2) === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
