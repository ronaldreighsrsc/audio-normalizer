/* ==========================================================================
   Soundwave Application JavaScript Logic
   Featuring WaveSurfer v7, Web Audio Visualizer, Sync Lyrics & DSP Trimming
   ========================================================================== */

import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
import RegionsPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js';
import TimelinePlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/timeline.esm.js';

// Application State
let activeFolder = 'input'; // 'input' or 'output'
let libraryFiles = { input: [], output: [] };
let currentTrack = null;
let lrcLines = [];
let lrcActiveIndex = -1;

// Web Audio API Visualizer State
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let isVisualizerRunning = false;

// WaveSurfer State
let ws = null;
let wsRegions = null;
let activeRegion = null;
let isPlayingSelection = false;

// DOM Elements cache
const els = {
  // Library Elements
  uploadForm: document.getElementById('upload-form'),
  audioFileInput: document.getElementById('audio-file-input'),
  lrcFileInput: document.getElementById('lrc-file-input'),
  dropZone: document.getElementById('drop-zone'),
  lrcLabel: document.getElementById('lrc-label'),
  lrcFilename: document.getElementById('lrc-filename'),
  uploadSubmitBtn: document.getElementById('upload-submit-btn'),
  uploadProgressContainer: document.getElementById('upload-progress-container'),
  uploadProgressFill: document.getElementById('upload-progress-fill'),
  refreshLibrary: document.getElementById('refresh-library'),
  librarySearch: document.getElementById('library-search'),
  tabInputBtn: document.getElementById('tab-input-btn'),
  tabOutputBtn: document.getElementById('tab-output-btn'),
  countInput: document.getElementById('count-input'),
  countOutput: document.getElementById('count-output'),
  filesList: document.getElementById('files-list'),

  // Workspace Screens
  welcomeScreen: document.getElementById('welcome-screen'),
  studioContainer: document.getElementById('studio-container'),

  // Track Metadata
  trackFolderBadge: document.getElementById('track-folder-badge'),
  currentTrackTitle: document.getElementById('current-track-title'),
  metaDuration: document.getElementById('meta-duration'),
  metaSize: document.getElementById('meta-size'),
  metaLyricsStatus: document.getElementById('meta-lyrics-status'),

  // Player Elements
  vinylDisc: document.getElementById('vinyl-disc'),
  btnScreenVis: document.getElementById('btn-screen-vis'),
  btnScreenLyrics: document.getElementById('btn-screen-lyrics'),
  visCanvas: document.getElementById('vis-canvas'),
  lyricsContainer: document.getElementById('lyrics-container'),
  currentTimeLabel: document.getElementById('current-time'),
  totalTimeLabel: document.getElementById('total-time'),
  progressWrapper: document.getElementById('progress-wrapper'),
  playerProgressFill: document.getElementById('player-progress-fill'),
  playerProgressHandle: document.getElementById('player-progress-handle'),
  btnPrev: document.getElementById('btn-prev'),
  btnPlayPause: document.getElementById('btn-play-pause'),
  btnNext: document.getElementById('btn-next'),
  btnMute: document.getElementById('btn-mute'),
  volumeSlider: document.getElementById('volume-slider'),
  btnLoop: document.getElementById('btn-loop'),
  btnZoomToTrim: document.getElementById('btn-zoom-to-trim'),

  // Trimmer Elements
  waveformLoading: document.getElementById('waveform-loading'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnResetZoom: document.getElementById('btn-reset-zoom'),
  btnPlaySelection: document.getElementById('btn-play-selection'),
  trimStart: document.getElementById('trim-start'),
  trimEnd: document.getElementById('trim-end'),
  btnSetStart: document.getElementById('btn-set-start'),
  btnSetEnd: document.getElementById('btn-set-end'),
  btnSetMax: document.getElementById('btn-set-max'),
  trimOutputName: document.getElementById('trim-output-name'),
  trimOutputExt: document.getElementById('trim-output-ext'),
  btnExecuteTrim: document.getElementById('btn-execute-trim'),
  toastContainer: document.getElementById('toast-container')
};

// ==========================================================================
// Initialization & Listeners
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  fetchLibrary();
  setupEventListeners();
});

