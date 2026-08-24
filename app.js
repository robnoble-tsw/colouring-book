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

  var state = {
    currentSceneId: null,
    currentColour: "#ff6b6b",
    undoStack: [],
    zoom: { scale: 1, x: 0, y: 0 },
    saveTimer: null
  };

  var gallery = document.getElementById("gallery");
  var homeScreen = document.getElementById("home");
  var colourScreen = document.getElementById("colour-screen");
  var canvasWrap = document.getElementById("canvasWrap");
  var canvas = document.getElementById("paintCanvas");
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  var pictureTitle = document.getElementById("pictureTitle");
  var swatchesEl = document.getElementById("swatches");
  var customColourInput = document.getElementById("customColour");
  var refOverlay = document.getElementById("refOverlay");
  var refImage = document.getElementById("refImage");
  var refBtn = document.getElementById("refBtn");

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
    } else {
      refBtn.classList.add("hidden");
    }

    homeScreen.classList.add("hidden");
    colourScreen.classList.remove("hidden");

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
    };
    img.src = src;
  }

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

  function handleCanvasTap(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var px = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
    var py = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;

    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var changed = floodFill(imageData, px, py, hexToRgb(state.currentColour), FILL_TOLERANCE);
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

    canvasWrap.addEventListener("pointerdown", function (e) {
      canvasWrap.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved = false;
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
      if (e.target !== canvas) return;
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

  buildGallery();
  buildSwatches();
  setupZoomGestures();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
