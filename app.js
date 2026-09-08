(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    screen: "landing",
    previousScreen: "landing",
    frame: { color: "#f2d691", size: "strip", slots: 3, radius: 8, caption: true },
    filter: { type: "colored", warmth: 20, contrast: 100, saturation: 100 },
    timer: 5,
    photos: [],
    stream: null,
    facingMode: "user",
    retakeIndex: null,
    sound: true,
    tutorialSlide: 0,
    captureBusy: false
  };

  const filterInfo = {
    colored: ["True Color", "Bright, honest, and exactly as the camera sees it."],
    bw: ["Silver Screen", "Timeless black-and-white with a little extra contrast."],
    preset: ["Sun-Kissed", "Warm, saturated color inspired by well-loved film."],
    custom: ["Likha Mix", "Your own blend of warmth, contrast, and color."]
  };

  function showScreen(name) {
    if (name === state.screen) return;
    state.previousScreen = state.screen;
    $$(".screen").forEach((screen) => screen.classList.toggle("screen--active", screen.dataset.screen === name));
    state.screen = name;
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (name !== "capture") stopCamera();
    if (name === "timer") updateSummary();
    if (name === "review") renderReview();
    if (name === "final") renderFinal();
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function beep(frequency = 650, duration = 90) {
    if (!state.sound) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration / 1000);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration / 1000);
    } catch (_) { /* Audio feedback is optional. */ }
  }

  function setFrameRoute(route) {
    if (route === "builtin") {
      state.frame = { color: "#f2d691", size: "strip", slots: 3, radius: 8, caption: true };
      toast("Classic strip loaded—customize it if you like.");
    } else {
      state.frame = { color: "#28a9cb", size: "postcard", slots: 4, radius: 14, caption: true };
      toast("Custom canvas ready for your touch.");
    }
    syncFrameControls();
    showScreen("frame-editor");
  }

  function syncFrameControls() {
    $("#frame-color").value = state.frame.color;
    $("#frame-size").value = state.frame.size;
    $("#slot-layout").value = String(state.frame.slots);
    $("#corner-range").value = String(state.frame.radius);
    $("#corner-value").textContent = `${state.frame.radius} px`;
    $("#show-caption").checked = state.frame.caption;
    updateFramePreview();
  }

  function updateFramePreview() {
    const frame = $("#frame-preview");
    frame.style.backgroundColor = state.frame.color;
    frame.className = `editable-frame layout-${state.frame.slots}`;
    if (state.frame.size !== "strip") frame.classList.add(`layout-${state.frame.size}`);
    const current = $$(".frame-slot", frame);
    while (current.length > state.frame.slots) current.pop().remove();
    while ($$(".frame-slot", frame).length < state.frame.slots) {
      const slot = document.createElement("div");
      slot.className = "frame-slot";
      frame.insertBefore(slot, $(".frame-caption", frame));
    }
    $$(".frame-slot", frame).forEach((slot, index) => {
      slot.style.borderRadius = `${state.frame.radius}px`;
      slot.draggable = true;
      slot.dataset.index = index;
      slot.innerHTML = `<span>${index + 1}</span>`;
    });
    $(".frame-caption", frame).hidden = !state.frame.caption;
    setupSlotDragging();
  }

  function setupSlotDragging() {
    let dragged = null;
    $$(".frame-slot", $("#frame-preview")).forEach((slot) => {
      slot.addEventListener("dragstart", () => { dragged = slot; slot.style.opacity = ".45"; });
      slot.addEventListener("dragend", () => { slot.style.opacity = "1"; dragged = null; });
      slot.addEventListener("dragover", (event) => event.preventDefault());
      slot.addEventListener("drop", (event) => {
        event.preventDefault();
        if (dragged && dragged !== slot) slot.parentElement.insertBefore(dragged, slot);
      });
    });
  }

  function cssFilter() {
    if (state.filter.type === "bw") return "grayscale(1) contrast(1.08)";
    if (state.filter.type === "preset") return "sepia(.35) saturate(1.4) contrast(1.05)";
    if (state.filter.type === "custom") {
      const sepia = Math.round(state.filter.warmth * .45);
      return `sepia(${sepia}%) contrast(${state.filter.contrast}%) saturate(${state.filter.saturation}%)`;
    }
    return "none";
  }

  function selectFilter(type) {
    state.filter.type = type;
    $$("[data-filter]").forEach((button) => button.classList.toggle("active", button.dataset.filter === type));
    const angles = { bw: -55, colored: 0, preset: 55, custom: 110 };
    $(".dial-pointer").style.transform = `rotate(${angles[type]}deg)`;
    $("#mode-name").textContent = filterInfo[type][0];
    $("#mode-copy").textContent = filterInfo[type][1];
    $("#custom-filter-panel").hidden = type !== "custom";
    const preview = $("#filter-preview");
    preview.className = "live-preview";
    preview.style.filter = cssFilter();
    beep(500 + angles[type] * 2, 70);
  }

  function updateSummary() {
    const sizeNames = { strip: "strip", postcard: "postcard", square: "square" };
    $("#summary-layout").textContent = `${state.frame.slots}-photo ${sizeNames[state.frame.size]}`;
    $("#summary-filter").textContent = filterInfo[state.filter.type][0];
    $("#summary-timer").textContent = `${state.timer} seconds`;
    $("#capture-timer").textContent = `${state.timer}s`;
  }

  async function startCamera() {
    showScreen("capture");
    updateShotProgress();
    const video = $("#camera-video");
    const placeholder = $("#camera-placeholder");
    const upload = $("#upload-preview");
    upload.hidden = true;
    video.hidden = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      placeholder.hidden = false;
      toast("Camera unavailable. You can upload a photo instead.");
      return;
    }
    try {
      stopCamera();
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: state.facingMode, width: { ideal: 1600 }, height: { ideal: 1200 } },
        audio: false
      });
      video.srcObject = state.stream;
      video.style.filter = cssFilter();
      placeholder.hidden = true;
    } catch (_) {
      video.hidden = true;
      placeholder.hidden = false;
      toast("Camera permission was not granted. Upload a photo to continue.");
    }
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    const video = $("#camera-video");
    if (video) video.srcObject = null;
  }

  function currentTargetIndex() {
    return state.retakeIndex === null ? state.photos.length : state.retakeIndex;
  }

  function updateShotProgress() {
    const index = currentTargetIndex();
    $("#shot-progress").textContent = state.retakeIndex === null
      ? `Photo ${Math.min(index + 1, state.frame.slots)} of ${state.frame.slots}`
      : `Retaking photo ${index + 1}`;
  }

  async function countdownAndCapture() {
    if (state.captureBusy) return;
    const videoReady = state.stream && $("#camera-video").readyState >= 2;
    const uploadReady = !$("#upload-preview").hidden && $("#upload-preview").src;
    if (!videoReady && !uploadReady) {
      toast("Connect the camera or upload a photo first.");
      return;
    }
    state.captureBusy = true;
    $("#shutter").disabled = true;
    for (let count = state.timer; count > 0; count--) {
      $("#countdown").textContent = count;
      beep(count <= 3 ? 800 : 540, 75);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    $("#countdown").textContent = "";
    captureCurrentFrame();
    $("#camera-flash").classList.add("flash");
    beep(1100, 150);
    setTimeout(() => $("#camera-flash").classList.remove("flash"), 320);
    await new Promise((resolve) => setTimeout(resolve, 500));
    state.captureBusy = false;
    $("#shutter").disabled = false;
    if (state.retakeIndex !== null) {
      state.retakeIndex = null;
      showScreen("review");
    } else if (state.photos.length >= state.frame.slots) {
      showScreen("review");
    } else {
      updateShotProgress();
      toast("Nice! Get ready for the next one.");
    }
  }

  function captureCurrentFrame() {
    const canvas = $("#capture-canvas");
    const context = canvas.getContext("2d");
    const uploaded = $("#upload-preview");
    const usingUpload = !uploaded.hidden && uploaded.src;
    const source = usingUpload ? uploaded : $("#camera-video");
    const sourceWidth = usingUpload ? source.naturalWidth : source.videoWidth;
    const sourceHeight = usingUpload ? source.naturalHeight : source.videoHeight;
    canvas.width = 1200;
    canvas.height = 900;
    context.save();
    context.filter = cssFilter();
    if (!usingUpload && state.facingMode === "user") {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    drawCover(context, source, 0, 0, canvas.width, canvas.height, sourceWidth, sourceHeight);
    context.restore();
    const photo = canvas.toDataURL("image/jpeg", .92);
    const index = currentTargetIndex();
    if (state.retakeIndex === null) state.photos.push(photo);
    else state.photos[index] = photo;
  }

  function drawCover(context, image, x, y, width, height, sourceWidth = image.width, sourceHeight = image.height) {
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function handleUpload(file) {
    if (!file) return;
    if (!/image\/(png|jpeg)/.test(file.type)) return toast("Please choose a PNG or JPG image.");
    if (file.size > 25 * 1024 * 1024) return toast("That image is larger than 25 MB.");
    const reader = new FileReader();
    reader.onload = () => {
      const image = $("#upload-preview");
      image.src = reader.result;
      image.hidden = false;
      image.style.filter = cssFilter();
      $("#camera-video").hidden = true;
      $("#camera-placeholder").hidden = true;
      toast("Photo ready. Press the shutter when you are set.");
    };
    reader.readAsDataURL(file);
  }

  function renderReview() {
    const frame = $("#review-frame");
    frame.className = `result-frame ${state.frame.size}`;
    frame.style.backgroundColor = state.frame.color;
    frame.innerHTML = "";
    state.photos.slice(0, state.frame.slots).forEach((photo, index) => {
      const item = document.createElement("button");
      item.className = "review-photo";
      item.dataset.photoIndex = index;
      item.style.borderRadius = `${state.frame.radius}px`;
      item.innerHTML = `<img src="${photo}" alt="Captured photo ${index + 1}">`;
      frame.appendChild(item);
    });
    if (state.frame.caption) {
      const caption = document.createElement("strong");
      caption.className = "result-caption";
      caption.textContent = "LIKHA NATIN 'TO!";
      frame.appendChild(caption);
    }
    state.retakeIndex = null;
    $("#retake-button").disabled = true;
    $("#retake-status").textContent = "No photo selected";
  }

  function selectReviewPhoto(index) {
    state.retakeIndex = Number(index);
    $$(".review-photo").forEach((photo) => photo.classList.toggle("selected", Number(photo.dataset.photoIndex) === state.retakeIndex));
    $("#retake-status").textContent = `Photo ${state.retakeIndex + 1} selected`;
    $("#retake-button").disabled = false;
  }

  async function renderFinal() {
    const canvas = $("#final-canvas");
    const dimensions = state.frame.size === "strip" ? [720, 1600] : state.frame.size === "square" ? [1200, 1200] : [1400, 900];
    canvas.width = dimensions[0];
    canvas.height = dimensions[1];
    const context = canvas.getContext("2d");
    context.fillStyle = state.frame.color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const padding = Math.round(canvas.width * .045);
    const captionHeight = state.frame.caption ? Math.round(canvas.height * .09) : padding;
    const gap = Math.round(canvas.width * .025);
    const columns = state.frame.size === "strip" ? 1 : 2;
    const rows = Math.ceil(state.frame.slots / columns);
    const photoWidth = (canvas.width - padding * 2 - gap * (columns - 1)) / columns;
    const photoHeight = (canvas.height - padding - captionHeight - padding - gap * (rows - 1)) / rows;
    const images = await Promise.all(state.photos.slice(0, state.frame.slots).map(loadImage));
    images.forEach((image, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = padding + column * (photoWidth + gap);
      const y = padding + row * (photoHeight + gap);
      context.save();
      roundedRect(context, x, y, photoWidth, photoHeight, state.frame.radius * 2);
      context.clip();
      drawCover(context, image, x, y, photoWidth, photoHeight, image.width, image.height);
      context.restore();
    });
    if (state.frame.caption) {
      context.fillStyle = readableTextColor(state.frame.color);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `700 ${Math.round(canvas.width * .038)}px DM Sans, sans-serif`;
      context.fillText("LIKHA NATIN 'TO!  •  LIKHATRO", canvas.width / 2, canvas.height - captionHeight / 2);
    }
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.roundRect(x, y, width, height, r);
  }

  function readableTextColor(hex) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16), g = parseInt(value.slice(2, 4), 16), b = parseInt(value.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#273b35" : "#fffaf0";
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
  }

  function downloadCanvas(type) {
    const canvas = $("#final-canvas");
    const mime = type === "jpg" ? "image/jpeg" : "image/png";
    const link = document.createElement("a");
    link.download = `likhatro-memory-${new Date().toISOString().slice(0, 10)}.${type}`;
    link.href = canvas.toDataURL(mime, .94);
    link.click();
    toast(`${type.toUpperCase()} saved!`);
  }

  function downloadIndividuals() {
    state.photos.slice(0, state.frame.slots).forEach((photo, index) => {
      setTimeout(() => {
        const link = document.createElement("a");
        link.download = `likhatro-photo-${index + 1}.jpg`;
        link.href = photo;
        link.click();
      }, index * 250);
    });
    toast("Saving your individual photos.");
  }

  function startOver() {
    state.photos = [];
    state.retakeIndex = null;
    showScreen("menu");
  }

  function openTutorial() {
    state.tutorialSlide = 0;
    updateTutorial();
    $("#tutorial-dialog").showModal();
  }

  function updateTutorial() {
    $$(".tutorial-slide").forEach((slide, index) => slide.classList.toggle("active", index === state.tutorialSlide));
    $$(".tutorial-dots i").forEach((dot, index) => dot.classList.toggle("active", index === state.tutorialSlide));
    $("#tutorial-next").textContent = state.tutorialSlide === 2 ? "Let's go →" : "Next →";
  }

  document.addEventListener("click", (event) => {
    const go = event.target.closest("[data-go]");
    if (go) showScreen(go.dataset.go);
    const back = event.target.closest("[data-back]");
    if (back) showScreen(back.dataset.back);
    const frameRoute = event.target.closest("[data-frame-route]");
    if (frameRoute) setFrameRoute(frameRoute.dataset.frameRoute);
    const filter = event.target.closest("[data-filter]");
    if (filter) selectFilter(filter.dataset.filter);
    const timer = event.target.closest("[data-timer]");
    if (timer) {
      state.timer = Number(timer.dataset.timer);
      $$("[data-timer]").forEach((option) => {
        const active = option === timer;
        option.classList.toggle("active", active);
        option.setAttribute("aria-checked", String(active));
      });
      updateSummary();
      beep(700, 70);
    }
    const palette = event.target.closest("[data-palette]");
    if (palette) {
      state.frame.color = palette.dataset.palette;
      $("#frame-color").value = state.frame.color;
      $$("[data-palette]").forEach((item) => item.classList.toggle("active", item === palette));
      updateFramePreview();
    }
    const reviewPhoto = event.target.closest("[data-photo-index]");
    if (reviewPhoto) selectReviewPhoto(reviewPhoto.dataset.photoIndex);
    if (event.target.closest("[data-open-tutorial]")) openTutorial();
    if (event.target.closest("[data-close-tutorial]")) $("#tutorial-dialog").close();
  });

  $("#frame-color").addEventListener("input", (event) => { state.frame.color = event.target.value; updateFramePreview(); });
  $("#frame-size").addEventListener("change", (event) => { state.frame.size = event.target.value; updateFramePreview(); });
  $("#slot-layout").addEventListener("change", (event) => { state.frame.slots = Number(event.target.value); state.photos = state.photos.slice(0, state.frame.slots); updateFramePreview(); });
  $("#corner-range").addEventListener("input", (event) => { state.frame.radius = Number(event.target.value); $("#corner-value").textContent = `${state.frame.radius} px`; updateFramePreview(); });
  $("#show-caption").addEventListener("change", (event) => { state.frame.caption = event.target.checked; updateFramePreview(); });
  $("[data-save-frame]").addEventListener("click", () => showScreen("mode"));
  ["warmth", "contrast", "saturation"].forEach((id) => {
    $(`#${id}`).addEventListener("input", (event) => { state.filter[id] = Number(event.target.value); $("#filter-preview").style.filter = cssFilter(); });
  });
  $("[data-start-camera]").addEventListener("click", startCamera);
  $("[data-leave-camera]").addEventListener("click", () => showScreen("timer"));
  $("[data-return-camera]").addEventListener("click", startCamera);
  $("#switch-camera").addEventListener("click", async () => { state.facingMode = state.facingMode === "user" ? "environment" : "user"; await startCamera(); });
  $("#photo-upload").addEventListener("change", (event) => handleUpload(event.target.files[0]));
  $("#shutter").addEventListener("click", countdownAndCapture);
  $("#retake-button").addEventListener("click", startCamera);
  $("#finish-button").addEventListener("click", () => showScreen("final"));
  $("#download-png").addEventListener("click", () => downloadCanvas("png"));
  $("#download-jpg").addEventListener("click", () => downloadCanvas("jpg"));
  $("#download-individual").addEventListener("click", downloadIndividuals);
  $("#start-over").addEventListener("click", startOver);
  $("#sound-toggle").addEventListener("click", (event) => {
    state.sound = !state.sound;
    event.currentTarget.setAttribute("aria-pressed", String(state.sound));
    event.currentTarget.setAttribute("aria-label", `Turn sound ${state.sound ? "off" : "on"}`);
    event.currentTarget.lastElementChild.textContent = `Sound ${state.sound ? "on" : "off"}`;
    if (state.sound) beep();
  });
  $("#tutorial-next").addEventListener("click", () => {
    if (state.tutorialSlide < 2) { state.tutorialSlide++; updateTutorial(); }
    else { $("#tutorial-dialog").close(); showScreen("menu"); }
  });
  $("#tutorial-dialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  syncFrameControls();
  updateSummary();
})();