function setupEventListeners() {
  // Library Tabs
  els.tabInputBtn.addEventListener('click', () => switchLibraryTab('input'));
  els.tabOutputBtn.addEventListener('click', () => switchLibraryTab('output'));
  els.refreshLibrary.addEventListener('click', fetchLibrary);
  els.librarySearch.addEventListener('input', renderLibraryList);

  // Drag and Drop Upload Setup
  els.dropZone.addEventListener('click', () => els.audioFileInput.click());
  els.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropZone.classList.add('dragover');
  });
  els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
  els.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      els.audioFileInput.files = e.dataTransfer.files;
      handleAudioFileSelected();
    }
  });

  els.audioFileInput.addEventListener('change', handleAudioFileSelected);
  els.lrcFileInput.addEventListener('change', () => {
    const file = els.lrcFileInput.files[0];
    if (file) {
      els.lrcFilename.textContent = `Lyrics: ${file.name}`;
      showToast('Letras de sincronización añadidas para subir.', 'info');
    }
  });

  els.uploadForm.addEventListener('submit', handleUploadSubmit);

  // Player Buttons
  els.btnPlayPause.addEventListener('click', togglePlayback);
  els.btnMute.addEventListener('click', toggleMute);
  els.volumeSlider.addEventListener('input', handleVolumeChange);
  els.btnLoop.addEventListener('click', toggleLoop);
  els.btnZoomToTrim.addEventListener('click', zoomToActiveRegion);

  // Prev / Next Buttons
  els.btnPrev.addEventListener('click', playPreviousTrack);
  els.btnNext.addEventListener('click', playNextTrack);

  // Custom Seek Progress timeline click
  els.progressWrapper.addEventListener('click', handleTimelineSeek);

  // Screen View Switchers (Visualizer vs Lyrics)
  els.btnScreenVis.addEventListener('click', () => switchScreenMode('vis'));
  els.btnScreenLyrics.addEventListener('click', () => switchScreenMode('lyrics'));

  // Trimmer Controls
  els.btnZoomIn.addEventListener('click', () => ws && ws.zoom(ws.getZoom() * 1.5));
  els.btnZoomOut.addEventListener('click', () => ws && ws.zoom(ws.getZoom() / 1.5));
  els.btnResetZoom.addEventListener('click', () => ws && ws.zoom(0));
  els.btnPlaySelection.addEventListener('click', togglePlaySelection);

  // Set Cut buttons
  els.btnSetStart.addEventListener('click', () => {
    if (ws) {
      const curTime = ws.getCurrentTime();
      els.trimStart.value = Math.min(curTime, parseFloat(els.trimEnd.value) - 0.1).toFixed(2);
      updateRegionFromInputs();
    }
  });
  els.btnSetEnd.addEventListener('click', () => {
    if (ws) {
      const curTime = ws.getCurrentTime();
      els.trimEnd.value = Math.max(curTime, parseFloat(els.trimStart.value) + 0.1).toFixed(2);
      updateRegionFromInputs();
    }
  });

  els.btnSetMax.addEventListener('click', () => {
    if (ws) {
      const dur = ws.getDuration();
      els.trimEnd.value = dur.toFixed(2);
      updateRegionFromInputs();
    }
  });

  // Inputs onChange
  els.trimStart.addEventListener('input', updateRegionFromInputs);
  els.trimEnd.addEventListener('input', updateRegionFromInputs);

  // Trim Action Button
  els.btnExecuteTrim.addEventListener('click', executeTrimAndProcess);
}

// ==========================================================================
// Library Operations
// ==========================================================================

