export function createGraphView(canvas) {
  const ctx = canvas.getContext("2d");
  const state = {
    nodes: [],
    edges: [],
    byKey: new Map(),
    rootKey: null,
    panX: 0,
    panY: 0,
    zoom: 1,
    dragging: false,
    dragStart: null
  };

  const CFG = {
    layerGap: 120,
    nodeW: 210,
    nodeH: 34,
    colGap: 26,
    padX: 18,
    padY: 18
  };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function clear() {
    state.nodes = [];
    state.edges = [];
    state.byKey.clear();
    state.rootKey = null;
    state.panX = 0;
    state.panY = 0;
    state.zoom = 1;
    draw();
  }

  function setGraph(graph) {
    if (!graph?.nodes || graph.nodes.length === 0) {
      clear();
      return;
    }

    state.nodes = graph.nodes.map((n) => ({
      ...n,
      x: 0,
      y: 0
    }));
    state.byKey = new Map(state.nodes.map((n) => [n.key, n]));
    state.edges = (graph.edges || []).map((e) => ({
      ...e,
      a: state.byKey.get(e.from),
      b: state.byKey.get(e.to)
    })).filter((e) => e.a && e.b);

    state.rootKey = graph.root?.key || null;

    layoutHierarchy();

    state.panX = canvas.width / 2;
    state.panY = canvas.height / 2;
    state.zoom = 1;
    draw();
  }

  function layoutHierarchy() {
    const root = state.rootKey ? state.byKey.get(state.rootKey) : null;
    if (!root) return;

    // Build directional adjacency:
    // - childEdges: parent -> child (direction === "child")
    // - parentEdges: node -> parent (direction === "parent")
    const childEdges = new Map(); // key -> Set<key>
    const parentEdges = new Map(); // key -> Set<key>

    for (const e of state.edges) {
      if (e.direction === "child") {
        addAdj(childEdges, e.from, e.to);
      } else if (e.direction === "parent") {
        addAdj(parentEdges, e.from, e.to);
      }
    }

    // Assign levels: children positive, parents negative.
    const levelByKey = new Map();
    levelByKey.set(root.key, 0);

    const q = [{ key: root.key, lvl: 0 }];
    while (q.length) {
      const cur = q.shift();

      const kids = childEdges.get(cur.key);
      if (kids) {
        for (const k of kids) {
          const next = cur.lvl + 1;
          const prev = levelByKey.get(k);
          if (prev == null || next < prev) {
            levelByKey.set(k, next);
            q.push({ key: k, lvl: next });
          }
        }
      }

      const pars = parentEdges.get(cur.key);
      if (pars) {
        for (const p of pars) {
          const next = cur.lvl - 1;
          const prev = levelByKey.get(p);
          if (prev == null || next > prev) {
            levelByKey.set(p, next);
            q.push({ key: p, lvl: next });
          }
        }
      }
    }

    // Group by level.
    const levels = new Map(); // lvl -> array nodes
    for (const n of state.nodes) {
      const lvl = levelByKey.get(n.key);
      if (lvl == null) continue;
      if (!levels.has(lvl)) levels.set(lvl, []);
      levels.get(lvl).push(n);
    }

    // Create an ordering per level and refine it (barycenter) to reduce crossings.
    const orderedLevels = Array.from(levels.keys()).sort((a, b) => a - b);

    // Seed order: keep root centered, others alphabetical-ish.
    for (const lvl of orderedLevels) {
      const arr = levels.get(lvl);
      arr.sort((a, b) => String(a.objectName).localeCompare(String(b.objectName)) || String(a.label).localeCompare(String(b.label)));
    }
    // Ensure root is first in its level array (level 0).
    const l0 = levels.get(0) || [];
    const idx = l0.findIndex((n) => n.key === root.key);
    if (idx > 0) {
      const [r] = l0.splice(idx, 1);
      l0.unshift(r);
    }

    // Helper to compute neighbors for barycenter across adjacent levels.
    const posByKey = new Map();
    const setPositions = () => {
      for (const lvl of orderedLevels) {
        const arr = levels.get(lvl);
        for (let i = 0; i < arr.length; i++) posByKey.set(arr[i].key, i);
      }
    };

    const neighborsAcross = (nodeKey, towardsLvl) => {
      const out = [];
      // For nodes at L, towardsLvl could be L-1 or L+1.
      // We include both child and parent edges that land in that level.
      const fromKey = nodeKey;

      // children
      const kids = childEdges.get(fromKey);
      if (kids) {
        for (const k of kids) {
          if (levelByKey.get(k) === towardsLvl) out.push(k);
        }
      }
      // parents
      const pars = parentEdges.get(fromKey);
      if (pars) {
        for (const p of pars) {
          if (levelByKey.get(p) === towardsLvl) out.push(p);
        }
      }
      return out;
    };

    // Two-way sweeps.
    setPositions();
    for (let pass = 0; pass < 6; pass++) {
      // down
      for (let i = 1; i < orderedLevels.length; i++) {
        const lvl = orderedLevels[i];
        const prevLvl = orderedLevels[i - 1];
        const arr = levels.get(lvl);
        arr.sort((a, b) => bary(a.key, prevLvl) - bary(b.key, prevLvl));
        setPositions();
      }
      // up
      for (let i = orderedLevels.length - 2; i >= 0; i--) {
        const lvl = orderedLevels[i];
        const nextLvl = orderedLevels[i + 1];
        const arr = levels.get(lvl);
        arr.sort((a, b) => bary(a.key, nextLvl) - bary(b.key, nextLvl));
        setPositions();
      }
    }

    function bary(key, towardsLvl) {
      const neigh = neighborsAcross(key, towardsLvl);
      if (!neigh.length) return Number.MAX_SAFE_INTEGER / 2;
      let sum = 0;
      let cnt = 0;
      for (const nk of neigh) {
        const p = posByKey.get(nk);
        if (p == null) continue;
        sum += p;
        cnt++;
      }
      if (!cnt) return Number.MAX_SAFE_INTEGER / 2;
      return sum / cnt;
    }

    // Assign coordinates in world space: y by level, x by order.
    const y0 = 0;
    for (const lvl of orderedLevels) {
      const arr = levels.get(lvl);
      const totalW = arr.length * CFG.nodeW + Math.max(0, arr.length - 1) * CFG.colGap;
      const xStart = -totalW / 2 + CFG.nodeW / 2;
      const y = y0 + lvl * CFG.layerGap;

      for (let i = 0; i < arr.length; i++) {
        const x = xStart + i * (CFG.nodeW + CFG.colGap);
        arr[i].x = x;
        arr[i].y = y;
      }
    }

    // Move root to exact center of its layer.
    root.x = 0;
    root.y = 0;
  }

  function draw() {
    resize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Edges first
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);

    for (const e of state.edges) {
      const a = worldToScreen(e.a.x, e.a.y);
      const b = worldToScreen(e.b.x, e.b.y);

      // Edge anchors: from bottom/top of nodes depending on direction.
      const ay = a.y + (e.direction === "child" ? CFG.nodeH * state.zoom * 0.45 : -CFG.nodeH * state.zoom * 0.45);
      const by = b.y + (e.direction === "child" ? -CFG.nodeH * state.zoom * 0.45 : CFG.nodeH * state.zoom * 0.45);

      ctx.strokeStyle = e.direction === "child" ? "#aeb7cc" : "#c6cde0";
      ctx.beginPath();
      const midY = (ay + by) / 2;
      ctx.moveTo(a.x, ay);
      ctx.bezierCurveTo(a.x, midY, b.x, midY, b.x, by);
      ctx.stroke();
    }
    ctx.restore();

    // Nodes
    ctx.save();
    ctx.font = `${12 * (window.devicePixelRatio || 1)}px Segoe UI, Tahoma, sans-serif`;
    ctx.textBaseline = "middle";

    for (const n of state.nodes) {
      const p = worldToScreen(n.x, n.y);
      const c = colorFor(n.objectName);

      const w = CFG.nodeW * state.zoom;
      const h = CFG.nodeH * state.zoom;
      const x = p.x - w / 2;
      const y = p.y - h / 2;

      roundRect(ctx, x, y, w, h, 10 * state.zoom);
      ctx.fillStyle = c.fill;
      ctx.fill();
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
      ctx.stroke();

      const title = `${n.objectName}: ${String(n.label || "").slice(0, 36)}`;
      ctx.fillStyle = "#13203b";
      ctx.fillText(title, x + 10 * state.zoom, p.y);
    }

    ctx.restore();
  }

  function colorFor(objName) {
    switch (objName) {
      case "Account": return { fill: "#e6f1ff", stroke: "#0b5cab" };
      case "Contact": return { fill: "#eafff2", stroke: "#0b6b2c" };
      case "Case": return { fill: "#fff1e6", stroke: "#8a3d00" };
      default: return { fill: "#eef2ff", stroke: "#3b4a6b" };
    }
  }

  function worldToScreen(x, y) {
    return { x: x * state.zoom + state.panX, y: y * state.zoom + state.panY };
  }

  function screenToWorld(x, y) {
    return { x: (x - state.panX) / state.zoom, y: (y - state.panY) / state.zoom };
  }

  canvas.addEventListener("mousedown", (ev) => {
    state.dragging = true;
    state.dragStart = { x: ev.clientX, y: ev.clientY, panX: state.panX, panY: state.panY };
  });

  window.addEventListener("mouseup", () => {
    state.dragging = false;
    state.dragStart = null;
  });

  window.addEventListener("mousemove", (ev) => {
    if (!state.dragging || !state.dragStart) return;
    const dpr = window.devicePixelRatio || 1;
    const dx = (ev.clientX - state.dragStart.x) * dpr;
    const dy = (ev.clientY - state.dragStart.y) * dpr;
    state.panX = state.dragStart.panX + dx;
    state.panY = state.dragStart.panY + dy;
    draw();
  });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * dpr;
    const sy = (ev.clientY - rect.top) * dpr;
    const before = screenToWorld(sx, sy);

    const factor = ev.deltaY < 0 ? 1.12 : 0.89;
    state.zoom = Math.max(0.35, Math.min(2.4, state.zoom * factor));

    const after = worldToScreen(before.x, before.y);
    state.panX += sx - after.x;
    state.panY += sy - after.y;
    draw();
  }, { passive: false });

  // Initial draw
  draw();

  return { setGraph, clear };
}

function addAdj(map, from, to) {
  if (!map.has(from)) map.set(from, new Set());
  map.get(from).add(to);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

