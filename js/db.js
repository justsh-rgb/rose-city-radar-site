// Rose City Radar — data layer (Block 3).
// If config.js carries a Supabase URL + anon key, the page reads live rows through the
// PostgREST API (row-level security decides what the anon key may see: published rows only).
// If config.js is blank, it loads the bundled js/*.js files, so the static site keeps working
// before the database exists. Either way it sets the same globals the page was written
// against (CITY, ACTIVITIES, EVENTS, EVENTS_HARVESTED, SOURCES) and then calls window.RCR_BOOT().
(function () {
  "use strict";
  var LIVE = typeof SUPABASE_URL === "string" && SUPABASE_URL && typeof SUPABASE_ANON_KEY === "string" && SUPABASE_ANON_KEY;
  var FILES = ["js/data.js", "js/events.js", "js/universe.js", "js/themes.js", "js/places.js"];
  var OPTIONAL = ["js/geocode.js", "js/assign.js"]; // map pins; one-picture-per-card list (11.24.2026)

  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = function () { fail(new Error("failed to load " + src)); };
      document.head.appendChild(s);
    });
  }

  function rest(path) {
    // Paged read: PostgREST returns at most 1,000 rows per request.
    var all = [];
    function page(start) {
      return fetch(SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY,
                   Range: start + "-" + (start + 999), "Range-Unit": "items" }
      }).then(function (r) {
        if (!r.ok) throw new Error(path + " -> HTTP " + r.status);
        return r.json();
      }).then(function (rows) {
        all = all.concat(rows);
        return rows.length < 1000 ? all : page(start + 1000);
      });
    }
    return page(0);
  }

  var mdy = function (s) { if (!s) return ""; var p = s.slice(0, 10).split("-"); return +p[1] + "." + +p[2] + "." + p[0]; };

  function fromSupabase() {
    return Promise.all([
      rest("cities?select=*&active=is.true"),
      rest("activities?select=*&status=eq.published&order=name"),
      rest("v_upcoming_events?select=*&order=starts_on"),
      rest("sources?select=*&order=name")
    ]).then(function (res) {
      var city = res[0][0] || { name: "Tyler", state: "TX", radius_miles: 35 };
      var latest = res[2].reduce(function (m, e) { return e.updated_at > m ? e.updated_at : m; }, "");
      window.CITY = { name: city.name + ", " + city.state, radius: city.radius_miles, compiled: mdy(latest), id: city.id };
      window.CITIES = res[0].map(function (c) {
        return { id: c.id, name: c.name + ", " + c.state, lat: +c.lat, lng: +c.lng, radius: c.radius_miles };
      });
      window.ACTIVITIES = res[1].map(function (a) {
        return { name: a.name, categories: a.categories || [], description: a.description || "", city: a.town || "",
                 distance_miles: a.distance_miles == null ? null : +a.distance_miles, cost: a.cost || "", cadence: a.cadence || "",
                 schedule: a.schedule_text || "", ages: a.ages || "", url: a.url || "", tags: a.tags || [], source: a.source_id || "" };
      });
      window.EVENTS = res[2].map(function (e) {
        return { name: e.name, date: e.starts_on, end_date: e.ends_on || undefined, time: e.time_text || "",
                 venue: e.venue_name || e.venue_text || "", city: e.town || "", distance_miles: e.distance_miles == null ? null : +e.distance_miles,
                 categories: e.categories || [], cost: e.cost || "", description: e.description || "", url: e.url || "", source: e.source_id || "",
                 lat: e.lat, lng: e.lng, photo_path: e.photo_path, photo_credit: e.photo_credit };
      });
      window.EVENTS_HARVESTED = mdy(latest);
      if (res[3].length) {
        window.SOURCES = res[3].map(function (s) {
          return { id: s.id, name: s.name, url: s.url, covers: s.covers, categories: s.categories || [], status: s.status,
                   discovered_from: s.discovered_from, last_checked: mdy(s.last_checked), notes: s.notes, yield: s.yield, last_harvest: s.last_harvest };
        });
      }
      window.RCR_DATA_SOURCE = "supabase";
      var extras = loadScript("js/themes.js").then(function () { return loadScript("js/places.js"); })
        .then(function () { return loadOptional(); });
      if (!res[3].length) {
        // sources has no public read policy (service key only, by design in 001_schema.sql),
        // so the anon key gets an empty list: show the universe from the bundled snapshot.
        extras = extras.then(function () { return loadScript("js/universe.js"); });
      }
      return extras;
    });
  }

  function loadOptional() {
    return OPTIONAL.reduce(function (p, f) {
      return p.then(function () { return loadScript(f).catch(function (e) { console.warn(e.message); }); });
    }, Promise.resolve());
  }

  function fromFiles() {
    window.RCR_DATA_SOURCE = "files";
    return FILES.reduce(function (p, f) { return p.then(function () { return loadScript(f); }); }, Promise.resolve())
      .then(loadOptional);
  }

  function start() {
    var go = LIVE ? fromSupabase().catch(function (err) {
      console.warn("Supabase read failed, falling back to bundled files:", err);
      return fromFiles();
    }) : fromFiles();
    go.then(function () {
      if (typeof window.RCR_BOOT === "function") window.RCR_BOOT();
      else console.error("RCR_BOOT missing: the page script did not register its boot function");
    }).catch(function (err) { console.error(err); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