async function fetchLibrary() {
  try {
    const res = await fetch('/api/files');
    if (!res.ok) throw new Error('Failed to retrieve library files');
    const data = await res.json();
    libraryFiles = data;
    
    // Update Badge Counts
    els.countInput.textContent = libraryFiles.input.length;
    els.countOutput.textContent = libraryFiles.output.length;

    renderLibraryList();
  } catch (err) {
    showToast('Error cargando biblioteca: ' + err.message, 'error');
  }
}

function switchLibraryTab(tab) {
  activeFolder = tab;
  if (tab === 'input') {
    els.tabInputBtn.classList.add('active');
    els.tabOutputBtn.classList.remove('active');
  } else {
    els.tabInputBtn.classList.remove('active');
    els.tabOutputBtn.classList.add('active');
  }
  renderLibraryList();
}

function renderLibraryList() {
  const list = libraryFiles[activeFolder];
  const query = els.librarySearch.value.trim().toLowerCase();
  
  els.filesList.innerHTML = '';
  
  const filtered = list.filter(f => f.name.toLowerCase().includes(query));

  if (filtered.length === 0) {
    els.filesList.innerHTML = `
      <div class="empty-placeholder">
        <i class="fa-solid fa-compact-disc"></i>
        <p>${query ? 'No se encontraron archivos' : 'Carpeta vacía'}</p>
      </div>
    `;
    return;
  }

  filtered.forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-item';
    if (currentTrack && currentTrack.name === file.name && currentTrack.folder === file.folder) {
      item.classList.add('active');
    }

    const durationStr = file.duration > 0 ? formatTime(file.duration) : '';
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);

    item.innerHTML = `
      <div class="file-item-info">
        <i class="fa-solid ${file.folder === 'input' ? 'fa-file-audio' : 'fa-wand-magic-sparkles'} file-item-icon"></i>
        <div class="file-item-details">
          <p class="file-item-name" title="${file.name}">${file.name}</p>
          <div class="file-item-sub">
            ${durationStr ? `<span>${durationStr}</span><span>•</span>` : ''}
            <span>${sizeMB} MB</span>
            ${file.has_lrc ? '<span>•</span><i class="fa-solid fa-quote-right tag-lrc-icon" title="Tiene letra sincronizada"></i>' : ''}
          </div>
        </div>
      </div>
      <div class="file-actions">
        <button class="btn-icon btn-file-delete" data-filename="${file.name}" data-folder="${file.folder}" title="Eliminar archivo">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    // Click on item loads track
    item.addEventListener('click', (e) => {
      // Prevent load if click is on delete button
      if (e.target.closest('.btn-file-delete')) return;
      loadTrack(file);
    });

    // Delete track click
    const deleteBtn = item.querySelector('.btn-file-delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete(file.name, file.folder);
    });

    els.filesList.appendChild(item);
  });
}

function handleAudioFileSelected() {
  const file = els.audioFileInput.files[0];
  if (file) {
    els.dropZone.querySelector('.upload-title').textContent = file.name;
    els.dropZone.querySelector('.upload-subtitle').textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    els.uploadSubmitBtn.removeAttribute('disabled');
    
    // Pre-fill Trimmer output file name
    const dotIndex = file.name.lastIndexOf('.');
    const cleanBase = file.name.slice(0, dotIndex).replace(/\s+/g, '_');
    els.trimOutputName.value = cleanBase;
    els.trimOutputExt.textContent = file.name.slice(dotIndex);
  }
}

async function handleUploadSubmit(e) {
  e.preventDefault();
  const file = els.audioFileInput.files[0];
  const lrcFile = els.lrcFileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  if (lrcFile) {
    formData.append('lrc', lrcFile);
  }

  els.uploadSubmitBtn.setAttribute('disabled', 'true');
  els.uploadProgressContainer.style.display = 'block';
  els.uploadProgressFill.style.width = '0%';

  try {
    const xhr = new XMLHttpRequest();
    
    // Track upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        els.uploadProgressFill.style.width = `${percent}%`;
      }
    });

    xhr.addEventListener('load', () => {
      els.uploadProgressContainer.style.display = 'none';
      if (xhr.status >= 200 && xhr.status < 300) {
        showToast('Archivo importado con éxito a la biblioteca', 'success');
        els.uploadForm.reset();
        els.dropZone.querySelector('.upload-title').textContent = 'Arrastra tus archivos de audio aquí';
        els.dropZone.querySelector('.upload-subtitle').textContent = 'o haz clic para explorar';
        els.lrcFilename.textContent = '';
        fetchLibrary();
      } else {
        const res = JSON.parse(xhr.responseText);
        showToast('Error de subida: ' + (res.error || 'Error desconocido'), 'error');
      }
      els.uploadSubmitBtn.removeAttribute('disabled');
    });

    xhr.addEventListener('error', () => {
      els.uploadProgressContainer.style.display = 'none';
      showToast('Error de conexión al subir el archivo.', 'error');
      els.uploadSubmitBtn.removeAttribute('disabled');
    });

    xhr.open('POST', '/api/upload');
    xhr.send(formData);

  } catch (err) {
    els.uploadProgressContainer.style.display = 'none';
    showToast('Error al importar archivo: ' + err.message, 'error');
    els.uploadSubmitBtn.removeAttribute('disabled');
  }
}

async function confirmDelete(filename, folder) {
  if (confirm(`¿Estás seguro de que deseas eliminar "${filename}" de la biblioteca?`)) {
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, folder })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      
      showToast('Archivo eliminado de la biblioteca', 'success');
      
      // If we deleted the active track, stop player and hide studio
      if (currentTrack && currentTrack.name === filename && currentTrack.folder === folder) {
        unloadTrack();
      }
      
      fetchLibrary();
    } catch (err) {
      showToast('Error eliminando archivo: ' + err.message, 'error');
    }
  }
}

// ==========================================================================
// Player Operations & Visualizer
// ==========================================================================

function unloadTrack() {
  if (ws) {
    ws.destroy();
    ws = null;
  }
  currentTrack = null;
  lrcLines = [];
  lrcActiveIndex = -1;
  isVisualizerRunning = false;
  
  els.vinylDisc.classList.remove('playing');
  els.btnPlayPause.innerHTML = '<i class="fa-solid fa-play"></i>';
  els.studioContainer.style.display = 'none';
  els.welcomeScreen.style.display = 'flex';
  
  renderLibraryList();
}

async function loadTrack(file) {
  // If same track click, do play/pause toggle instead
  if (currentTrack && currentTrack.name === file.name && currentTrack.folder === file.folder) {
    togglePlayback();
    return;
  }

  // Set Active visual highlights in sidebar
  currentTrack = file;
  renderLibraryList();

  // Show studio container and hide welcome screen
  els.welcomeScreen.style.display = 'none';
  els.studioContainer.style.display = 'flex';

  // Set Metadata Labels
  els.trackFolderBadge.textContent = file.folder === 'input' ? 'Entrada' : 'Procesado';
  els.trackFolderBadge.className = `track-tag ${file.folder === 'input' ? 'input-badge-clr' : 'output-badge-clr'}`;
  els.currentTrackTitle.textContent = file.name;
  els.metaDuration.textContent = formatTime(file.duration);
  els.metaSize.textContent = `${(file.size / (1024*1024)).toFixed(1)} MB`;
  
  // Clean Lyrics Screen
  els.btnScreenLyrics.style.display = 'none';
  els.lyricsContainer.innerHTML = '<p class="lyrics-placeholder">Cargando letras...</p>';
  els.metaLyricsStatus.innerHTML = '<i class="fa-solid fa-quote-right"></i> Sin letras';
  lrcLines = [];
  lrcActiveIndex = -1;

  // Pre-fill Output Form values for trimmer
  const dotIndex = file.name.lastIndexOf('.');
  const baseName = file.name.slice(0, dotIndex);
  els.trimOutputName.value = baseName;
  els.trimOutputExt.textContent = file.name.slice(dotIndex);

  // Initialize WaveSurfer
  if (ws) {
    ws.destroy();
  }

  els.waveformLoading.style.display = 'flex';

  const audioUrl = `/audio/${file.folder}/${encodeURIComponent(file.name)}`;

  // Create WaveSurfer Instance
  ws = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#4b5563',       // slate-600
    progressColor: '#06b6d4',   // cyan-500
    cursorColor: '#8b5cf6',     // purple-500
    cursorWidth: 2,
    barWidth: 2,
    barGap: 2,
    height: 100,
    responsive: true,
    url: audioUrl,
    plugins: [
      TimelinePlugin.create({
        container: '#wave-timeline',
        insertPosition: 'beforebegin',
        style: {
          color: '#6b7280',
          fontSize: '10px'
        }
      })
    ]
  });

  // Register Regions plugin
  wsRegions = ws.registerPlugin(RegionsPlugin.create());

  // WaveSurfer Audio Ready Event
  ws.on('ready', () => {
    els.waveformLoading.style.display = 'none';
    
    const dur = ws.getDuration();
    els.totalTimeLabel.textContent = formatTime(dur);
    els.currentTimeLabel.textContent = '0:00';
    els.playerProgressFill.style.width = '0%';
    els.playerProgressHandle.style.left = '0%';

    // Trimmer Input Defaults
    els.trimStart.value = '0.00';
    els.trimEnd.value = dur.toFixed(2);

    // Add default region covering the entire song by default
    activeRegion = wsRegions.addRegion({
      start: 0,
      end: dur,
      color: 'rgba(6, 182, 212, 0.15)',
      drag: true,
      resize: true
    });

    updateInputsFromRegion(activeRegion.start, activeRegion.end);

    // Region drag listeners
    activeRegion.on('update', () => {
      updateInputsFromRegion(activeRegion.start, activeRegion.end);
    });

    // Audio Context Visualizer Hook
    const audioEl = ws.getMediaElement();
    audioEl.crossOrigin = "anonymous";
    audioEl.addEventListener('play', () => {
      initVisualizer(audioEl);
    });

    // Check if LRC Lyric file is available
    if (file.has_lrc) {
      loadLyrics(file);
    }
  });

  // Track TimeUpdate
  ws.on('audioprocess', (time) => {
    els.currentTimeLabel.textContent = formatTime(time);
    const percent = (time / ws.getDuration()) * 100;
    els.playerProgressFill.style.width = `${percent}%`;
    els.playerProgressHandle.style.left = `${percent}%`;

    // Synced lyrics tick
    updateLyrics(time);

    // Stop playback if playing selection and reached end of range
    if (isPlayingSelection && activeRegion) {
      if (time >= activeRegion.end || time < activeRegion.start) {
        ws.pause();
        ws.setTime(activeRegion.start);
        isPlayingSelection = false;
        els.btnPlaySelection.innerHTML = '<i class="fa-solid fa-play-circle"></i> Escuchar Selección';
      }
    }
  });

  ws.on('interaction', (time) => {
    const percent = (time / ws.getDuration()) * 100;
    els.playerProgressFill.style.width = `${percent}%`;
    els.playerProgressHandle.style.left = `${percent}%`;
    els.currentTimeLabel.textContent = formatTime(time);
    updateLyrics(time);
  });

  ws.on('finish', () => {
    if (els.btnLoop.classList.contains('active-accent')) {
      ws.play();
    } else {
      els.vinylDisc.classList.remove('playing');
      els.btnPlayPause.innerHTML = '<i class="fa-solid fa-play"></i>';
      playNextTrack(); // Autoplay next track in the folder list
    }
  });
}

async function loadLyrics(file) {
  const lrcUrl = `/audio/${file.folder}/${encodeURIComponent(file.name.slice(0, file.name.lastIndexOf('.')))}.lrc`;
  try {
    const res = await fetch(lrcUrl);
    if (!res.ok) {
      // Check private lyrics
      const resPrivate = await fetch(`/audio/${file.folder}/${encodeURIComponent(file.name.slice(0, file.name.lastIndexOf('.')))}_private.lrc`);
      if (!resPrivate.ok) throw new Error();
      const text = await resPrivate.text();
      processLrcText(text);
      return;
    }
    const text = await res.text();
    processLrcText(text);
  } catch (e) {
    console.warn("Could not load LRC file content", e);
  }
}

function processLrcText(lrcText) {
  lrcLines = parseLRC(lrcText);
  if (lrcLines.length > 0) {
    els.btnScreenLyrics.style.display = 'block';
    els.metaLyricsStatus.innerHTML = '<i class="fa-solid fa-quote-right icon-accent"></i> Sincronizada';
    els.lyricsContainer.innerHTML = '';
    renderLyricsList(-1);
    
    // Automatically switch screen mode to lyrics to showcase the feature
    switchScreenMode('lyrics');
  }
}

function parseLRC(lrcText) {
  const lines = lrcText.split('\n');
  const result = [];
  const timeReg = /\[(\d{2,3}):(\d{2}(?:\.\d+)?)\]/g;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const cleanText = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();

    if (line.startsWith('[') && !line.match(/\[\d+/)) {
      // Skip tags like [ti:Title]
      continue;
    }

    timeReg.lastIndex = 0;
    let match;
    const timestamps = [];
    while ((match = timeReg.exec(line)) !== null) {
      const mins = parseInt(match[1]);
      const secs = parseFloat(match[2]);
      timestamps.push(mins * 60 + secs);
    }

    for (const t of timestamps) {
      result.push({ time: t, text: cleanText });
    }
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

function updateLyrics(currentTime) {
  if (!lrcLines.length) return;

  let activeIndex = -1;
  for (let i = 0; i < lrcLines.length; i++) {
    if (currentTime >= lrcLines[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }

  if (activeIndex !== lrcActiveIndex) {
    lrcActiveIndex = activeIndex;
    renderLyricsList(activeIndex);
  }
}

function renderLyricsList(activeIndex) {
  els.lyricsContainer.innerHTML = '';
  
  if (!lrcLines.length) return;

  lrcLines.forEach((line, index) => {
    const p = document.createElement('p');
    p.className = 'lyric-line' + (index === activeIndex ? ' active' : '');
    p.textContent = line.text || '🎵';
    p.id = `lyric-line-${index}`;
    els.lyricsContainer.appendChild(p);
  });

  const activeEl = document.getElementById(`lyric-line-${activeIndex}`);
  if (activeEl) {
    els.lyricsContainer.scrollTop = activeEl.offsetTop - els.lyricsContainer.clientHeight / 2 + activeEl.clientHeight / 2;
  }
}

function switchScreenMode(mode) {
  if (mode === 'vis') {
    els.btnScreenVis.classList.add('active');
    els.btnScreenLyrics.classList.remove('active');
    els.visCanvas.classList.add('active');
    els.lyricsContainer.classList.remove('active');
  } else {
    els.btnScreenVis.classList.remove('active');
    els.btnScreenLyrics.classList.add('active');
    els.visCanvas.classList.remove('active');
    els.lyricsContainer.classList.add('active');
  }
}

function togglePlayback() {
  if (!ws) return;
  
  if (ws.isPlaying()) {
    ws.pause();
    els.vinylDisc.classList.remove('playing');
    els.btnPlayPause.innerHTML = '<i class="fa-solid fa-play"></i>';
  } else {
    ws.play();
    els.vinylDisc.classList.add('playing');
    els.btnPlayPause.innerHTML = '<i class="fa-solid fa-pause"></i>';
  }
}

function toggleMute() {
  if (!ws) return;
  const muted = !ws.getMuted();
  ws.setMuted(muted);
  
  if (muted) {
    els.btnMute.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    els.btnMute.classList.add('active-accent');
  } else {
    els.btnMute.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    els.btnMute.classList.remove('active-accent');
  }
}

function handleVolumeChange() {
  if (!ws) return;
  const vol = parseFloat(els.volumeSlider.value);
  ws.setVolume(vol);
  if (vol === 0) {
    els.btnMute.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
  } else if (vol < 0.5) {
    els.btnMute.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
  } else {
    els.btnMute.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
  }
}

function toggleLoop() {
  els.btnLoop.classList.toggle('active-accent');
  showToast(els.btnLoop.classList.contains('active-accent') ? 'Bucle activado' : 'Bucle desactivado', 'info');
}

function handleTimelineSeek(e) {
  if (!ws) return;
  const rect = els.progressWrapper.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const percent = Math.min(Math.max(offsetX / rect.width, 0), 1);
  const targetTime = percent * ws.getDuration();
  
  ws.setTime(targetTime);
  els.playerProgressFill.style.width = `${percent * 100}%`;
  els.playerProgressHandle.style.left = `${percent * 100}%`;
  els.currentTimeLabel.textContent = formatTime(targetTime);
  updateLyrics(targetTime);
}

function playPreviousTrack() {
  const currentList = libraryFiles[activeFolder];
  if (!currentList.length || !currentTrack) return;
  
  const curIdx = currentList.findIndex(f => f.name === currentTrack.name);
  let prevIdx = curIdx - 1;
  if (prevIdx < 0) prevIdx = currentList.length - 1; // loop around
  
  loadTrack(currentList[prevIdx]);
}

function playNextTrack() {
  const currentList = libraryFiles[activeFolder];
  if (!currentList.length || !currentTrack) return;
  
  const curIdx = currentList.findIndex(f => f.name === currentTrack.name);
  let nextIdx = curIdx + 1;
  if (nextIdx >= currentList.length) nextIdx = 0; // loop around
  
  loadTrack(currentList[nextIdx]);
}

// Canvas Visualizer Drawing Routine
function initVisualizer(mediaElement) {
  if (isVisualizerRunning) return;
  isVisualizerRunning = true;
  
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    // Only connect source node once
    if (!sourceNode) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      sourceNode = audioCtx.createMediaElementSource(mediaElement);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    
    drawVisualizer();
  } catch (err) {
    console.warn("Could not hook HTMLAudioElement Web Audio: ", err);
  }
}

function drawVisualizer() {
  if (!isVisualizerRunning || !analyser) return;
  requestAnimationFrame(drawVisualizer);
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);
  
  const canvas = els.visCanvas;
  const ctx = canvas.getContext('2d');
  const width = canvas.width = canvas.clientWidth;
  const height = canvas.height = canvas.clientHeight;
  
  ctx.clearRect(0, 0, width, height);
  
  const barWidth = (width / bufferLength) * 1.5;
  let barHeight;
  let x = 0;
  
  // Custom neon purple/cyan design
  for (let i = 0; i < bufferLength; i++) {
    barHeight = dataArray[i];
    
    // Gradient bars color interpolation
    const ratio = barHeight / 255.0;
    const r = Math.round(6 + ratio * 133);
    const g = Math.round(182 - ratio * 90);
    const b = Math.round(212 + ratio * 34);
    
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.15 + ratio * 0.85})`;
    
    // Smooth drawing
    const drawHeight = barHeight * (height / 280);
    ctx.fillRect(x, height - drawHeight, barWidth - 2, drawHeight);
    
    x += barWidth;
  }
}

