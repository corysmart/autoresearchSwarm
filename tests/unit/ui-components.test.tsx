import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GraphView } from "../../apps/ui/src/App";

test("GraphView renders an svg graph surface", () => {
  const html = renderToStaticMarkup(
    <GraphView
      graph={{
        nodes: [
          { id: "a", label: "baseline", score: 0.99, node_id: "node-a", origin: "local_verified", execution_mode: "simulated" }
        ],
        edges: []
      }}
    />
  );
  assert.match(html, /<svg/);
  assert.match(html, /baseline|0.990/);
});
