(function () {
  "use strict";

  var DB_NAME = "colourit-db";
  var STORE = "progress";
  var SWATCHES = [
    "#ffffff", "#f4f2ea",
    "#ff6b6b", "#ff9f43", "#ffd166", "#f7e463",
    "#8bd450", "#34c77b", "#1fb6c1", "#4a9eff",
    "#6d5adc", "#a06bff", "#ff6bd6", "#ff4f8b",
    "#8b5e34", "#c49a6c", "#5c5c5c", "#1a1a1a"
  ];
  var FILL_TOLERANCE = 45;
  var MAX_UNDO = 15;
  var REGION_LUMA_THRESHOLD = 215;
  var REGION_MIN_AREA = 1800;
  var REGION_MAX_AREA_FRACTION = 0.3;
  var REGION_MAX_PALETTE = 40;
  var REGION_MAX_NUMBERED = 45;
  var REGION_CLUSTER_DIST = 14;

  var state = {
    currentSceneId: null,
    currentColour: "#ff6b6b",
    undoStack: [],
    zoom: { scale: 1, x: 0, y: 0 },
    saveTimer: null,
    mode: "free",
    autoFill: true,
    regionCache: {}
  };

  var gallery = document.getElementById("gallery");
  var homeScreen = document.getElementById("home");
  var colourScreen = document.getElementById("colour-screen");
  var canvasWrap = document.getElementById("canvasWrap");
  var canvas = document.getElementById("paintCanvas");
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  var numbersCanvas = document.getElementById("numbersCanvas");
  var numbersCtx = numbersCanvas.getContext("2d");
  var pictureTitle = document.getElementById("pictureTitle");
  var swatchesEl = document.getElementById("swatches");
  var customColourInput = document.getElementById("customColour");
  var refOverlay = document.getElementById("refOverlay");
  var refImage = document.getElementById("refImage");
  var refBtn = document.getElementById("refBtn");
  var modeFreeBtn = document.getElementById("modeFreeBtn");
  var modeNumbersBtn = document.getElementById("modeNumbersBtn");
  var modeLoading = document.getElementById("modeLoading");
  var numberedPaletteEl = document.getElementById("numberedPalette");
  var autoFillBtn = document.getElementById("autoFillBtn");

  // ---------- INDEXEDDB PROGRESS STORE ----------

  var dbPromise = new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });

  function getProgress(sceneId) {
    return dbPromise.then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(sceneId);
        req.onsuccess = function () { resolve(req.result ? req.result.dataUrl : null); };
        req.onerror = function () { resolve(null); };
      });
    });
  }

  function setProgress(sceneId, dataUrl) {
    return dbPromise.then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ id: sceneId, dataUrl: dataUrl, updatedAt: Date.now() });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }

  function deleteProgress(sceneId) {
    return dbPromise.then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(sceneId);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      setProgress(state.currentSceneId, canvas.toDataURL("image/png"));
    }, 500);
  }

  // ---------- HOME / GALLERY ----------

  function buildGallery() {
    gallery.innerHTML = "";
    SCENES.forEach(function (scene) {
      var card = document.createElement("button");
      card.className = "card";
      card.setAttribute("data-scene", scene.id);

      var thumb = document.createElement("div");
      thumb.className = "card-thumb";
      var img = document.createElement("img");
      img.src = scene.src;
      img.alt = scene.title;
      thumb.appendChild(img);

      getProgress(scene.id).then(function (dataUrl) {
        if (dataUrl) {
          img.src = dataUrl;
          var badge = document.createElement("span");
          badge.className = "card-progress";
          badge.textContent = "In progress";
          thumb.appendChild(badge);
        }
      });

      var title = document.createElement("div");
      title.className = "card-title";
      title.textContent = scene.title;

      var themeEl = document.createElement("div");
      themeEl.className = "card-theme";
      themeEl.textContent = scene.theme;

      card.appendChild(thumb);
      card.appendChild(title);
      card.appendChild(themeEl);

      card.addEventListener("click", function () {
        openScene(scene.id);
      });

      gallery.appendChild(card);
    });
  }

  // ---------- COLOUR SCREEN ----------

  function openScene(sceneId) {
    var scene = SCENES.find(function (s) { return s.id === sceneId; });
    if (!scene) return;

    state.currentSceneId = sceneId;
    state.undoStack = [];
    state.zoom = { scale: 1, x: 0, y: 0 };
    applyZoom();

    pictureTitle.textContent = scene.title;
    canvas.style.visibility = "hidden";

    if (scene.reference) {
      refBtn.classList.remove("hidden");
      refImage.src = scene.reference;
      modeNumbersBtn.classList.remove("hidden");
    } else {
      refBtn.classList.add("hidden");
      modeNumbersBtn.classList.add("hidden");
    }

    homeScreen.classList.add("hidden");
    colourScreen.classList.remove("hidden");
    setMode("free");

    getProgress(sceneId).then(function (savedDataUrl) {
      loadImageIntoCanvas(savedDataUrl || scene.src);
    });
  }

  function loadImageIntoCanvas(src) {
    var img = new Image();
    img.onload = function () {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      canvas.style.visibility = "visible";
      syncOverlaySize();
      if (state.mode === "numbers") redrawNumbersOverlay();
    };
    img.src = src;
  }

  function syncOverlaySize() {
    numbersCanvas.style.left = canvas.offsetLeft + "px";
    numbersCanvas.style.top = canvas.offsetTop + "px";
    numbersCanvas.style.width = canvas.offsetWidth + "px";
    numbersCanvas.style.height = canvas.offsetHeight + "px";
    numbersCanvas.width = canvas.width;
    numbersCanvas.height = canvas.height;
  }

  window.addEventListener("resize", function () {
    if (!colourScreen.classList.contains("hidden")) {
      syncOverlaySize();
      if (state.mode === "numbers") redrawNumbersOverlay();
    }
  });

  function closeScene() {
    clearTimeout(state.saveTimer);
    var sceneId = state.currentSceneId;
    setProgress(sceneId, canvas.toDataURL("image/png")).then(function () {
      colourScreen.classList.add("hidden");
      homeScreen.classList.remove("hidden");
      buildGallery();
    });
  }

  function hexToRgb(hex) {
    var v = hex.replace("#", "");
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    var num = parseInt(v, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function floodFill(imageData, startX, startY, fillRGB, tolerance) {
    var data = imageData.data;
    var width = imageData.width;
    var height = imageData.height;
    var startIdx = (startY * width + startX) * 4;
    var startR = data[startIdx], startG = data[startIdx + 1], startB = data[startIdx + 2];

    var luma = 0.299 * startR + 0.587 * startG + 0.114 * startB;
    if (luma < 60) return false; // tapped on a line

    var fillR = fillRGB[0], fillG = fillRGB[1], fillB = fillRGB[2];
    if (Math.abs(startR - fillR) < 6 && Math.abs(startG - fillG) < 6 && Math.abs(startB - fillB) < 6) return false;

    var tol2 = tolerance * tolerance;
    function matches(idx) {
      var dr = data[idx] - startR, dg = data[idx + 1] - startG, db = data[idx + 2] - startB;
      return (dr * dr + dg * dg + db * db) <= tol2;
    }

    var visited = new Uint8Array(width * height);
    var stack = [[startX, startY]];

    while (stack.length) {
      var pt = stack.pop();
      var x = pt[0], y = pt[1];
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      var vIdx = y * width + x;
      if (visited[vIdx]) continue;
      if (!matches(vIdx * 4)) continue;

      var xl = x;
      while (xl >= 0) {
        var vi = y * width + xl;
        if (visited[vi] || !matches(vi * 4)) break;
        xl--;
      }
      xl++;
      var xr = x;
      while (xr < width) {
        var vi2 = y * width + xr;
        if (visited[vi2] || !matches(vi2 * 4)) break;
        xr++;
      }
      xr--;

      for (var xx = xl; xx <= xr; xx++) {
        var vi3 = y * width + xx;
        visited[vi3] = 1;
        var ii3 = vi3 * 4;
        data[ii3] = fillR; data[ii3 + 1] = fillG; data[ii3 + 2] = fillB; data[ii3 + 3] = 255;
        if (y > 0) {
          var upI = (y - 1) * width + xx;
          if (!visited[upI] && matches(upI * 4)) stack.push([xx, y - 1]);
        }
        if (y < height - 1) {
          var dnI = (y + 1) * width + xx;
          if (!visited[dnI] && matches(dnI * 4)) stack.push([xx, y + 1]);
        }
      }
    }
    return true;
  }

  // ---------- PAINT-BY-NUMBERS ENGINE ----------

  function loadImageData(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var off = document.createElement("canvas");
        off.width = img.naturalWidth;
        off.height = img.naturalHeight;
        var offCtx = off.getContext("2d", { willReadFrequently: true });
        offCtx.drawImage(img, 0, 0);
        resolve(offCtx.getImageData(0, 0, off.width, off.height));
      };
      img.src = src;
    });
  }

  function segmentRegions(imageData) {
    var data = imageData.data;
    var width = imageData.width, height = imageData.height;
    var labels = new Int32Array(width * height).fill(-1);
    var areas = [], sumX = [], sumY = [];
    var nextLabel = 0;

    function fillable(idx) {
      var luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      return luma >= REGION_LUMA_THRESHOLD;
    }

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var pos = y * width + x;
        if (labels[pos] !== -1 || !fillable(pos * 4)) continue;

        var label = nextLabel++;
        var area = 0, sx = 0, sy = 0;
        var stack = [[x, y]];

        while (stack.length) {
          var pt = stack.pop();
          var cx = pt[0], cy = pt[1];
          if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
          var cpos = cy * width + cx;
          if (labels[cpos] !== -1 || !fillable(cpos * 4)) continue;

          var xl = cx;
          while (xl >= 0) {
            var pL = cy * width + xl;
            if (labels[pL] !== -1 || !fillable(pL * 4)) break;
            xl--;
          }
          xl++;
          var xr = cx;
          while (xr < width) {
            var pR = cy * width + xr;
            if (labels[pR] !== -1 || !fillable(pR * 4)) break;
            xr++;
          }
          xr--;

          for (var xx = xl; xx <= xr; xx++) {
            var vp = cy * width + xx;
            labels[vp] = label;
            area++; sx += xx; sy += cy;
            if (cy > 0) {
              var up = (cy - 1) * width + xx;
              if (labels[up] === -1 && fillable(up * 4)) stack.push([xx, cy - 1]);
            }
            if (cy < height - 1) {
              var dn = (cy + 1) * width + xx;
              if (labels[dn] === -1 && fillable(dn * 4)) stack.push([xx, cy + 1]);
            }
          }
        }
        areas.push(area); sumX.push(sx); sumY.push(sy);
      }
    }
    return { labels: labels, count: nextLabel, areas: areas, sumX: sumX, sumY: sumY, width: width, height: height };
  }

  // Picks the dominant (most common) colour per region rather than a flat mean,
  // so gradients / anti-aliased edge pixels don't wash a region's true colour toward grey.
  function averageColours(seg, refData) {
    var rd = refData.data;
    var histograms = new Array(seg.count);
    for (var l = 0; l < seg.count; l++) histograms[l] = new Map();

    for (var i = 0; i < seg.labels.length; i++) {
      var label = seg.labels[i];
      if (label === -1) continue;
      var idx = i * 4;
      var r = rd[idx], g = rd[idx + 1], b = rd[idx + 2];
      var luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < 60) continue; // likely outline bleed or deep shadow, not the region's true colour

      var key = (r >> 3) + "_" + (g >> 3) + "_" + (b >> 3);
      var hist = histograms[label];
      var entry = hist.get(key);
      if (entry) {
        entry.count++; entry.sumR += r; entry.sumG += g; entry.sumB += b;
      } else {
        hist.set(key, { count: 1, sumR: r, sumG: g, sumB: b });
      }
    }

    // Among the largest clusters for a region, prefer the brightest (best-lit) one —
    // photo regions often span both sunlit and shadowed patches of the same surface,
    // and the shadow cluster winning on raw pixel count reads as "muddy" rather than
    // the colour a person would actually call that surface.
    var colours = [];
    for (var lbl = 0; lbl < seg.count; lbl++) {
      var entries = Array.from(histograms[lbl].values());
      var maxCount = entries.reduce(function (m, e) { return Math.max(m, e.count); }, 0);
      var contenders = entries.filter(function (e) { return e.count >= maxCount * 0.3; });
      var best = null, bestLuma = -1;
      contenders.forEach(function (e) {
        var luma = e.sumR / e.count + e.sumG / e.count + e.sumB / e.count;
        if (luma > bestLuma) { bestLuma = luma; best = e; }
      });
      colours.push(best
        ? [Math.round(best.sumR / best.count), Math.round(best.sumG / best.count), Math.round(best.sumB / best.count)]
        : [255, 255, 255]);
    }
    return colours;
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
  }

  function colourDist(a, b) {
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function buildPalette(seg, avgColours) {
    var maxArea = seg.width * seg.height * REGION_MAX_AREA_FRACTION;
    var order = seg.areas.map(function (a, i) { return i; })
      .filter(function (i) { return seg.areas[i] >= REGION_MIN_AREA && seg.areas[i] <= maxArea; })
      .sort(function (a, b) { return seg.areas[b] - seg.areas[a]; });

    var palette = [];
    var regionToNumber = new Int32Array(seg.count).fill(0);

    order.forEach(function (label) {
      var colour = avgColours[label];
      var best = -1, bestDist = Infinity;
      for (var p = 0; p < palette.length; p++) {
        var d = colourDist(colour, palette[p].rgb);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      if (best !== -1 && bestDist <= REGION_CLUSTER_DIST) {
        regionToNumber[label] = palette[best].number;
      } else if (palette.length < REGION_MAX_PALETTE) {
        var number = palette.length + 1;
        palette.push({ number: number, rgb: colour, hex: rgbToHex(colour) });
        regionToNumber[label] = number;
      } else if (best !== -1) {
        regionToNumber[label] = palette[best].number;
      }
    });

    var centroids = [];
    order.forEach(function (label) {
      if (!regionToNumber[label] || centroids.length >= REGION_MAX_NUMBERED) return;
      centroids.push({
        x: seg.sumX[label] / seg.areas[label],
        y: seg.sumY[label] / seg.areas[label],
        number: regionToNumber[label]
      });
    });

    return { regionToNumber: regionToNumber, palette: palette, centroids: centroids };
  }

  function getRegionData(scene) {
    if (state.regionCache[scene.id]) return Promise.resolve(state.regionCache[scene.id]);
    return Promise.all([loadImageData(scene.src), loadImageData(scene.reference)]).then(function (results) {
      var lineData = results[0], refData = results[1];
      var seg = segmentRegions(lineData);
      var avgColours = averageColours(seg, refData);
      var built = buildPalette(seg, avgColours);
      var regionData = {
        labels: seg.labels,
        width: seg.width,
        height: seg.height,
        regionToNumber: built.regionToNumber,
        palette: built.palette,
        centroids: built.centroids
      };
      state.regionCache[scene.id] = regionData;
      return regionData;
    });
  }

  function redrawNumbersOverlay() {
    var regionData = state.regionCache[state.currentSceneId];
    numbersCtx.clearRect(0, 0, numbersCanvas.width, numbersCanvas.height);
    if (!regionData) return;

    var fontSize = Math.max(16, Math.round(numbersCanvas.width / 90));
    numbersCtx.font = "bold " + fontSize + "px -apple-system, sans-serif";
    numbersCtx.textAlign = "center";
    numbersCtx.textBaseline = "middle";

    regionData.centroids.forEach(function (c) {
      var r = fontSize * 0.85;
      numbersCtx.beginPath();
      numbersCtx.arc(c.x, c.y, r, 0, Math.PI * 2);
      numbersCtx.fillStyle = "rgba(255,255,255,0.88)";
      numbersCtx.fill();
      numbersCtx.lineWidth = 2;
      numbersCtx.strokeStyle = "rgba(26,26,26,0.55)";
      numbersCtx.stroke();
      numbersCtx.fillStyle = "#241f3d";
      numbersCtx.fillText(String(c.number), c.x, c.y + 1);
    });
  }

  function renderNumberedPalette(regionData) {
    numberedPaletteEl.innerHTML = "";
    regionData.palette.forEach(function (entry) {
      var chip = document.createElement("button");
      chip.className = "number-chip";
      chip.style.background = entry.hex;
      chip.textContent = entry.number;
      chip.dataset.hex = entry.hex;
      if (entry.hex.toLowerCase() === state.currentColour.toLowerCase()) chip.classList.add("selected");
      chip.addEventListener("click", function () {
        selectColour(entry.hex);
      });
      numberedPaletteEl.appendChild(chip);
    });
  }

  function setMode(mode) {
    state.mode = mode;
    modeFreeBtn.classList.toggle("selected", mode === "free");
    modeNumbersBtn.classList.toggle("selected", mode === "numbers");

    if (mode === "free") {
      numbersCanvas.classList.add("hidden");
      numberedPaletteEl.classList.add("hidden");
      autoFillBtn.classList.add("hidden");
      swatchesEl.classList.remove("hidden");
      customColourInput.parentElement.classList.remove("hidden");
      return;
    }

    swatchesEl.classList.add("hidden");
    customColourInput.parentElement.classList.add("hidden");
    numberedPaletteEl.classList.remove("hidden");
    autoFillBtn.classList.remove("hidden");

    var scene = SCENES.find(function (s) { return s.id === state.currentSceneId; });
    if (!scene || !scene.reference) return;

    modeLoading.classList.remove("hidden");
    getRegionData(scene).then(function (regionData) {
      modeLoading.classList.add("hidden");
      renderNumberedPalette(regionData);
      numbersCanvas.classList.remove("hidden");
      syncOverlaySize();
      redrawNumbersOverlay();
    });
  }

  function fillLabeledRegion(imageData, labels, targetLabel, fillRGB) {
    var data = imageData.data;
    var fillR = fillRGB[0], fillG = fillRGB[1], fillB = fillRGB[2];
    var changed = false;
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] !== targetLabel) continue;
      var idx = i * 4;
      if (data[idx] !== fillR || data[idx + 1] !== fillG || data[idx + 2] !== fillB) changed = true;
      data[idx] = fillR; data[idx + 1] = fillG; data[idx + 2] = fillB; data[idx + 3] = 255;
    }
    return changed;
  }

  function handleCanvasTap(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var px = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
    var py = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;

    var before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var changed;

    if (state.mode === "numbers") {
      var regionData = state.regionCache[state.currentSceneId];
      if (!regionData) return;
      var label = regionData.labels[py * regionData.width + px];
      var number = label >= 0 ? regionData.regionToNumber[label] : 0;
      if (!number) return;
      var fillHex = state.currentColour;
      if (state.autoFill) {
        var entry = regionData.palette.find(function (p) { return p.number === number; });
        fillHex = entry.hex;
      }
      changed = fillLabeledRegion(imageData, regionData.labels, label, hexToRgb(fillHex));
    } else {
      changed = floodFill(imageData, px, py, hexToRgb(state.currentColour), FILL_TOLERANCE);
    }
    if (!changed) return;

    ctx.putImageData(imageData, 0, 0);
    state.undoStack.push(before);
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    scheduleSave();
  }

  function undo() {
    var last = state.undoStack.pop();
    if (!last) return;
    ctx.putImageData(last, 0, 0);
    scheduleSave();
  }

  function resetScene() {
    if (!confirm("Clear all the colour from this picture and start again?")) return;
    var scene = SCENES.find(function (s) { return s.id === state.currentSceneId; });
    state.undoStack = [];
    deleteProgress(state.currentSceneId);
    loadImageIntoCanvas(scene.src);
  }

  // ---------- PALETTE ----------

  function buildSwatches() {
    swatchesEl.innerHTML = "";
    SWATCHES.forEach(function (colour) {
      var btn = document.createElement("button");
      btn.className = "swatch";
      btn.style.background = colour;
      btn.dataset.colour = colour;
      if (colour === state.currentColour) btn.classList.add("selected");
      btn.addEventListener("click", function () {
        selectColour(colour);
      });
      swatchesEl.appendChild(btn);
    });
  }

  function selectColour(colour) {
    state.currentColour = colour;
    swatchesEl.querySelectorAll(".swatch").forEach(function (el) {
      el.classList.toggle("selected", el.dataset.colour.toLowerCase() === colour.toLowerCase());
    });
    numberedPaletteEl.querySelectorAll(".number-chip").forEach(function (el) {
      el.classList.toggle("selected", el.dataset.hex.toLowerCase() === colour.toLowerCase());
    });
  }

  // ---------- ZOOM / PAN ----------

  function applyZoom() {
    var layer = document.getElementById("zoomLayer");
    layer.style.transform =
      "translate(calc(-50% + " + state.zoom.x + "px), calc(-50% + " + state.zoom.y + "px)) scale(" + state.zoom.scale + ")";
  }

  function setupZoomGestures() {
    var pointers = {};
    var startDist = 0;
    var startScale = 1;
    var dragging = false;
    var dragStart = { x: 0, y: 0 };
    var moved = false;

    function dist(pts) {
      var ids = Object.keys(pts);
      var a = pts[ids[0]], b = pts[ids[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    var DRAG_THRESHOLD = 6;
    var downPos = { x: 0, y: 0 };

    canvasWrap.addEventListener("pointerdown", function (e) {
      try { canvasWrap.setPointerCapture(e.pointerId); } catch (err) {}
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved = false;
      downPos = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 2) {
        startDist = dist(pointers);
        startScale = state.zoom.scale;
        dragging = false;
      } else if (Object.keys(pointers).length === 1) {
        dragging = true;
        dragStart = { x: e.clientX - state.zoom.x, y: e.clientY - state.zoom.y };
      }
    });

    canvasWrap.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var count = Object.keys(pointers).length;

      if (count === 2) {
        moved = true;
        var newDist = dist(pointers);
        state.zoom.scale = Math.min(4, Math.max(1, startScale * (newDist / startDist)));
        applyZoom();
      } else if (count === 1 && dragging && state.zoom.scale > 1.01) {
        var travelled = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
        if (travelled < DRAG_THRESHOLD) return;
        state.zoom.x = e.clientX - dragStart.x;
        state.zoom.y = e.clientY - dragStart.y;
        moved = true;
        applyZoom();
      }
    });

    function endPointer(e) {
      delete pointers[e.pointerId];
      dragging = Object.keys(pointers).length === 1;
      if (dragging) {
        var remainingId = Object.keys(pointers)[0];
        dragStart = { x: pointers[remainingId].x - state.zoom.x, y: pointers[remainingId].y - state.zoom.y };
      }
    }
    canvasWrap.addEventListener("pointerup", endPointer);
    canvasWrap.addEventListener("pointercancel", endPointer);

    canvasWrap.addEventListener("click", function (e) {
      if (moved) { moved = false; return; }
      handleCanvasTap(e.clientX, e.clientY);
    });

    document.getElementById("zoomInBtn").addEventListener("click", function () {
      state.zoom.scale = Math.min(4, state.zoom.scale + 0.4);
      applyZoom();
    });
    document.getElementById("zoomOutBtn").addEventListener("click", function () {
      state.zoom.scale = Math.max(1, state.zoom.scale - 0.4);
      if (state.zoom.scale === 1) { state.zoom.x = 0; state.zoom.y = 0; }
      applyZoom();
    });
    document.getElementById("zoomResetBtn").addEventListener("click", function () {
      state.zoom = { scale: 1, x: 0, y: 0 };
      applyZoom();
    });
  }

  // ---------- WIRE UP ----------

  document.getElementById("backBtn").addEventListener("click", closeScene);
  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("resetBtn").addEventListener("click", resetScene);
  refBtn.addEventListener("click", function () { refOverlay.classList.remove("hidden"); });
  document.getElementById("refCloseBtn").addEventListener("click", function () { refOverlay.classList.add("hidden"); });
  refOverlay.addEventListener("click", function (e) {
    if (e.target === refOverlay) refOverlay.classList.add("hidden");
  });
  customColourInput.addEventListener("input", function (e) {
    selectColour(e.target.value);
  });
  modeFreeBtn.addEventListener("click", function () { setMode("free"); });
  modeNumbersBtn.addEventListener("click", function () { setMode("numbers"); });
  autoFillBtn.addEventListener("click", function () {
    state.autoFill = !state.autoFill;
    autoFillBtn.textContent = state.autoFill ? "Tap to auto-fill" : "Match it yourself";
    autoFillBtn.classList.toggle("off", !state.autoFill);
  });

  buildGallery();
  buildSwatches();
  setupZoomGestures();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