// ==========================================================================
// Trimmer & DSP Execution logic
// ==========================================================================

function updateInputsFromRegion(start, end) {
  els.trimStart.value = start.toFixed(2);
  els.trimEnd.value = end.toFixed(2);
}

function updateRegionFromInputs() {
  if (!activeRegion || !ws) return;
  
  const dur = ws.getDuration();
  let start = parseFloat(els.trimStart.value) || 0;
  let end = parseFloat(els.trimEnd.value) || dur;

  // Clamping
  if (start < 0) start = 0;
  if (end > dur) end = dur;
  if (start >= end - 0.1) start = end - 0.1;

  els.trimStart.value = start.toFixed(2);
  els.trimEnd.value = end.toFixed(2);

  activeRegion.setOptions({ start, end });
}

function zoomToActiveRegion() {
  if (!ws || !activeRegion) return;
  ws.zoom(30); // zoom in
  const middle = (activeRegion.start + activeRegion.end) / 2;
  const ratio = middle / ws.getDuration();
  // Scroll waveform to selection center
  const container = document.getElementById('waveform');
  container.scrollLeft = (container.scrollWidth * ratio) - (container.clientWidth / 2);
}

function togglePlaySelection() {
  if (!ws || !activeRegion) return;

  if (isPlayingSelection) {
    ws.pause();
    isPlayingSelection = false;
    els.btnPlaySelection.innerHTML = '<i class="fa-solid fa-play-circle"></i> Escuchar Selección';
  } else {
    ws.setTime(activeRegion.start);
    ws.play();
    isPlayingSelection = true;
    els.btnPlaySelection.innerHTML = '<i class="fa-solid fa-stop-circle"></i> Detener Selección';
  }
}

