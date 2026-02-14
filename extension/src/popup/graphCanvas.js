export function createGraphView(canvas) {
  const ctx = canvas.getContext("2d");
  const state = {
    nodes: [],
    edges: [],
    byKey: new Map(),
    // world -> screen transform
    panX: 0,
    panY: 0,
    zoom: 1,
    dragging: false,
    dragStart: null,
    raf: null
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

    state.nodes = graph.nodes.map((n, i) => ({
      ...n,
      x: (Math.random() - 0.5) * 200 + (n.depth || 0) * 40,
      y: (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
      r: n.objectName === "Account" ? 22 : (n.objectName === "Case" ? 18 : 16),
      idx: i
    }));
    state.byKey = new Map(state.nodes.map((n) => [n.key, n]));
    state.edges = (graph.edges || []).map((e) => ({
      ...e,
      a: state.byKey.get(e.from),
      b: state.byKey.get(e.to)
    })).filter((e) => e.a && e.b);

    // Center root
    const root = graph.root ? state.byKey.get(graph.root.key) : null;
    if (root) {
      root.x = 0;
      root.y = 0;
    }

    state.panX = canvas.width / 2;
    state.panY = canvas.height / 2;
    state.zoom = 1;

    kick();
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
    return {
      x: x * state.zoom + state.panX,
      y: y * state.zoom + state.panY
    };
  }

  function screenToWorld(x, y) {
    return {
      x: (x - state.panX) / state.zoom,
      y: (y - state.panY) / state.zoom
    };
  }

  function pickNode(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const sx = (clientX - rect.left) * dpr;
    const sy = (clientY - rect.top) * dpr;
    const w = screenToWorld(sx, sy);

    let best = null;
    let bestD2 = Infinity;
    for (const n of state.nodes) {
      const dx = w.x - n.x;
      const dy = w.y - n.y;
      const r = n.r / state.zoom;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 < bestD2) {
        best = n;
        bestD2 = d2;
      }
    }
    return best;
  }

  function draw() {
    resize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Edges
    ctx.save();
    ctx.lineWidth = 1 * (window.devicePixelRatio || 1);
    ctx.globalAlpha = 0.65;
    for (const e of state.edges) {
      const a = worldToScreen(e.a.x, e.a.y);
      const b = worldToScreen(e.b.x, e.b.y);
      ctx.strokeStyle = "#aeb7cc";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // Nodes
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `${11 * (window.devicePixelRatio || 1)}px Segoe UI, Tahoma, sans-serif`;
    for (const n of state.nodes) {
      const p = worldToScreen(n.x, n.y);
      const c = colorFor(n.objectName);
      const r = n.r * state.zoom * 0.75;

      // bubble
      ctx.fillStyle = c.fill;
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // label
      const label = `${n.objectName}: ${String(n.label || "").slice(0, 32)}`;
      ctx.fillStyle = "#13203b";
      ctx.textBaseline = "middle";
      ctx.fillText(label, p.x + r + 6, p.y);
    }
    ctx.restore();
  }

  function step() {
    // Basic force layout (small and deterministic enough for popup UX)
    const REPULSION = 9000;
    const SPRING = 0.015;
    const DAMP = 0.88;
    const LINK_DIST = 120;

    // Repulsion
    for (let i = 0; i < state.nodes.length; i++) {
      const a = state.nodes[i];
      for (let j = i + 1; j < state.nodes.length; j++) {
        const b = state.nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const f = REPULSION / d2;
        dx /= Math.sqrt(d2);
        dy /= Math.sqrt(d2);
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
    }

    // Springs
    for (const e of state.edges) {
      const a = e.a;
      const b = e.b;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      const diff = dist - LINK_DIST;
      const fx = (dx / dist) * diff * SPRING;
      const fy = (dy / dist) * diff * SPRING;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Integrate
    for (const n of state.nodes) {
      n.vx *= DAMP;
      n.vy *= DAMP;
      n.x += n.vx * 0.0015;
      n.y += n.vy * 0.0015;
    }

    draw();
    state.raf = requestAnimationFrame(step);
  }

  function kick() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(step);
    // Stop after a short time to save CPU.
    setTimeout(() => {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      draw();
    }, 900);
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
    state.zoom = Math.max(0.35, Math.min(2.8, state.zoom * factor));

    const after = worldToScreen(before.x, before.y);
    state.panX += sx - after.x;
    state.panY += sy - after.y;
    draw();
  }, { passive: false });

  // Intentionally no click-to-navigate: we keep the canvas purely for visualization.

  // Initial draw
  draw();

  return { setGraph, clear };
}
