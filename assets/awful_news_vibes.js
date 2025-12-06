/**
 * awful_news_vibes — D3 renderers for daily “meta” visualizations
 * Requires: D3 v7+ loaded globally as `d3`
 *
 * Usage (example):
 *   <script src="https://unpkg.com/d3@7"></script>
 *   <script src="awful_viz.js"></script>
 *   <div id="date-picker"></div>
 *   <div id="viz-lifecycles"></div>
 *   <div id="viz-momentum"></div>
 *   <div id="viz-divergence"></div>
 *   <div id="viz-emotion"></div>
 *   <div id="viz-compass"></div>
 *   <div id="viz-silences"></div>
 *   <div id="viz-clouds-outlet"></div>
 *   <div id="viz-clouds-cluster"></div>
 *   <div id="viz-fingerprints"></div>
 *
 *   <script>
 *     AwfulViz.init({
 *       rootOutDir: "out",          // base dir
 *       mount: {
 *         datePicker: "#date-picker",
 *         lifecycles: "#viz-lifecycles",
 *         momentum: "#viz-momentum",
 *         divergence: "#viz-divergence",
 *         emotion: "#viz-emotion",
 *         compass: "#viz-compass",
 *         silences: "#viz-silences",
 *         cloudsOutlet: "#viz-clouds-outlet",
 *         cloudsCluster: "#viz-clouds-cluster",
 *         fingerprints: "#viz-fingerprints"
 *       }
 *     });
 *   </script>
 */