async function executeTrimAndProcess() {
  if (!ws || !currentTrack) return;

  const start = parseFloat(els.trimStart.value);
  const end = parseFloat(els.trimEnd.value);
  const outputBase = els.trimOutputName.value.trim();
  const ext = els.trimOutputExt.textContent;
  const dspModeEl = document.querySelector('input[name="dsp-mode"]:checked');
  const dspMode = dspModeEl ? dspModeEl.value : 'trim_only';

  if (!outputBase) {
    showToast('Por favor introduce un nombre para el archivo recortado', 'error');
    els.trimOutputName.focus();
    return;
  }

  const outputName = outputBase + ext;

  // Visual Processing loading state
  els.btnExecuteTrim.classList.add('processing');
  els.btnExecuteTrim.setAttribute('disabled', 'true');
  els.btnExecuteTrim.innerHTML = '<i class="fa-solid fa-spinner btn-icon-spin"></i> Procesando audio en servidor...';

  try {
    const res = await fetch('/api/trim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: currentTrack.name,
        start,
        end,
        output_name: outputName,
        mode: dspMode
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'DSP execution error');

    // Success response
    showToast(`Recorte procesado con éxito: ${data.filename}`, 'success');
    
    // Show details
    const dbfsText = dspMode !== 'trim_only' 
      ? ` [Sonoridad: ${data.original_dbfs.toFixed(1)} dB -> ${data.final_dbfs.toFixed(1)} dBFS]` 
      : '';
    showToast(`Guardado en carpeta 'output/' con duración de ${data.trimmed_duration.toFixed(2)}s.${dbfsText}`, 'info');

    // Refresh library and switch tab to output to show the new processed file
    await fetchLibrary();
    switchLibraryTab('output');
    
    // Automatically load newly trimmed track
    const newTrack = libraryFiles.output.find(f => f.name === data.filename);
    if (newTrack) {
      loadTrack(newTrack);
    }

  } catch (err) {
    showToast('Error procesando audio: ' + err.message, 'error');
  } finally {
    els.btnExecuteTrim.classList.remove('processing');
    els.btnExecuteTrim.removeAttribute('disabled');
    els.btnExecuteTrim.innerHTML = '<i class="fa-solid fa-scissors btn-icon-spin"></i> Recortar y Guardar Archivo';
  }
}

// ==========================================================================
// Toast Alerts Notification Center
// ==========================================================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;

  els.toastContainer.appendChild(toast);

  // Auto-remove toast after 4s
  setTimeout(() => {
    toast.style.animation = 'toast-slide-in 0.3s reverse forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

// ==========================================================================
// Time formatting utility (seconds to mm:ss)
// ==========================================================================

function formatTime(seconds) {
  if (isNaN(seconds) || seconds === null) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
