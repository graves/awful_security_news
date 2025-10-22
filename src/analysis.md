<style>
.awful-viz * { box-sizing: border-box; }

.awful-viz .container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

.awful-viz .viz-section {
  background: rgba(255,255,255,0.02);
  border-radius: 10px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  border: 1px solid rgba(255,255,255,0.05);
}

.awful-viz .viz-section h2 {
  font-size: 1.2rem;
  margin: 0 0 0.75rem 0;
}

.awful-viz .awful-date-picker {
  margin-bottom: 1rem;
}
.awful-viz .awful-date-picker label {
  font-weight: 600;
  margin-right: .5rem;
}
.awful-viz .awful-date-picker select {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.2);
  background: #1a1d24;
  color: #fff;
}
.awful-viz svg { width: 100%; height: auto; display: block; }
</style>

<div class="awful-viz">
  <div class="container">
    <div id="date-picker" class="awful-date-picker"></div>

    <div class="viz-section"><h2>📈 Story Lifecycles</h2><div id="viz-lifecycles"></div></div>
    <div class="viz-section"><h2>⚡ Story Momentum</h2><div id="viz-momentum"></div></div>
    <div class="viz-section"><h2>🗺 Narrative Divergence</h2><div id="viz-divergence"></div></div>
    <div class="viz-section"><h2>🌡 Emotional Temperature</h2><div id="viz-emotion"></div></div>
    <div class="viz-section"><h2>🧭 Story Compass</h2><div id="viz-compass"></div></div>
    <div class="viz-section"><h2>🔇 Silence Tracker</h2><div id="viz-silences"></div></div>
    <div class="viz-section"><h2>☁ Word Clouds</h2><div id="viz-clouds-outlet"></div><div id="viz-clouds-cluster"></div></div>
    <div class="viz-section"><h2>🔍 Story Fingerprints</h2><div id="viz-fingerprints"></div></div>
  </div>
</div>

<script src="https://unpkg.com/d3@7" data-cfasync="false"></script>
<script src="assets/awful_news_vibes.js" data-cfasync="false"></script>

<script>
document.addEventListener("DOMContentLoaded", () => {
  AwfulViz.init({
    rootOutDir: "viz",
    mount: {
      datePicker: "#date-picker",
      lifecycles: "#viz-lifecycles",
      momentum: "#viz-momentum",
      divergence: "#viz-divergence",
      emotion: "#viz-emotion",
      compass: "#viz-compass",
      silences: "#viz-silences",
      cloudsOutlet: "#viz-clouds-outlet",
      cloudsCluster: "#viz-clouds-cluster",
      fingerprints: "#viz-fingerprints"
    }
  }).catch(err => {
    console.error("Visualization init failed:", err);
    const c = document.querySelector('.awful-viz .container');
    if (c) c.innerHTML = `<div class="viz-section"><h2>⚠ Error</h2><p>Could not load visualization data from <code>viz/</code>.</p></div>`;
  });
});
</script>