const AwfulViz = (() => {
    /* -------------------------- Helpers: Data + DOM -------------------------- */

    async function j(url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch failed: ${url} (${r.status})`);
      return r.json();
    }

    function hashColor(str) {
      // deterministic bright color
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
      const hue = h % 360;
      return d3.hsl(hue, 0.55, 0.55).toString();
    }

    function clear(el) {
      d3.select(el).selectAll("*").remove();
    }

    function makeSvg(el, width, height) {
      return d3
        .select(el)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", "100%")
        .attr("height", "auto");
    }

    /* ---------------------------- Date picker UI ----------------------------- */

	async function buildDatePicker(rootOutDir, mountSel, onChange) {
  const idx = await j(`${rootOutDir}/index.json`).catch(() => ({ dates: [] }));
  const dates = (idx.dates || []).map(d => typeof d === "string" ? d : d.date);
  const latest = idx.latest || (dates.length ? dates.at(-1) : null);

  const mount = d3.select(mountSel).html("");
  const wrap = mount.append("div").attr("class", "awful-date-picker");
  wrap.append("label").text("Select date:");

  const sel = wrap.append("select").on("change", function() {
    const d = this.value;
    if (d) onChange(d);
  });

  sel.selectAll("option")
    .data(dates)
    .join("option")
    .attr("value", d => d)
    .text(d => d);

  if (latest) sel.property("value", latest).dispatch("change");
}

    /* ------------------------- Visualization: Momentum ----------------------- */

    function renderMomentum(mountSel, data) {
      clear(mountSel);
      const width = 1100;
      const height = 420;
      const margin = { top: 30, right: 160, bottom: 40, left: 50 };

      const svg = makeSvg(mountSel, width, height);
      const t = tooltip();

      const x = d3.scalePoint().domain(data.editions.map((_, i) => i)).range([margin.left, width - margin.right]);
      const y = d3.scaleLinear().domain([-1, 1]).nice().range([height - margin.bottom, margin.top]);

      // pick top N by gravity
      const trails = [...data.trails].sort((a, b) => d3.descending(a.gravity, b.gravity)).slice(0, 30);

      svg
        .append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickFormat((i) => data.editions[i]).tickSizeOuter(0))
        .selectAll("text")
        .attr("font-size", 11)
        .attr("transform", "rotate(-15)")
        .style("text-anchor", "end");

      svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y));

      const line = d3
        .line()
        .x((d, i) => x(i))
        .y((d) => y(d))
        .curve(d3.curveCatmullRom.alpha(0.5));

      trails.forEach((tr) => {
        const c = hashColor(tr.id);
        svg
          .append("path")
          .datum(tr.velocity)
          .attr("fill", "none")
          .attr("stroke", c)
          .attr("stroke-width", 1.75)
          .attr("opacity", 0.9)
          .attr("d", line)
          .on("mousemove", (evt) => t.show(`<b>${tr.title}</b><div>Gravity: ${(tr.gravity * 100).toFixed(0)}%</div>`, evt.clientX, evt.clientY))
          .on("mouseleave", t.hide);
      });

      // Legend: top 8
      const legend = svg.append("g").attr("transform", `translate(${width - margin.right + 10}, ${margin.top})`);
      legend
        .selectAll("g")
        .data(trails.slice(0, 8))
        .join("g")
        .attr("transform", (_, i) => `translate(0, ${i * 18})`)
        .each(function (d) {
          const g = d3.select(this);
          g.append("rect").attr("width", 12).attr("height", 12).attr("fill", hashColor(d.id)).attr("rx", 2);
          g.append("text").attr("x", 16).attr("y", 10).attr("font-size", 11).text(d.title);
        });
    }

    /* ---------------------- Visualization: Divergence Map -------------------- */

    function renderDivergence(mountSel, data) {
      clear(mountSel);
      const width = 1100;
      const height = 520;
      const margin = { top: 30, right: 20, bottom: 40, left: 40 };
      const svg = makeSvg(mountSel, width, height);
      const t = tooltip();

      const x = d3.scaleLinear().domain([-1, 1]).range([margin.left, width - margin.right]);
      const y = d3.scaleLinear().domain([-1, 1]).range([height - margin.bottom, margin.top]);

      // axes
      svg.append("g").attr("transform", `translate(0,${y(0)})`).call(d3.axisBottom(x));
      svg.append("g").attr("transform", `translate(${x(0)},0)`).call(d3.axisLeft(y));
      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", margin.top - 8)
        .attr("text-anchor", "middle")
        .attr("font-weight", 600)
        .text("Narrative Divergence — blame↔cause vs risk↔optimism (point shade = certainty)");

      const allPoints = data.clusters.flatMap((c) =>
        c.points.map((p) => ({
          cluster_id: c.id,
          title: c.title,
          outlet: p.outlet,
          x: p.x,
          y: p.y,
          certainty: (p.certainty + 1) / 2, // normalize to 0..1
        }))
      );

      const outlets = Array.from(new Set(allPoints.map((d) => d.outlet)));
      const color = d3.scaleOrdinal().domain(outlets).range(outlets.map((o) => hashColor(o)));

      const r = d3.scaleSqrt().domain([0, 1]).range([3, 8]);

      svg
        .selectAll("circle.pt")
        .data(allPoints)
        .join("circle")
        .attr("class", "pt")
        .attr("cx", (d) => x(d.x))
        .attr("cy", (d) => y(d.y))
        .attr("r", (d) => r(d.certainty))
        .attr("fill", (d) => color(d.outlet))
        .attr("fill-opacity", 0.85)
        .attr("stroke", "white")
        .attr("stroke-width", 0.8)
        .on("mousemove", (evt, d) =>
          t.show(
            `<b>${d.title}</b><div>Outlet: ${d.outlet}</div><div>blame↔cause: ${d.x.toFixed(
              2
            )}</div><div>risk↔optimism: ${d.y.toFixed(2)}</div><div>certainty: ${(d.certainty * 100).toFixed(0)}%</div>`,
            evt.clientX,
            evt.clientY
          )
        )
        .on("mouseleave", t.hide);

      // legend
      const legend = svg.append("g").attr("transform", `translate(${width - 140}, ${margin.top})`);
      legend
        .selectAll("g")
        .data(outlets.slice(0, 12))
        .join("g")
        .attr("transform", (_, i) => `translate(0, ${i * 18})`)
        .each(function (o) {
          const g = d3.select(this);
          g.append("rect").attr("width", 12).attr("height", 12).attr("fill", color(o)).attr("rx", 2);
          g.append("text").attr("x", 16).attr("y", 10).attr("font-size", 11).text(o);
        });
    }

    /* ------------------------ Visualization: Emotion Heat -------------------- */

    function renderEmotion(mountSel, data) {
      clear(mountSel);
      const width = 1100;
      const cell = 36;
      const margin = { top: 60, right: 20, bottom: 30, left: 150 };
      const height = margin.top + margin.bottom + cell * data.series.length;

      const svg = makeSvg(mountSel, width, height);
      const t = tooltip();

      const emotions = data.grid; // ["anxiety","optimism","panic","ambiguity"]
      const x = d3.scaleBand().domain(emotions.map((_, i) => i)).range([margin.left, width - margin.right]).padding(0.12);
      const y = d3.scaleBand().domain(d3.range(data.series.length)).range([margin.top, height - margin.bottom]).padding(0.12);
      const col = d3.scaleLinear().domain([0, 1]).range(["#E7F0FF", "#0F62FE"]);

      // y labels (editions)
      svg
        .append("g")
        .selectAll("text")
        .data(data.series)
        .join("text")
        .attr("x", margin.left - 10)
        .attr("y", (_, i) => y(i) + y.bandwidth() * 0.7)
        .attr("text-anchor", "end")
        .attr("font-size", 12)
        .text((d) => d.edition);

      // x labels (emotions)
      svg
        .append("g")
        .selectAll("text")
        .data(emotions)
        .join("text")
        .attr("x", (_, i) => x(i) + x.bandwidth() / 2)
        .attr("y", margin.top - 20)
        .attr("text-anchor", "middle")
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .text((d) => d);

      const flat = [];
      data.series.forEach((row, ri) => {
        row.scores.forEach((v, ci) => flat.push({ ri, ci, v, label: data.series[ri].edition, emo: emotions[ci] }));
      });

      svg
        .selectAll("rect.cell")
        .data(flat)
        .join("rect")
        .attr("class", "cell")
        .attr("x", (d) => x(d.ci))
        .attr("y", (d) => y(d.ri))
        .attr("width", x.bandwidth())
        .attr("height", y.bandwidth())
        .attr("rx", 4)
        .attr("fill", (d) => col(d.v))
        .on("mousemove", (evt, d) => t.show(`<div><b>${d.label}</b></div><div>${d.emo}: ${(d.v * 100).toFixed(0)}%</div>`, evt.clientX, evt.clientY))
        .on("mouseleave", t.hide);
    }

    /* -------------------------- Visualization: Compass ----------------------- */

    function renderCompass(mountSel, data) {
      clear(mountSel);
      const width = 900;
      const height = 700;
      const margin = { top: 40, right: 20, bottom: 40, left: 40 };

      const svg = makeSvg(mountSel, width, height);
      const t = tooltip();

      const x = d3.scaleLinear().domain([-1, 1]).range([margin.left, width - margin.right]);
      const y = d3.scaleLinear().domain([-1, 1]).range([height - margin.bottom, margin.top]);

      // quadrant backdrop
      const qW = (width - margin.left - margin.right) / 2;
      const qH = (height - margin.top - margin.bottom) / 2;
      const gQ = svg.append("g");
      gQ.append("rect").attr("x", x(-1)).attr("y", y(0)).attr("width", qW).attr("height", qH).attr("fill", "#f6f8ff");
      gQ.append("rect").attr("x", x(0)).attr("y", y(0)).attr("width", qW).attr("height", qH).attr("fill", "#fff7f6");
      gQ.append("rect").attr("x", x(-1)).attr("y", y(1)).attr("width", qW).attr("height", qH).attr("fill", "#f6fff8");
      gQ.append("rect").attr("x", x(0)).attr("y", y(1)).attr("width", qW).attr("height", qH).attr("fill", "#fffef6");

      // cross axes
      svg.append("g").attr("transform", `translate(0,${y(0)})`).call(d3.axisBottom(x).ticks(5).tickFormat(() => "")).selectAll(".tick").remove();
      svg.append("g").attr("transform", `translate(${x(0)},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(() => "")).selectAll(".tick").remove();

      // quadrant labels
      const labels = data.quadrants || ["structural", "conflict", "human", "future"];
      const labelPos = [
        { x: x(-0.65), y: y(-0.75) },
        { x: x(0.65), y: y(-0.75) },
        { x: x(-0.65), y: y(0.75) },
        { x: x(0.65), y: y(0.75) },
      ];
      svg
        .selectAll("text.quad")
        .data(labels)
        .join("text")
        .attr("class", "quad")
        .attr("x", (_, i) => labelPos[i].x)
        .attr("y", (_, i) => labelPos[i].y)
        .attr("font-weight", 700)
        .attr("fill", "#333")
        .text((d) => d);

      // clusters → place by quad + weight jitter
      const r = d3.scaleSqrt().domain([0, 1]).range([3, 12]);
      svg
        .selectAll("circle.pt")
        .data(data.clusters)
        .join("circle")
        .attr("class", "pt")
        .attr("cx", (d) => {
          const jitter = (Math.random() - 0.5) * 0.3 * d.weight;
          return x(d.quad === "structural" || d.quad === "human" ? -0.6 + jitter : 0.6 + jitter);
        })
        .attr("cy", (d) => {
          const jitter = (Math.random() - 0.5) * 0.3 * d.weight;
          return y(d.quad === "conflict" || d.quad === "structural" ? -0.6 + jitter : 0.6 + jitter);
        })
        .attr("r", (d) => r(d.weight))
        .attr("fill", (d) => hashColor(d.id))
        .attr("fill-opacity", 0.85)
        .attr("stroke", "white")
        .attr("stroke-width", 0.8)
        .on("mousemove", (evt, d) => t.show(`<b>${d.title}</b><div>Quadrant: ${d.quad}</div><div>Weight: ${(d.weight * 100).toFixed(0)}%</div>`, evt.clientX, evt.clientY))
        .on("mouseleave", t.hide);

      // centroid
      if (data.centroid) {
        const [cx, cy] = data.centroid;
        svg.append("circle").attr("cx", x(cx)).attr("cy", y(cy)).attr("r", 8).attr("fill", "#0F62FE").attr("fill-opacity", 0.9);
        svg.append("text").attr("x", x(cx) + 10).attr("y", y(cy) + 4).attr("font-size", 12).text("centroid");
      }
    }

    /* -------------------------- Visualization: Silences ---------------------- */

    function renderSilences(mountSel, data) {
      clear(mountSel);
      const root = d3.select(mountSel);
      root.append("h3").text("Silence Tracker");

      const items = data.expectations || [];
      if (!items.length) {
        root.append("div").style("color", "#666").text("No 'expected but missing' items found for this day.");
        return;
      }

      const ul = root.append("ul").style("columns", "2").style("gap", "24px");
      ul
        .selectAll("li")
        .data(items)
        .join("li")
        .style("margin-bottom", "10px")
        .html((d) => `<b>${d.theme || "Theme"}</b><div style="color:#555">${(d.expectedButMissing || []).join(", ")}</div>`);
    }

    /* ---------------------------- Visualization: Clouds ---------------------- */

    function renderCloudsOutlet(mountSel, data) {
      clear(mountSel);
      const root = d3.select(mountSel);
      root.append("h3").text("Outlet Word Clouds (scaled words)");

      // simple proportional word grid (no collision detection)
      const cards = root
        .selectAll("div.card")
        .data((data.by_outlet || []).slice(0, 8))
        .join("div")
        .attr("class", "card")
        .style("border", "1px solid #eee")
        .style("border-radius", "10px")
        .style("padding", "10px 12px")
        .style("margin", "12px 0");

      cards.append("div").style("font-weight", 700).style("margin-bottom", "8px").text((d) => d.outlet);

      cards.each(function (d) {
        const wrap = d3.select(this).append("div").style("line-height", "1.6");
        const maxW = d3.max(d.tokens, (t) => t[1]) || 1;
        wrap
          .selectAll("span")
          .data(d.tokens.slice(0, 40))
          .join("span")
          .style("display", "inline-block")
          .style("margin", "3px 6px")
          .style("color", (t) => hashColor(t[0]))
          .style("font-weight", 600)
          .style("font-size", (t) => `${Math.max(10, (t[1] / maxW) * 28)}px`)
          .text((t) => t[0]);
      });
    }

    function renderCloudsCluster(mountSel, data) {
      clear(mountSel);
      const root = d3.select(mountSel);
      root.append("h3").text("Cluster Word Tokens");

      const entries = Object.entries(data.by_cluster || {});
      const cards = root
        .selectAll("div.card")
        .data(entries.slice(0, 12))
        .join("div")
        .attr("class", "card")
        .style("border", "1px solid #eee")
        .style("border-radius", "10px")
        .style("padding", "10px 12px")
        .style("margin", "12px 0");

      cards
        .append("div")
        .style("font-weight", 700)
        .style("margin-bottom", "8px")
        .text(([id]) => `Cluster ${id}`);

      cards.each(function ([_, tokens]) {
        const wrap = d3.select(this).append("div").style("line-height", "1.6");
        const maxW = d3.max(tokens, (t) => t[1]) || 1;
        wrap
          .selectAll("span")
          .data(tokens.slice(0, 40))
          .join("span")
          .style("display", "inline-block")
          .style("margin", "3px 6px")
          .style("color", (t) => hashColor(t[0]))
          .style("font-weight", 600)
          .style("font-size", (t) => `${Math.max(10, (t[1] / maxW) * 28)}px`)
          .text((t) => t[0]);
      });
    }

    /* ------------------------ Visualization: Fingerprints -------------------- */

    function renderFingerprints(mountSel, data) {
      clear(mountSel);
      const metrics = ["risk", "optimism", "blame", "cause", "certainty"];

      const grid = d3.select(mountSel).append("div").style("display", "grid").style("grid-template-columns", "repeat(auto-fill, minmax(220px, 1fr))").style("gap", "16px");

      (data.clusters || []).slice(0, 12).forEach((c) => {
        const card = grid
          .append("div")
          .style("border", "1px solid #eee")
          .style("border-radius", "12px")
          .style("padding", "10px 12px");

        card.append("div").style("font-weight", 700).style("margin-bottom", "8px").text(c.title);

        const w = 220,
          h = 220,
          r0 = 16,
          r1 = 90;
        const svg = card.append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", "100%").attr("height", "auto");
        const cx = w / 2,
          cy = h / 2;

        const angle = d3.scalePoint().domain(metrics).range([0, 2 * Math.PI]);
        const radius = d3.scaleLinear().domain([0, 1]).range([r0, r1]);
        const col = hashColor(c.id);

        // spokes + labels
        metrics.forEach((m) => {
          const a = angle(m);
          svg
            .append("line")
            .attr("x1", cx)
            .attr("y1", cy)
            .attr("x2", cx + Math.cos(a) * r1)
            .attr("y2", cy + Math.sin(a) * r1)
            .attr("stroke", "#ddd");

          svg
            .append("text")
            .attr("x", cx + Math.cos(a) * (r1 + 10))
            .attr("y", cy + Math.sin(a) * (r1 + 10))
            .attr("font-size", 10)
            .attr("text-anchor", Math.cos(a) > 0 ? "start" : "end")
            .attr("alignment-baseline", "middle")
            .text(m);
        });

        // polygon
        const pts = metrics.map((m) => {
          const v = c.radial[m] ?? 0;
          const a = angle(m);
          return [cx + Math.cos(a) * radius(v), cy + Math.sin(a) * radius(v)];
        });

        svg
          .append("polygon")
          .attr("points", pts.map((p) => p.join(",")).join(" "))
          .attr("fill", col)
          .attr("fill-opacity", 0.18)
          .attr("stroke", col)
          .attr("stroke-width", 1.5);
      });
    }

    /* ------------------------- End-to-end Orchestrator ----------------------- */

    async function renderAllForDate(rootOutDir, date, mount) {
      // load per-day index then the viz files
      const base = `${rootOutDir}/${date}`;
      const idx = await j(`${base}/viz.index.json`);

      // parallel fetches
      const [
        lifecycles,
        momentum,
        divergence,
        emotion,
        compass,
        silences,
        clouds,
        fingerprints,
        // stubs (unused in this demo)
        // cartogram,
        // entities,
        // influence
      ] = await Promise.all([
        j(`${base}/viz.lifecycles.json`),
        j(`${base}/viz.momentum.json`),
        j(`${base}/viz.divergence.json`),
        j(`${base}/viz.emotion.json`),
        j(`${base}/viz.compass.json`),
        j(`${base}/viz.silences.json`),
        j(`${base}/viz.clouds.json`),
        j(`${base}/viz.fingerprints.json`),
        // j(`${base}/viz.cartogram.json`),
        // j(`${base}/viz.entities.json`),
        // j(`${base}/viz.influence.json`),
      ]);

      if (mount.lifecycles) renderLifecycles(mount.lifecycles, lifecycles);
      if (mount.momentum) renderMomentum(mount.momentum, momentum);
      if (mount.divergence) renderDivergence(mount.divergence, divergence);
      if (mount.emotion) renderEmotion(mount.emotion, emotion);
      if (mount.compass) renderCompass(mount.compass, compass);
      if (mount.silences) renderSilences(mount.silences, silences);
      if (mount.cloudsOutlet) renderCloudsOutlet(mount.cloudsOutlet, clouds);
      if (mount.cloudsCluster) renderCloudsCluster(mount.cloudsCluster, clouds);
      if (mount.fingerprints) renderFingerprints(mount.fingerprints, fingerprints);
    }

    /* --------------------------------- API ---------------------------------- */

    async function init(opts) {
      const {
        rootOutDir = "viz",
        mount = {},
        // Optionally pass a default date to render immediately
        defaultDate = null,
      } = opts || {};

      // Date picker (optional)
      if (mount.datePicker) {
        await buildDatePicker(rootOutDir, mount.datePicker, (date) =>
          renderAllForDate(rootOutDir, date, mount)
        );
      } else if (defaultDate) {
        await renderAllForDate(rootOutDir, defaultDate, mount);
      } else {
        // try latest automatically
        const idx = await j(`${rootOutDir}/index.json`).catch(() => ({ latest: null }));
        if (idx.latest) await renderAllForDate(rootOutDir, idx.latest, mount);
      }
    }

    return { init, renderAllForDate };
  })();

  // Optional minimal CSS you can drop in your page:
  //
  // .awful-tooltip { transition: opacity 120ms ease; }
  // .awful-date-picker select { padding: 4px 8px; border-radius: 6px; border: 1px solid #ddd; }
