// Rose City Radar — Block 4: the map.
// Pins are places (venues and standing favorites), not events. Each pin carries the count of
// upcoming events there; MapLibre's built-in clustering groups pins into numbered circles that
// split as you zoom. Coordinates come from GEOCODE (js/geocode.js, generated from
// data/geocode.json) today and from venues.lat/lng once the database carries them.
// Tiles: OpenFreeMap (free, attribution shown). Library: MapLibre GL JS from a pinned CDN.
(function () {
  "use strict";
  var STYLE = "https://tiles.openfreemap.org/styles/dark";
  var ROSE = "#e8415e";

  var normName = function (s) {
    return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  };
  var venueName = function (v) { return normName((v || "").split(" @ ")[0].split(/,\s*\d/)[0].split(",")[0]); };
  var esc = function (s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); };

  // Build the place index: exact keys (name + aliases) and a containment list for longer names.
  function buildPlaces(geocode) {
    var exact = {}, contain = [], places = [];
    // Two passes so a place's own name always beats another place's alias.
    var bySpot = {};
    geocode.forEach(function (g) {
      // Same spot (within ~10 m) = same place under another name (TXM Tyler / Texas Music City).
      var spot = g.lat.toFixed(4) + "," + g.lng.toFixed(4);
      var p = bySpot[spot];
      if (!p) {
        p = bySpot[spot] = { name: g.n, lat: g.lat, lng: g.lng, url: g.u || null, events: [], acts: [], cats: {}, kinds: {} };
        places.push(p);
      } else if (!p.url && g.u) p.url = g.u;
      var k = normName(g.n);
      if (k && !exact[k]) exact[k] = p;
    });
    geocode.forEach(function (g) {
      var p = bySpot[g.lat.toFixed(4) + "," + g.lng.toFixed(4)];
      [g.n].concat(g.a || []).forEach(function (n) {
        var k = normName(n); if (!k) return;
        if (!exact[k]) exact[k] = p;
        if (k.length >= 8) contain.push([k, p]);
      });
    });
    contain.sort(function (a, b) { return b[0].length - a[0].length; });
    return { exact: exact, contain: contain, places: places };
  }
  function findPlace(idx, raw) {
    var k = venueName(raw); if (!k) return null;
    if (idx.exact[k]) return idx.exact[k];
    var full = normName(raw);
    for (var i = 0; i < idx.contain.length; i++) if (full.indexOf(idx.contain[i][0]) >= 0) return idx.contain[i][1];
    return null;
  }

  // A place passes the filter when it has something in the lane and (if a type is chosen) an event of that type.
  var passes = function (p, lane, kind) {
    return (p.events.length || p.acts.length) && (!lane || p.cats[lane]) && (!kind || p.kinds[kind]);
  };
  var countFor = function (p, kind) {
    return kind ? p.events.filter(function (e) { return (e.kinds || []).indexOf(kind) >= 0; }).length : p.events.length;
  };
  function toGeoJSON(places, lane, kind) {
    return {
      type: "FeatureCollection",
      features: places.map(function (p, i) { return [p, i]; }).filter(function (pi) { return passes(pi[0], lane, kind); })
        .map(function (pi) {
          var p = pi[0], i = pi[1], n = countFor(p, kind);
          return { type: "Feature", id: i, geometry: { type: "Point", coordinates: [p.lng, p.lat] },
                   properties: { i: i, name: p.name, count: n, label: n > 1 ? String(n) : "" } };
        })
    };
  }

  function popupHTML(p, o) {
    var weekend = p.events.filter(function (e) { return o.weekend.indexOf(e.date) >= 0; }).length;
    var next = p.events.slice(0, 3).map(function (e) {
      return '<li><span class="mp-date">' + esc(o.md(e.date)) + '</span> ' +
        (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.name) + '</a>' : esc(e.name)) + '</li>';
    }).join("");
    var acts = p.acts.slice(0, 2).map(function (a) { return esc(a.name); }).join(" · ");
    var url = p.url || (p.acts[0] && p.acts[0].url) || null;
    return '<div class="mp">' +
      '<div class="mp-name">' + esc(p.name) + '</div>' +
      '<div class="mp-meta">' + (p.events.length ? p.events.length + ' coming up' + (weekend ? ' · ' + weekend + ' this weekend' : '') : 'standing favorite') + '</div>' +
      (next ? '<ul class="mp-list">' + next + '</ul>' : '') +
      (acts ? '<div class="mp-acts">' + acts + '</div>' : '') +
      (url ? '<a class="mp-link" href="' + esc(url) + '" target="_blank" rel="noopener">Official page →</a>' : '') +
      '</div>';
  }

  // o: { el, cities, city, activities, events, geocode, weekend, md, reduced, onCount }
  function init(o) {
    if (typeof maplibregl === "undefined") { console.warn("MapLibre not loaded; map skipped"); return null; }
    var idx = buildPlaces(o.geocode || []);
    var matched = 0;
    o.events.forEach(function (e) {
      var p = findPlace(idx, e.venue); if (!p) return;
      matched++; p.events.push(e);
      (e.categories || []).forEach(function (c) { p.cats[c] = true; });
      (e.kinds || []).forEach(function (k) { p.kinds[k] = true; });
    });
    o.activities.forEach(function (a) {
      if (a.cadence !== "venue") return;
      var p = idx.exact[normName(a.name)]; if (!p) return;
      p.acts.push(a);
      (a.categories || []).forEach(function (c) { p.cats[c] = true; });
    });
    idx.places.forEach(function (p) { p.events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }); });
    var live = idx.places.filter(function (p) { return p.events.length || p.acts.length; });

    var city = o.city || { lat: 32.3513, lng: -95.3011, radius: 35 };
    var map = new maplibregl.Map({
      container: o.el, style: STYLE, center: [city.lng, city.lat], zoom: 9.3, minZoom: 7, maxZoom: 17,
      attributionControl: { compact: true }, cooperativeGestures: true
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // The panel can change size after the map starts (late layout, a hidden tab, a rotated phone):
    // keep the canvas matched to it so the map never draws into only part of the panel.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(function () { map.resize(); }).observe(map.getContainer());
    }
    var lane = null, kind = null, popup = null;

    map.on("load", function () {
      map.addSource("places", { type: "geojson", data: toGeoJSON(live, lane, kind), cluster: true, clusterMaxZoom: 14, clusterRadius: 46 });
      map.addLayer({ id: "clusters", type: "circle", source: "places", filter: ["has", "point_count"],
        paint: { "circle-color": ROSE, "circle-opacity": .92,
                 "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 30, 25, 80, 30],
                 "circle-stroke-width": 2, "circle-stroke-color": "rgba(243,240,233,.55)" } });
      map.addLayer({ id: "cluster-count", type: "symbol", source: "places", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 13, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#16090b" } });
      map.addLayer({ id: "pins", type: "circle", source: "places", filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": ROSE, "circle-radius": ["case", [">", ["get", "count"], 1], 9, 6],
                 "circle-stroke-width": 1.5, "circle-stroke-color": "#f3f0e9" } });
      map.addLayer({ id: "pin-count", type: "symbol", source: "places", filter: ["!", ["has", "point_count"]],
        layout: { "text-field": ["get", "label"], "text-size": 10, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#16090b" } });

      map.on("click", "clusters", function (ev) {
        var f = map.queryRenderedFeatures(ev.point, { layers: ["clusters"] })[0];
        map.getSource("places").getClusterExpansionZoom(f.properties.cluster_id).then(function (z) {
          map.easeTo({ center: f.geometry.coordinates, zoom: z, duration: o.reduced ? 0 : 500 });
        });
      });
      map.on("click", "pins", function (ev) {
        var f = ev.features[0], p = live[f.properties.i];
        if (popup) popup.remove();
        popup = new maplibregl.Popup({ offset: 12, maxWidth: "300px" }).setLngLat(f.geometry.coordinates).setHTML(popupHTML(p, o)).addTo(map);
      });
      ["clusters", "pins"].forEach(function (l) {
        map.on("mouseenter", l, function () { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", l, function () { map.getCanvas().style.cursor = ""; });
      });
      report();
    });

    function report() {
      var shown = live.filter(function (p) { return passes(p, lane, kind); });
      var ev = shown.reduce(function (n, p) { return n + countFor(p, kind); }, 0);
      if (o.onCount) o.onCount({ places: shown.length, events: ev, matched: matched, total: o.events.length, lane: lane, kind: kind });
    }

    return {
      map: map,
      setFilter: function (c, k) {
        lane = c || null; kind = k || null;
        if (popup) popup.remove();
        var src = map.getSource("places"); if (src) src.setData(toGeoJSON(live, lane, kind));
        report();
      },
      setLane: function (c) { this.setFilter(c, kind); },
      setCity: function (c) {
        if (!c) return;
        map.flyTo({ center: [c.lng, c.lat], zoom: 9.3, duration: o.reduced ? 0 : 900 });
      },
      stats: { places: live.length, matched: matched, total: o.events.length }
    };
  }

  window.RCR_MAP = { init: init };
})();
