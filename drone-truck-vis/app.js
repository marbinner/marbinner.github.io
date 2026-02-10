/**
 * Standalone Solution Editor - Application Logic
 *
 * Adapted from editor.js — replaces all server fetch() calls with
 * local Solver.* calls. Adds instance management and upload screen.
 */

// ============================================================================
// State
// ============================================================================

const state = {
    nCustomers: 0,
    droneLimit: 0,
    droneRangeMds: 0,
    coords: [],
    truckMatrix: [],
    droneMatrix: [],

    // Solution: explicit truck edges and drone flights
    truckEdges: [],
    droneFlights: [],

    // Active drone for creating new flights
    activeDrone: 0,

    // Partial drone flights being constructed (per drone)
    pendingFlights: [{}, {}],

    // Cached solution - for reset functionality
    cachedSolution: null,

    // UI
    hoveredEdge: null,
    hoveredNode: null,
    selectedNode: null,
    drawingFrom: null,
    drawingTo: null,
    drawingMode: null,
    mousePos: { x: 0, y: 0 },

    // History
    history: [],
    historyIndex: -1,

    // Validation
    lastValidation: null,

    // Solutions library (scoped per instance)
    savedSolutions: [],

    // Timing data
    timingData: null,
    flightAnalysis: null,
    customerArrivals: null,

    // Display options
    showArrivalTimes: false,
    showEdgeTimes: false,
    showWaitIndicators: true,
    showConstraintColors: true,

    // Compare mode
    compareMode: false,
    compareSolutionId: null,
    compareData: null,

    // Heatmap mode
    heatmapMode: false,
    heatmapData: null,

    // Animation
    animating: false,
    animTime: 0,
    animSpeed: 1,
    animMaxTime: 0,
    animFrameId: null,
    animLastWall: null,
    animTruckKeyframes: [],
    animDroneFlights: [[], []],

    // Instance management
    instances: {},            // keyed by name, stores raw text
    currentInstanceName: null,
    problemData: null,        // parsed problem data for current instance
};

// Canvas
let canvas, ctx;
let canvasWidth, canvasHeight;
let scale = 1, baseScale = 1, zoomLevel = 1;
let offsetX = 0, offsetY = 0;
let panOffset = { x: 0, y: 0 };
let isPanning = false, panStart = { x: 0, y: 0 };
let justDragged = false;

// Constants
const NODE_RADIUS = 20;
const DEPOT_RADIUS = 24;
const EDGE_HIT_DIST = 15;
const COLORS = {
    bg: '#0d1117',
    depot: '#f85149',
    truck: '#58a6ff',
    drone0: '#3fb950',
    drone1: '#a371f7',
    drone0Return: '#2ea043',
    drone1Return: '#8957e5',
    unassigned: '#484f58',
    pending: '#ffd33d',
    route: '#58a6ff',
    routeHover: '#ff6b6b',
    drawing: '#ffd33d'
};

const INSTANCES_STORAGE_KEY = 'potatosolver_standalone_instances';
const SOLUTIONS_STORAGE_KEY = 'potatosolver_standalone_solutions';
const WORKING_SOLUTION_KEY = 'potatosolver_standalone_working';

// ============================================================================
// Init
// ============================================================================

function init() {
    canvas = document.getElementById('mainCanvas');
    if (!canvas) return; // Editor not visible yet
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    setupEvents();

    // Load instances from localStorage
    loadInstancesFromStorage();

    if (Object.keys(state.instances).length > 0) {
        // Load the first (or last-used) instance
        const names = Object.keys(state.instances);
        const lastName = localStorage.getItem('potatosolver_standalone_lastInstance');
        const name = (lastName && state.instances[lastName]) ? lastName : names[0];
        switchInstance(name);
        showEditorScreen();
    } else {
        showUploadScreen();
    }
}

function resizeCanvas() {
    const c = document.getElementById('canvas-container');
    if (!c) return;
    canvasWidth = c.clientWidth;
    canvasHeight = c.clientHeight;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    if (state.coords.length) { calcView(); render(); }
}

function calcView(reset = false) {
    if (!state.coords.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of state.coords) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }

    const pad = 80;
    baseScale = Math.min((canvasWidth - 2*pad) / (maxX - minX || 1), (canvasHeight - 2*pad) / (maxY - minY || 1));

    if (reset) { zoomLevel = 1; panOffset = { x: 0, y: 0 }; }
    scale = baseScale * zoomLevel;

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    offsetX = canvasWidth / 2 - cx * scale + panOffset.x;
    offsetY = canvasHeight / 2 - cy * scale + panOffset.y;
}

// ============================================================================
// Upload Screen
// ============================================================================

function showUploadScreen() {
    document.getElementById('upload-screen').style.display = 'flex';
    document.getElementById('editor-container').style.display = 'none';
    populateExistingInstances();
    setupUploadHandlers();
}

function showEditorScreen() {
    document.getElementById('upload-screen').style.display = 'none';
    document.getElementById('editor-container').style.display = 'flex';

    // Make sure canvas is initialized
    if (!canvas) {
        canvas = document.getElementById('mainCanvas');
        ctx = canvas.getContext('2d');
        resizeCanvas();
        setupEvents();
    } else {
        resizeCanvas();
    }
}

let _uploadHandlersSetup = false;
function setupUploadHandlers() {
    if (_uploadHandlersSetup) return;
    _uploadHandlersSetup = true;

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('instance-file-input');
    const pasteArea = document.getElementById('instance-paste-area');
    const nameInput = document.getElementById('instance-name-input');
    const loadBtn = document.getElementById('btn-load-instance');

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleInstanceFile(files[0], nameInput);
        }
    });

    // File picker
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleInstanceFile(e.target.files[0], nameInput);
        }
    });

    // Load from paste
    loadBtn.addEventListener('click', () => {
        const text = pasteArea.value.trim();
        if (!text) {
            showUploadError('Please paste instance text or upload a file.');
            return;
        }
        const name = nameInput.value.trim() || `Instance ${Object.keys(state.instances).length + 1}`;
        loadInstanceFromText(name, text);
    });
}

function handleInstanceFile(file, nameInput) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const name = nameInput?.value?.trim() || file.name.replace(/\.txt$/, '');
        loadInstanceFromText(name, text);
    };
    reader.readAsText(file);
}

function showUploadError(msg) {
    const el = document.getElementById('upload-error');
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function populateExistingInstances() {
    const section = document.getElementById('existing-instances-section');
    const list = document.getElementById('existing-instances-list');
    const names = Object.keys(state.instances);
    if (names.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    list.innerHTML = names.map(name => {
        let info = '';
        try {
            const pd = Solver.parseProblemText(state.instances[name]);
            info = `${pd.nCustomers} customers`;
        } catch (e) { info = 'invalid'; }
        return `<div class="existing-instance-item" onclick="loadExistingInstance('${escapeHtml(name)}')">
            <span class="existing-instance-name">${escapeHtml(name)}</span>
            <span class="existing-instance-info">${info}</span>
        </div>`;
    }).join('');
}

function loadExistingInstance(name) {
    showEditorScreen();
    switchInstance(name);
}

// ============================================================================
// Instance Management
// ============================================================================

function loadInstanceFromText(name, text) {
    try {
        // Validate the text parses correctly
        const pd = Solver.parseProblemText(text);
        if (!pd.nCustomers || pd.nCustomers < 1) {
            throw new Error('Invalid problem: no customers found');
        }

        state.instances[name] = text;
        persistInstances();
        showEditorScreen();
        switchInstance(name);
    } catch (e) {
        showUploadError('Failed to parse instance: ' + e.message);
    }
}

function switchInstance(name) {
    if (!state.instances[name]) return;

    const text = state.instances[name];
    const pd = Solver.parseProblemText(text);

    // Compute MDS
    const coords = Solver.classicalMDS(pd.truckMatrix);
    const droneRangeMds = Solver.computeDroneRangeMds(coords, pd.droneMatrix, pd.droneLimit);

    // Update state
    state.currentInstanceName = name;
    state.problemData = pd;
    state.nCustomers = pd.nCustomers;
    state.droneLimit = pd.droneLimit;
    state.droneRangeMds = droneRangeMds;
    state.coords = coords;
    state.truckMatrix = pd.truckMatrix;
    state.droneMatrix = pd.droneMatrix;

    // Reset solution state
    state.truckEdges = [];
    state.droneFlights = [];
    state.pendingFlights = [{}, {}];
    state.cachedSolution = null;
    state.history = [];
    state.historyIndex = -1;
    state.lastValidation = null;
    state.timingData = null;
    state.flightAnalysis = null;
    state.customerArrivals = null;
    state.compareMode = false;
    state.compareData = null;
    state.heatmapMode = false;
    state.heatmapData = null;
    if (state.animating) stopAnimation();
    state.animTime = 0;

    // Load solutions for this instance
    loadSolutionsLibrary();

    // Update instance selector
    updateInstanceSelector();

    // Store last used instance
    localStorage.setItem('potatosolver_standalone_lastInstance', name);

    // Reset view
    calcView(true);
    resetToTruckOnly();

    // Restore working solution if one exists for this instance
    try {
        const raw = localStorage.getItem(WORKING_SOLUTION_KEY);
        if (raw) {
            const saved = JSON.parse(raw);
            if (saved.instanceName === name && saved.solution_str) {
                loadSolution(saved.solution_str);
            }
        }
    } catch (e) { /* ignore */ }

    render();
}

function deleteInstance(name) {
    if (!confirm(`Delete instance "${name}" and all its solutions?`)) return;
    delete state.instances[name];
    persistInstances();

    // Also delete solutions for this instance
    const allSolutions = loadAllSolutions();
    const filtered = allSolutions.filter(s => s.instanceName !== name);
    localStorage.setItem(SOLUTIONS_STORAGE_KEY, JSON.stringify(filtered));

    if (state.currentInstanceName === name) {
        state.currentInstanceName = null;
        const remaining = Object.keys(state.instances);
        if (remaining.length > 0) {
            switchInstance(remaining[0]);
        } else {
            showUploadScreen();
        }
    }
    updateInstanceSelector();
}

function updateInstanceSelector() {
    const sel = document.getElementById('instance-selector');
    if (!sel) return;
    sel.innerHTML = '';
    for (const name of Object.keys(state.instances)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === state.currentInstanceName) opt.selected = true;
        sel.appendChild(opt);
    }
}

function loadInstancesFromStorage() {
    try {
        const raw = localStorage.getItem(INSTANCES_STORAGE_KEY);
        state.instances = raw ? JSON.parse(raw) : {};
    } catch (e) {
        state.instances = {};
    }
}

function persistInstances() {
    localStorage.setItem(INSTANCES_STORAGE_KEY, JSON.stringify(state.instances));
}

// ============================================================================
// Solution Management
// ============================================================================

function resetToTruckOnly() {
    state.truckEdges = [];
    let prev = 0;
    for (let i = 1; i <= state.nCustomers; i++) {
        state.truckEdges.push({ from: prev, to: i });
        prev = i;
    }
    state.truckEdges.push({ from: prev, to: 0 });
    state.droneFlights = [];
    state.pendingFlights = [{}, {}];
    saveHistory();
    validate();
}

function getNodeType(id) {
    if (id === 0) return 'depot';
    if (state.truckEdges.some(e => e.from === id || e.to === id)) return 'truck';
    if (state.droneFlights.some(f => f.customer === id)) return 'drone';
    for (let d = 0; d < 2; d++) {
        if (state.pendingFlights[d][id]) return 'pending';
    }
    return 'unassigned';
}

function getNodeDroneId(id) {
    const flight = state.droneFlights.find(f => f.customer === id);
    if (flight) return flight.drone_id;
    for (let d = 0; d < 2; d++) {
        if (state.pendingFlights[d][id]) return d;
    }
    return null;
}

function buildRouteFromEdges() {
    const route = [0];
    const visited = new Set([0]);
    let current = 0;

    while (true) {
        const depotEdge = state.truckEdges.find(e => e.from === current && e.to === 0);
        if (depotEdge && route.length > 1) {
            route.push(0);
            break;
        }
        const nextEdge = state.truckEdges.find(e => e.from === current && !visited.has(e.to) && e.to !== 0);
        if (!nextEdge) {
            if (depotEdge) route.push(0);
            break;
        }
        route.push(nextEdge.to);
        visited.add(nextEdge.to);
        current = nextEdge.to;
    }
    return route;
}

function buildSolutionString() {
    const route = buildRouteFromEdges();
    const truckStr = route.join(',');

    const flightsWithPos = state.droneFlights.map(f => {
        let launchPos = route.indexOf(f.launch_node);
        let landPos = f.land_node === 0 ? route.length - 1 : route.indexOf(f.land_node);
        return { ...f, launch_pos: launchPos, land_pos: landPos };
    }).filter(f => f.launch_pos >= 0 && f.land_pos >= 0);

    const d0 = flightsWithPos.filter(f => f.drone_id === 0).sort((a, b) => a.launch_pos - b.launch_pos);
    const d1 = flightsWithPos.filter(f => f.drone_id === 1).sort((a, b) => a.launch_pos - b.launch_pos);

    const custs = [], lnch = [], land = [];
    for (const f of d0) { custs.push(f.customer); lnch.push(f.launch_pos + 1); land.push(f.land_pos + 1); }
    custs.push(-1); lnch.push(-1); land.push(-1);
    for (const f of d1) { custs.push(f.customer); lnch.push(f.launch_pos + 1); land.push(f.land_pos + 1); }

    return `${truckStr}|${custs.join(',')}|${lnch.join(',')}|${land.join(',')}`;
}

function parseSolutionString(str) {
    const parts = str.trim().split('|');
    if (parts.length !== 4) throw new Error('Invalid format');

    const parse = s => s.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
    const truckRoute = parse(parts[0]);

    const truckEdges = [];
    for (let i = 0; i < truckRoute.length - 1; i++) {
        truckEdges.push({ from: truckRoute[i], to: truckRoute[i + 1] });
    }

    const dCusts = parts[1].split(',').map(x => parseInt(x.trim()));
    const dLnch = parts[2].split(',').map(x => parseInt(x.trim()));
    const dLand = parts[3].split(',').map(x => parseInt(x.trim()));

    const droneFlights = [];
    let droneId = 0;
    for (let i = 0; i < dCusts.length; i++) {
        if (dCusts[i] === -1) { droneId++; continue; }
        const launchPos = dLnch[i] - 1;
        const landPos = dLand[i] - 1;
        droneFlights.push({
            customer: dCusts[i],
            launch_node: truckRoute[launchPos] ?? 0,
            land_node: truckRoute[landPos] ?? 0,
            drone_id: droneId
        });
    }
    return { truckEdges, droneFlights };
}

function loadSolution(str) {
    try {
        if (state.animating) stopAnimation();
        state.animTime = 0;
        const { truckEdges, droneFlights } = parseSolutionString(str);
        state.truckEdges = truckEdges;
        state.droneFlights = droneFlights;
        state.pendingFlights = [{}, {}];

        state.cachedSolution = {
            truckEdges: truckEdges.map(e => ({...e})),
            droneFlights: droneFlights.map(f => ({...f})),
            originalString: str
        };

        saveHistory();
        validate();
        render();
        updateResetButton();
    } catch (e) { alert('Parse error: ' + e.message); }
}

function resetToCached() {
    if (!state.cachedSolution) {
        resetToTruckOnly();
        return;
    }
    state.truckEdges = state.cachedSolution.truckEdges.map(e => ({...e}));
    state.droneFlights = state.cachedSolution.droneFlights.map(f => ({...f}));
    state.pendingFlights = [{}, {}];
    saveHistory();
    validate();
    render();
}

function updateResetButton() {
    const btn = document.getElementById('btn-reset');
    if (!btn) return;
    if (state.cachedSolution) {
        btn.textContent = 'Reset to Loaded';
        btn.title = 'Reset to the last loaded solution';
    } else {
        btn.textContent = 'Reset (Truck Only)';
        btn.title = 'Reset to truck-only solution';
    }
}

let _validateTimer = null;
function validate() {
    clearTimeout(_validateTimer);
    _validateTimer = setTimeout(_doValidate, 100);
}

function _doValidate() {
    if (!state.problemData) return;

    const str = buildSolutionString();

    // All computation is synchronous now
    state.lastValidation = Solver.validateSolution(str, state.problemData);
    const timingResult = Solver.computeTiming(str, state.problemData);

    if (!timingResult.error) {
        state.timingData = timingResult.timeline || [];
        state.flightAnalysis = timingResult.flight_analysis || {};
        state.customerArrivals = timingResult.customer_arrivals || {};
    }

    updateStats();
    renderSolutionsList();
    render();
    if (state.compareMode) fetchCompareData();
    persistWorkingSolution();
}

function persistWorkingSolution() {
    if (!state.currentInstanceName) return;
    try {
        const str = buildSolutionString();
        localStorage.setItem(WORKING_SOLUTION_KEY, JSON.stringify({
            instanceName: state.currentInstanceName,
            solution_str: str,
        }));
    } catch (e) { /* ignore quota errors */ }
}

function updateStats() {
    const v = state.lastValidation || {};
    document.getElementById('objective-value').textContent = v.objective != null ? Math.round(v.objective) : '\u2014';

    const feasEl = document.getElementById('feasibility-value');
    if (v.feasible === true) { feasEl.textContent = '\u2713'; feasEl.className = 'stat-value feasible'; }
    else if (v.feasible === false) { feasEl.textContent = '\u2717'; feasEl.className = 'stat-value infeasible'; }
    else { feasEl.textContent = '?'; feasEl.className = 'stat-value'; }

    const truckNodes = new Set();
    for (const e of state.truckEdges) {
        if (e.from !== 0) truckNodes.add(e.from);
        if (e.to !== 0) truckNodes.add(e.to);
    }
    const truckN = truckNodes.size;
    const droneN = state.droneFlights.length;
    const d0Flights = state.droneFlights.filter(f => f.drone_id === 0).length;
    const d1Flights = state.droneFlights.filter(f => f.drone_id === 1).length;
    const pending0 = Object.keys(state.pendingFlights[0]).length;
    const pending1 = Object.keys(state.pendingFlights[1]).length;

    document.getElementById('truck-count').textContent = truckN;
    document.getElementById('drone-count').textContent = droneN;
    document.getElementById('unassigned-count').textContent = state.nCustomers - truckN - droneN;
    document.getElementById('flight-usage').textContent = (pending0 + pending1) > 0 ? `${pending0 + pending1} pending` : '\u2014';

    document.getElementById('drone0-flights').textContent = `D0: ${d0Flights} flights` + (pending0 ? ` (+${pending0})` : '');
    document.getElementById('drone1-flights').textContent = `D1: ${d1Flights} flights` + (pending1 ? ` (+${pending1})` : '');

    document.getElementById('solution-input').value = buildSolutionString();
}

// ============================================================================
// History
// ============================================================================

function saveHistory() {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push({
        truckEdges: state.truckEdges.map(e => ({...e})),
        droneFlights: state.droneFlights.map(f => ({...f})),
        pendingFlights: [
            JSON.parse(JSON.stringify(state.pendingFlights[0])),
            JSON.parse(JSON.stringify(state.pendingFlights[1]))
        ]
    });
    if (state.history.length > 50) state.history.shift();
    state.historyIndex = state.history.length - 1;
    updateHistoryBtns();
}

function undo() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        restore();
    }
}

function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        restore();
    }
}

function restore() {
    const s = state.history[state.historyIndex];
    state.truckEdges = s.truckEdges.map(e => ({...e}));
    state.droneFlights = s.droneFlights.map(f => ({...f}));
    state.pendingFlights = [
        JSON.parse(JSON.stringify(s.pendingFlights[0])),
        JSON.parse(JSON.stringify(s.pendingFlights[1]))
    ];
    updateHistoryBtns();
    validate();
    render();
}

function updateHistoryBtns() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = state.historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
    const histInfo = document.getElementById('history-info');
    if (histInfo) histInfo.textContent = `${state.historyIndex + 1}/${state.history.length}`;
}

// ============================================================================
// Edge Operations
// ============================================================================

function removeNodeFromTruckRoute(node) {
    if (node === 0) return;
    state.truckEdges = state.truckEdges.filter(e => e.from !== node && e.to !== node);
    saveHistory();
    validate();
    render();
}

function removeTruckEdge(from, to) {
    const idx = state.truckEdges.findIndex(e => e.from === from && e.to === to);
    if (idx >= 0) {
        state.truckEdges.splice(idx, 1);
        saveHistory();
        validate();
        render();
    }
}

function deleteDroneFlight(customer) {
    const idx = state.droneFlights.findIndex(f => f.customer === customer);
    if (idx >= 0) {
        const flight = state.droneFlights[idx];
        if (flight.drone_id !== state.activeDrone) selectDrone(flight.drone_id);
        state.droneFlights.splice(idx, 1);
        saveHistory();
        validate();
        render();
    }
}

function deletePendingDrone(customer) {
    for (let d = 0; d < 2; d++) {
        if (state.pendingFlights[d][customer]) {
            if (d !== state.activeDrone) selectDrone(d);
            delete state.pendingFlights[d][customer];
        }
    }
    render();
    updateStats();
}

function addTruckEdge(fromNode, toNode) {
    if (fromNode === toNode) return;
    if (state.truckEdges.some(e => e.from === fromNode && e.to === toNode)) return;

    const droneIdx = state.droneFlights.findIndex(f => f.customer === toNode);
    if (droneIdx >= 0) state.droneFlights.splice(droneIdx, 1);

    for (let d = 0; d < 2; d++) delete state.pendingFlights[d][toNode];

    state.truckEdges.push({ from: fromNode, to: toNode });
    saveHistory();
    validate();
    render();
}

function addDroneEdge(fromNode, toNode) {
    const droneId = state.activeDrone;
    const fromType = getNodeType(fromNode);
    const toType = getNodeType(toNode);

    if ((fromType === 'truck' || fromType === 'depot') && toNode !== 0 && toNode !== fromNode) {
        const customer = toNode;
        const pending = state.pendingFlights[droneId][customer] || {};
        pending.launch_node = fromNode;
        state.pendingFlights[droneId][customer] = pending;
        if (pending.land_node !== undefined) {
            tryCompleteFlight(customer, droneId);
        } else {
            render();
            updateStats();
        }
        return;
    }

    if (fromNode !== 0 && (toType === 'truck' || toType === 'depot') && toNode !== fromNode) {
        const customer = fromNode;
        const pending = state.pendingFlights[droneId][customer] || {};
        pending.land_node = toNode;
        state.pendingFlights[droneId][customer] = pending;
        if (pending.launch_node !== undefined) {
            tryCompleteFlight(customer, droneId);
        } else {
            render();
            updateStats();
        }
        return;
    }
}

function tryCompleteFlight(customer, droneId) {
    const pending = state.pendingFlights[droneId][customer];
    if (!pending || pending.launch_node === undefined || pending.land_node === undefined) return;

    const launchNode = pending.launch_node;
    const landNode = pending.land_node;
    const route = buildRouteFromEdges();
    const launchPos = route.indexOf(launchNode);
    const landPos = landNode === 0 ? route.length - 1 : route.indexOf(landNode);

    if (launchPos < 0 || landPos < 0) {
        alert('Launch or land node not in truck route');
        delete state.pendingFlights[droneId][customer];
        render(); updateStats();
        return;
    }

    if (landPos <= launchPos) {
        alert(`Landing position (${landPos + 1}) must be after launch position (${launchPos + 1})`);
        delete state.pendingFlights[droneId][customer];
        render(); updateStats();
        return;
    }

    const flightTime = state.droneMatrix[launchNode][customer] + state.droneMatrix[customer][landNode];
    if (flightTime > state.droneLimit) {
        alert(`Flight time ${Math.round(flightTime)} exceeds limit ${state.droneLimit}`);
        delete state.pendingFlights[droneId][customer];
        render(); updateStats();
        return;
    }

    state.truckEdges = state.truckEdges.filter(e => e.from !== customer && e.to !== customer);
    for (let d = 0; d < 2; d++) delete state.pendingFlights[d][customer];

    const existingIdx = state.droneFlights.findIndex(f => f.customer === customer);
    if (existingIdx >= 0) state.droneFlights.splice(existingIdx, 1);

    state.droneFlights.push({ customer, launch_node: launchNode, land_node: landNode, drone_id: droneId });
    saveHistory();
    validate();
    render();
}

// ============================================================================
// Coordinate Transforms
// ============================================================================

function toScreen(x, y) {
    return [x * scale + offsetX, canvasHeight - (y * scale + offsetY)];
}

function toWorld(sx, sy) {
    return [(sx - offsetX) / scale, (canvasHeight - sy - offsetY) / scale];
}

// ============================================================================
// Hit Testing
// ============================================================================

function findNodeAt(sx, sy) {
    const [dx, dy] = toScreen(...state.coords[0]);
    if (Math.hypot(sx - dx, sy - dy) < DEPOT_RADIUS) return 0;

    for (let i = 1; i <= state.nCustomers; i++) {
        const [nx, ny] = toScreen(...state.coords[i]);
        if (Math.hypot(sx - nx, sy - ny) < NODE_RADIUS) return i;
    }
    return null;
}

function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1)*dx + (py - y1)*dy) / len2));
    return Math.hypot(px - (x1 + t*dx), py - (y1 + t*dy));
}

function findEdgeAt(sx, sy) {
    for (const edge of state.truckEdges) {
        const [x1, y1] = toScreen(...state.coords[edge.from]);
        const [x2, y2] = toScreen(...state.coords[edge.to]);
        if (distToSeg(sx, sy, x1, y1, x2, y2) < EDGE_HIT_DIST) {
            return { type: 'truck', from: edge.from, to: edge.to };
        }
    }

    for (const f of state.droneFlights) {
        const launch = f.launch_node;
        const land = f.land_node;
        const [lx, ly] = toScreen(...state.coords[launch]);
        const [cx, cy] = toScreen(...state.coords[f.customer]);
        const [rx, ry] = toScreen(...state.coords[land]);

        if (distToSeg(sx, sy, lx, ly, cx, cy) < EDGE_HIT_DIST) return { type: 'drone', customer: f.customer };
        if (distToSeg(sx, sy, cx, cy, rx, ry) < EDGE_HIT_DIST) return { type: 'drone', customer: f.customer };
    }

    for (let droneId = 0; droneId < 2; droneId++) {
        for (const [cust, p] of Object.entries(state.pendingFlights[droneId])) {
            const custId = parseInt(cust);
            const [cx, cy] = toScreen(...state.coords[custId]);

            if (p.launch_node !== undefined) {
                const [lx, ly] = toScreen(...state.coords[p.launch_node]);
                if (distToSeg(sx, sy, lx, ly, cx, cy) < EDGE_HIT_DIST) return { type: 'pending', customer: custId };
            }
            if (p.land_node !== undefined) {
                const [rx, ry] = toScreen(...state.coords[p.land_node]);
                if (distToSeg(sx, sy, cx, cy, rx, ry) < EDGE_HIT_DIST) return { type: 'pending', customer: custId };
            }
        }
    }
    return null;
}

// ============================================================================
// Rendering
// ============================================================================

function render() {
    if (!ctx) return;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (!state.coords.length) return;

    drawDroneRange();
    drawTruckRoute();
    drawDroneFlights();
    drawPendingDrones();
    drawDrawingLine();
    drawHeatmapOverlay();
    drawNodes();
    drawDroneLabels();
    drawCompareOverlay();

    if (state.showArrivalTimes) drawArrivalTimes();
    if (state.animating || state.animTime > 0) drawAnimationOverlay();
}

function drawDroneRange() {
    const [cx, cy] = toScreen(0, 0);
    const radius = Math.abs(state.droneRangeMds * scale);
    if (radius <= 0 || !isFinite(radius)) return;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(240,136,62,0.15)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawTruckRoute() {
    for (let i = 0; i < state.truckEdges.length; i++) {
        const edge = state.truckEdges[i];
        const [x1, y1] = toScreen(...state.coords[edge.from]);
        const [x2, y2] = toScreen(...state.coords[edge.to]);

        const hovered = state.hoveredEdge?.type === 'truck' &&
                        state.hoveredEdge.from === edge.from &&
                        state.hoveredEdge.to === edge.to;

        ctx.strokeStyle = hovered ? COLORS.routeHover : COLORS.route;
        ctx.lineWidth = hovered ? 5 : 3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.fillStyle = hovered ? COLORS.routeHover : COLORS.route;
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-3, 4);
        ctx.lineTo(-3, -4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        if (state.showEdgeTimes && state.truckMatrix.length > 0) {
            const time = state.truckMatrix[edge.from][edge.to];
            ctx.font = '8px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const perpX = -(y2 - y1) / Math.hypot(x2 - x1, y2 - y1) * 12;
            const perpY = (x2 - x1) / Math.hypot(x2 - x1, y2 - y1) * 12;
            ctx.fillStyle = 'rgba(88, 166, 255, 0.8)';
            ctx.fillText(Math.round(time).toString(), mx + perpX, my + perpY);
        }
    }
}

function drawDroneFlights() {
    for (const f of state.droneFlights) {
        const launch = f.launch_node;
        const land = f.land_node;
        if (launch === undefined || land === undefined) continue;

        const [lx, ly] = toScreen(...state.coords[launch]);
        const [cx, cy] = toScreen(...state.coords[f.customer]);
        const [rx, ry] = toScreen(...state.coords[land]);

        const hovered = state.hoveredEdge?.type === 'drone' && state.hoveredEdge.customer === f.customer;

        const flightInfo = state.flightAnalysis?.[f.customer];
        const utilization = flightInfo?.utilization_percent || 0;
        const constraintColor = state.showConstraintColors ? getFlightColor(utilization) : null;

        let color = constraintColor || (f.drone_id === 0 ? COLORS.drone0 : COLORS.drone1);
        let returnColor = constraintColor || (f.drone_id === 0 ? COLORS.drone0Return : COLORS.drone1Return);

        ctx.setLineDash([6, 3]);
        ctx.lineWidth = hovered ? 4 : (constraintColor ? 3.5 : 2.5);

        ctx.strokeStyle = hovered ? COLORS.routeHover : color;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        const dmx = (lx + cx) / 2, dmy = (ly + cy) / 2;
        const dang = Math.atan2(cy - ly, cx - lx);
        ctx.save();
        ctx.translate(dmx, dmy);
        ctx.rotate(dang);
        ctx.fillStyle = hovered ? COLORS.routeHover : color;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(-3, 3);
        ctx.lineTo(-3, -3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.setLineDash([6, 3]);
        ctx.strokeStyle = hovered ? COLORS.routeHover : returnColor;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(rx, ry);
        ctx.stroke();

        const rmx = (cx + rx) / 2, rmy = (cy + ry) / 2;
        const rang = Math.atan2(ry - cy, rx - cx);
        ctx.save();
        ctx.translate(rmx, rmy);
        ctx.rotate(rang);
        ctx.fillStyle = hovered ? COLORS.routeHover : returnColor;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(-3, 3);
        ctx.lineTo(-3, -3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.setLineDash([]);

        if (state.showConstraintColors && utilization > 80) {
            ctx.font = 'bold 10px system-ui';
            ctx.fillStyle = getFlightColor(utilization);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('!', cx + NODE_RADIUS + 4, cy - NODE_RADIUS - 4);
        }
    }
}

function drawPendingDrones() {
    ctx.lineWidth = 2;

    for (let droneId = 0; droneId < 2; droneId++) {
        const color = droneId === 0 ? COLORS.drone0 : COLORS.drone1;

        for (const [cust, p] of Object.entries(state.pendingFlights[droneId])) {
            const custId = parseInt(cust);
            const [cx, cy] = toScreen(...state.coords[custId]);

            const hovered = state.hoveredEdge?.type === 'pending' && state.hoveredEdge.customer === custId;
            ctx.strokeStyle = hovered ? COLORS.routeHover : COLORS.pending;
            ctx.setLineDash([4, 4]);

            if (p.launch_node !== undefined) {
                const [lx, ly] = toScreen(...state.coords[p.launch_node]);
                ctx.beginPath();
                ctx.moveTo(lx, ly);
                ctx.lineTo(cx, cy);
                ctx.stroke();

                ctx.setLineDash([]);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc((lx + cx) / 2, (ly + cy) / 2, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 8px system-ui';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(droneId.toString(), (lx + cx) / 2, (ly + cy) / 2);
            }
            if (p.land_node !== undefined) {
                ctx.setLineDash([4, 4]);
                const [rx, ry] = toScreen(...state.coords[p.land_node]);
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(rx, ry);
                ctx.stroke();

                ctx.setLineDash([]);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc((cx + rx) / 2, (cy + ry) / 2, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 8px system-ui';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(droneId.toString(), (cx + rx) / 2, (cy + ry) / 2);
            }
        }
    }
    ctx.setLineDash([]);
}

function drawDrawingLine() {
    if (state.drawingFrom === null) return;

    const [x1, y1] = toScreen(...state.coords[state.drawingFrom]);
    const color = state.drawingMode === 'truck' ? COLORS.route : (state.activeDrone === 0 ? COLORS.drone0 : COLORS.drone1);

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(state.mousePos.x, state.mousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (state.drawingTo !== null) {
        const [tx, ty] = toScreen(...state.coords[state.drawingTo]);
        ctx.beginPath();
        ctx.arc(tx, ty, NODE_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

function drawNodes() {
    for (let i = 1; i <= state.nCustomers; i++) {
        const t = getNodeType(i);
        if (t === 'unassigned') drawNode(i);
    }
    for (let i = 1; i <= state.nCustomers; i++) {
        if (getNodeType(i) === 'pending') drawNode(i);
    }
    const truckNodes = new Set();
    for (const e of state.truckEdges) {
        if (e.from !== 0) truckNodes.add(e.from);
        if (e.to !== 0) truckNodes.add(e.to);
    }
    for (const id of truckNodes) drawNode(id);
    for (const f of state.droneFlights) drawNode(f.customer, f);
    drawNode(0);
}

function drawNode(id, flight = null) {
    const [x, y] = toScreen(...state.coords[id]);
    const type = getNodeType(id);

    let r = NODE_RADIUS, color = COLORS.unassigned, shape = 'circle';

    if (id === 0) {
        r = DEPOT_RADIUS; color = COLORS.depot; shape = 'square';
    } else if (type === 'truck') {
        color = COLORS.truck;
    } else if (type === 'drone') {
        const droneId = flight?.drone_id ?? getNodeDroneId(id);
        color = droneId === 1 ? COLORS.drone1 : COLORS.drone0;
        shape = 'triangle';
    } else if (type === 'pending') {
        color = COLORS.pending; shape = 'triangle';
    }

    const timingEntry = state.timingData?.find(t => t.node === id);
    const hasTruckWait = timingEntry?.truck_wait_time > 0;
    const hasDroneHover = (timingEntry?.drone0_hover_time > 0) || (timingEntry?.drone1_hover_time > 0);

    const isSelected = state.selectedNode === id;
    const isHovered = state.hoveredNode === id;

    if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? '#58a6ff' : 'rgba(88, 166, 255, 0.5)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    ctx.beginPath();
    if (shape === 'square') {
        ctx.rect(x - r, y - r, r * 2, r * 2);
    } else if (shape === 'triangle') {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x - r, y + r * 0.7);
        ctx.lineTo(x + r, y + r * 0.7);
        ctx.closePath();
    } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = (shape === 'triangle' && color !== COLORS.pending) ? '#fff' : (shape === 'triangle' ? '#000' : '#fff');
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(id === 0 ? 'D' : id.toString(), x, shape === 'triangle' ? y + 2 : y);

    if (state.showWaitIndicators) {
        if (hasTruckWait && type === 'truck') {
            drawWaitIndicator(x + r + 2, y - r - 2, timingEntry.truck_wait_time, '#f85149');
        }
        if (hasDroneHover) {
            const hoverTime = Math.max(timingEntry.drone0_hover_time || 0, timingEntry.drone1_hover_time || 0);
            drawWaitIndicator(x - r - 12, y - r - 2, hoverTime, '#ffd33d');
        }
    }
}

function drawWaitIndicator(x, y, time, color) {
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 7px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(time.toFixed(0), x, y);
}

function drawDroneLabels() {
    ctx.font = 'bold 9px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const f of state.droneFlights) {
        const [cx, cy] = toScreen(...state.coords[f.customer]);
        const color = f.drone_id === 0 ? COLORS.drone0 : COLORS.drone1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx + NODE_RADIUS + 8, cy - NODE_RADIUS/2, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(f.drone_id.toString(), cx + NODE_RADIUS + 5, cy - NODE_RADIUS/2);
    }
}

function drawArrivalTimes() {
    if (!state.customerArrivals) return;
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const [node, info] of Object.entries(state.customerArrivals)) {
        const nodeId = parseInt(node);
        if (nodeId === 0) continue;
        const [x, y] = toScreen(...state.coords[nodeId]);
        const time = Math.round(info.arrival_time);
        ctx.fillStyle = 'rgba(139, 148, 158, 0.9)';
        ctx.fillText(time.toString(), x, y + NODE_RADIUS + 4);
    }
}

// ============================================================================
// Compare & Heatmap
// ============================================================================

function fetchCompareData() {
    if (!state.compareMode || state.compareSolutionId == null) {
        state.compareData = null;
        render();
        return;
    }
    const sol = state.savedSolutions.find(s => s.id === state.compareSolutionId);
    if (!sol) { state.compareData = null; render(); return; }

    state.compareData = Solver.compareSolutions(
        buildSolutionString(),
        sol.solution_str,
        state.nCustomers
    );

    updateCompareStats();
    render();
}

function updateCompareStats() {
    const d = state.compareData;
    const el = (id) => document.getElementById(id);
    if (!d || d.error) {
        if (el('compare-edit-dist')) el('compare-edit-dist').textContent = '\u2014';
        if (el('compare-jaccard')) el('compare-jaccard').textContent = '\u2014';
        if (el('compare-composite')) el('compare-composite').textContent = '\u2014';
        return;
    }
    if (el('compare-edit-dist')) el('compare-edit-dist').textContent = (d.edit_distance * 100).toFixed(1) + '%';
    if (el('compare-jaccard')) el('compare-jaccard').textContent = (d.jaccard * 100).toFixed(1) + '%';
    if (el('compare-composite')) el('compare-composite').textContent = (d.composite * 100).toFixed(1) + '%';
}

function drawCompareOverlay() {
    if (!state.compareMode || !state.compareData || state.compareData.error) return;
    const d = state.compareData;

    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#3fb950';
    for (const [from, to] of d.shared_edges) {
        const [x1, y1] = toScreen(...state.coords[from]);
        const [x2, y2] = toScreen(...state.coords[to]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.globalAlpha = 0.6;
    for (const [from, to] of d.only_b_edges) {
        const [x1, y1] = toScreen(...state.coords[from]);
        const [x2, y2] = toScreen(...state.coords[to]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

    const assignColors = { truck: COLORS.truck, drone0: COLORS.drone0, drone1: COLORS.drone1 };
    for (const pc of d.per_customer) {
        if (pc.in_a === pc.in_b) continue;
        const c = pc.customer;
        if (c === 0 || c >= state.coords.length) continue;
        const [x, y] = toScreen(...state.coords[c]);
        const color = assignColors[pc.in_b] || '#484f58';
        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS + 8, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    const hudX = 12, hudY = 12, hudW = 200, hudH = 70;
    ctx.fillStyle = 'rgba(22, 27, 34, 0.9)';
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(hudX, hudY, hudW, hudH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 11px system-ui';
    ctx.fillStyle = '#58a6ff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Compare', hudX + 8, hudY + 8);

    ctx.font = '10px system-ui';
    ctx.fillStyle = '#c9d1d9';
    ctx.fillText(`Edit dist: ${(d.edit_distance * 100).toFixed(1)}%`, hudX + 8, hudY + 26);
    ctx.fillText(`Jaccard:   ${(d.jaccard * 100).toFixed(1)}%`, hudX + 8, hudY + 40);
    ctx.fillText(`Composite: ${(d.composite * 100).toFixed(1)}%`, hudX + 8, hudY + 54);
}

function fetchHeatmapData() {
    if (!state.heatmapMode) {
        state.heatmapData = null;
        render();
        return;
    }
    const solStrings = state.savedSolutions
        .filter(s => s.solution_str)
        .map(s => s.solution_str);
    if (solStrings.length === 0) { state.heatmapData = null; render(); return; }

    state.heatmapData = Solver.computeHeatmap(solStrings, state.nCustomers);
    render();
}

function drawHeatmapOverlay() {
    if (!state.heatmapMode || !state.heatmapData || !state.heatmapData.fractions) return;
    const fracs = state.heatmapData.fractions;

    for (let c = 1; c <= state.nCustomers; c++) {
        const f = fracs[String(c)];
        if (!f) continue;
        const [x, y] = toScreen(...state.coords[c]);
        const r = Math.round(88 * f.truck + 63 * f.drone0 + 163 * f.drone1);
        const g = Math.round(166 * f.truck + 185 * f.drone0 + 113 * f.drone1);
        const b = Math.round(255 * f.truck + 80 * f.drone0 + 247 * f.drone1);
        const maxFrac = Math.max(f.truck, f.drone0, f.drone1);
        const alpha = 0.3 + maxFrac * 0.5;

        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS + 10, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.lineWidth = 5;
        ctx.stroke();
    }
}

function toggleCompareMode() {
    state.compareMode = !state.compareMode;
    const cb = document.getElementById('toggle-compare-mode');
    if (cb) cb.checked = state.compareMode;
    const panel = document.getElementById('compare-controls');
    if (panel) panel.style.display = state.compareMode ? 'block' : 'none';
    if (state.compareMode) fetchCompareData();
    else { state.compareData = null; render(); }
}

function updateCompareDropdown() {
    const sel = document.getElementById('compare-solution-select');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- select --</option>';
    const sorted = [...state.savedSolutions].sort((a, b) => {
        if (a.objective == null && b.objective == null) return 0;
        if (a.objective == null) return 1;
        if (b.objective == null) return -1;
        return a.objective - b.objective;
    });
    for (const sol of sorted) {
        const opt = document.createElement('option');
        opt.value = sol.id;
        const obj = sol.objective != null ? ` (${Math.round(sol.objective)})` : '';
        opt.textContent = sol.name + obj;
        sel.appendChild(opt);
    }
    if (currentVal && state.savedSolutions.some(s => String(s.id) === currentVal)) {
        sel.value = currentVal;
    }
}

// ============================================================================
// Events
// ============================================================================

let _eventsSetup = false;
function setupEvents() {
    if (_eventsSetup) return;
    _eventsSetup = true;

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('keydown', onKey);

    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.getElementById('btn-load').addEventListener('click', () => {
        const s = document.getElementById('solution-input').value;
        if (s.trim()) loadSolution(s);
    });
    document.getElementById('btn-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(buildSolutionString());
        const btn = document.getElementById('btn-copy');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1000);
    });
    document.getElementById('btn-clear').addEventListener('click', () => {
        state.truckEdges = [];
        state.droneFlights = [];
        state.pendingFlights = [{}, {}];
        saveHistory();
        validate();
        render();
    });
    document.getElementById('btn-reset').addEventListener('click', resetToCached);

    document.getElementById('btn-zoom-in').addEventListener('click', () => { zoomLevel = Math.min(5, zoomLevel * 1.2); calcView(); render(); updateZoom(); });
    document.getElementById('btn-zoom-out').addEventListener('click', () => { zoomLevel = Math.max(0.2, zoomLevel / 1.2); calcView(); render(); updateZoom(); });
    document.getElementById('btn-zoom-reset').addEventListener('click', () => { calcView(true); render(); updateZoom(); });

    document.getElementById('btn-drone-0').addEventListener('click', () => selectDrone(0));
    document.getElementById('btn-drone-1').addEventListener('click', () => selectDrone(1));

    document.getElementById('btn-save-solution').addEventListener('click', saveSolutionToLibrary);

    // Auto-load on paste
    document.getElementById('solution-input').addEventListener('paste', (e) => {
        const pasted = (e.clipboardData || window.clipboardData).getData('text');
        if (pasted && pasted.includes('|')) {
            try {
                parseSolutionString(pasted);
                setTimeout(() => loadSolution(pasted), 0);
            } catch (_) { /* not a valid solution */ }
        }
    });

    // Solution file upload
    document.getElementById('solution-file-input').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target.result.trim();
                if (text) loadSolution(text);
            };
            reader.readAsText(e.target.files[0]);
            e.target.value = ''; // reset so same file can be loaded again
        }
    });

    // Compare mode
    const compareCheckbox = document.getElementById('toggle-compare-mode');
    if (compareCheckbox) {
        compareCheckbox.addEventListener('change', (e) => {
            state.compareMode = e.target.checked;
            const panel = document.getElementById('compare-controls');
            if (panel) panel.style.display = state.compareMode ? 'block' : 'none';
            if (state.compareMode) fetchCompareData();
            else { state.compareData = null; render(); }
        });
    }
    const compareSel = document.getElementById('compare-solution-select');
    if (compareSel) {
        compareSel.addEventListener('change', (e) => {
            const val = e.target.value;
            state.compareSolutionId = val ? Number(val) : null;
            fetchCompareData();
        });
    }

    // Heatmap mode
    const heatmapCheckbox = document.getElementById('toggle-heatmap');
    if (heatmapCheckbox) {
        heatmapCheckbox.addEventListener('change', (e) => {
            state.heatmapMode = e.target.checked;
            if (state.heatmapMode) fetchHeatmapData();
            else { state.heatmapData = null; render(); }
        });
    }

    // Display options
    document.getElementById('toggle-arrival-times').addEventListener('change', (e) => {
        state.showArrivalTimes = e.target.checked; render();
    });
    document.getElementById('toggle-edge-times').addEventListener('change', (e) => {
        state.showEdgeTimes = e.target.checked; render();
    });
    document.getElementById('toggle-wait-indicators').addEventListener('change', (e) => {
        state.showWaitIndicators = e.target.checked; render();
    });
    document.getElementById('toggle-constraint-colors').addEventListener('change', (e) => {
        state.showConstraintColors = e.target.checked; render();
    });

    // Animation controls
    const animToggleBtn = document.getElementById('btn-anim-toggle');
    if (animToggleBtn) animToggleBtn.addEventListener('click', toggleAnimation);
    const animSpeed = document.getElementById('anim-speed');
    if (animSpeed) animSpeed.addEventListener('change', (e) => { state.animSpeed = parseFloat(e.target.value); });
    const animScrubber = document.getElementById('anim-scrubber');
    if (animScrubber) {
        animScrubber.addEventListener('input', (e) => {
            const frac = parseFloat(e.target.value) / 1000;
            state.animTime = frac * state.animMaxTime;
            if (state.animating) stopAnimation();
            updateAnimTimeDisplay();
            render();
        });
    }

    // Instance management
    const instanceSel = document.getElementById('instance-selector');
    if (instanceSel) {
        instanceSel.addEventListener('change', (e) => {
            if (e.target.value && e.target.value !== state.currentInstanceName) {
                switchInstance(e.target.value);
            }
        });
    }

    const btnAddInstance = document.getElementById('btn-add-instance');
    if (btnAddInstance) {
        btnAddInstance.addEventListener('click', () => {
            const area = document.getElementById('add-instance-area');
            area.style.display = area.style.display === 'none' ? 'block' : 'none';
        });
    }

    const btnDeleteInstance = document.getElementById('btn-delete-instance');
    if (btnDeleteInstance) {
        btnDeleteInstance.addEventListener('click', () => {
            if (state.currentInstanceName) deleteInstance(state.currentInstanceName);
        });
    }

    const btnInlineCancel = document.getElementById('btn-inline-cancel');
    if (btnInlineCancel) {
        btnInlineCancel.addEventListener('click', () => {
            document.getElementById('add-instance-area').style.display = 'none';
        });
    }

    const btnInlineLoad = document.getElementById('btn-inline-load');
    if (btnInlineLoad) {
        btnInlineLoad.addEventListener('click', () => {
            const text = document.getElementById('inline-paste-area').value.trim();
            if (!text) return;
            const name = document.getElementById('inline-instance-name').value.trim() ||
                         `Instance ${Object.keys(state.instances).length + 1}`;
            loadInstanceFromText(name, text);
            document.getElementById('add-instance-area').style.display = 'none';
            document.getElementById('inline-paste-area').value = '';
            document.getElementById('inline-instance-name').value = '';
        });
    }

    // Inline drop zone
    const inlineDropZone = document.getElementById('inline-drop-zone');
    if (inlineDropZone) {
        inlineDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            inlineDropZone.classList.add('drag-over');
        });
        inlineDropZone.addEventListener('dragleave', () => {
            inlineDropZone.classList.remove('drag-over');
        });
        inlineDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            inlineDropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                handleInstanceFile(e.dataTransfer.files[0], document.getElementById('inline-instance-name'));
            }
        });
    }

    const inlineFileInput = document.getElementById('inline-instance-file');
    if (inlineFileInput) {
        inlineFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleInstanceFile(e.target.files[0], document.getElementById('inline-instance-name'));
            }
        });
    }

    loadSolutionsLibrary();
    setupResizeHandle();
}

function selectDrone(droneId) {
    state.activeDrone = droneId;
    const btn0 = document.getElementById('btn-drone-0');
    const btn1 = document.getElementById('btn-drone-1');
    btn0.classList.toggle('active', droneId === 0);
    btn1.classList.toggle('active', droneId === 1);

    const activeBtn = droneId === 0 ? btn0 : btn1;
    activeBtn.style.transform = 'scale(1.1)';
    setTimeout(() => { activeBtn.style.transform = ''; }, 150);
    render();
}

function updateZoom() {
    document.getElementById('zoom-level').textContent = Math.round(zoomLevel * 100) + '%';
}

function onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (e.button === 1) {
        isPanning = true;
        panStart = { x: sx, y: sy };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
    }

    const node = findNodeAt(sx, sy);
    if (node !== null) {
        state.drawingFrom = node;
        state.mousePos = { x: sx, y: sy };
        state.drawingMode = (e.button === 0) ? 'truck' : 'drone';
        canvas.style.cursor = 'crosshair';
        e.preventDefault();
    }
}

function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    state.mousePos = { x: sx, y: sy };

    if (isPanning) {
        panOffset.x += sx - panStart.x;
        panOffset.y -= sy - panStart.y;
        panStart = { x: sx, y: sy };
        calcView();
        render();
        hideTooltip();
        return;
    }

    if (state.drawingFrom !== null) {
        const node = findNodeAt(sx, sy);
        state.drawingTo = (node !== null && node !== state.drawingFrom) ? node : null;
        render();
        hideTooltip();
    } else {
        const hoveredNode = findNodeAt(sx, sy);
        const edge = findEdgeAt(sx, sy);

        let needsRender = false;
        if (hoveredNode !== state.hoveredNode) {
            state.hoveredNode = hoveredNode;
            needsRender = true;
        }

        if (JSON.stringify(edge) !== JSON.stringify(state.hoveredEdge)) {
            state.hoveredEdge = edge;
            needsRender = true;
            if (edge) showEdgeTooltip(edge, e.clientX, e.clientY);
            else hideTooltip();
        } else if (edge) {
            updateTooltipPosition(e.clientX, e.clientY);
        }

        if (needsRender) {
            canvas.style.cursor = (edge || hoveredNode !== null) ? 'pointer' : 'default';
            render();
        }
    }
}

function showEdgeTooltip(edge, mouseX, mouseY) {
    const tooltip = document.getElementById('edge-tooltip');
    let html = '';

    if (edge.type === 'truck') {
        const time = state.truckMatrix[edge.from][edge.to];
        html = `
            <div class="tooltip-title">Truck Edge</div>
            <div class="tooltip-row">
                <span class="tooltip-label">From &rarr; To</span>
                <span class="tooltip-value">${edge.from} &rarr; ${edge.to}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">Travel Time</span>
                <span class="tooltip-value">${time.toFixed(1)}</span>
            </div>
        `;
    } else if (edge.type === 'drone') {
        const flightInfo = state.flightAnalysis?.[edge.customer];
        if (flightInfo) {
            const color = getUtilizationColor(flightInfo.utilization_percent);
            html = `
                <div class="tooltip-title" style="color: ${flightInfo.drone_id === 0 ? '#3fb950' : '#a371f7'}">
                    Drone ${flightInfo.drone_id} Flight &rarr; Customer ${edge.customer}
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Launch Node</span>
                    <span class="tooltip-value">${flightInfo.launch_node}</span>
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Land Node</span>
                    <span class="tooltip-value">${flightInfo.land_node}</span>
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Outbound</span>
                    <span class="tooltip-value">${flightInfo.outbound_time.toFixed(1)}</span>
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Return</span>
                    <span class="tooltip-value">${flightInfo.return_time.toFixed(1)}</span>
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Total Flight</span>
                    <span class="tooltip-value">${flightInfo.total_flight_time.toFixed(1)} / ${flightInfo.max_allowed}</span>
                </div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Utilization</span>
                    <span class="tooltip-value" style="color: ${color}">${flightInfo.utilization_percent.toFixed(1)}%</span>
                </div>
            `;
        } else {
            html = `
                <div class="tooltip-title">Drone Flight</div>
                <div class="tooltip-row">
                    <span class="tooltip-label">Customer</span>
                    <span class="tooltip-value">${edge.customer}</span>
                </div>
            `;
        }
    } else if (edge.type === 'pending') {
        html = `
            <div class="tooltip-title" style="color: #ffd33d">Pending Flight</div>
            <div class="tooltip-row">
                <span class="tooltip-label">Customer</span>
                <span class="tooltip-value">${edge.customer}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">Status</span>
                <span class="tooltip-value">Needs launch or land point</span>
            </div>
        `;
    }

    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    updateTooltipPosition(mouseX, mouseY);
}

function updateTooltipPosition(mouseX, mouseY) {
    const tooltip = document.getElementById('edge-tooltip');
    const container = document.getElementById('canvas-container');
    const containerRect = container.getBoundingClientRect();

    let x = mouseX - containerRect.left + 15;
    let y = mouseY - containerRect.top + 15;
    if (x + 200 > containerRect.width) x = mouseX - containerRect.left - 215;
    if (y + 150 > containerRect.height) y = mouseY - containerRect.top - 165;

    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
}

function hideTooltip() {
    const tooltip = document.getElementById('edge-tooltip');
    if (tooltip) tooltip.style.display = 'none';
}

function onMouseUp(e) {
    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = 'default';
        return;
    }

    if (state.drawingFrom !== null && state.drawingTo !== null && state.drawingMode) {
        if (state.drawingMode === 'truck') addTruckEdge(state.drawingFrom, state.drawingTo);
        else addDroneEdge(state.drawingFrom, state.drawingTo);
        justDragged = true;
    }

    state.drawingFrom = null;
    state.drawingTo = null;
    state.drawingMode = null;
    canvas.style.cursor = 'default';
    render();
}

function onClick(e) {
    if (justDragged) { justDragged = false; return; }

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    const clickedNode = findNodeAt(sx, sy);

    if (state.hoveredEdge && state.drawingFrom === null && clickedNode === null) {
        const edge = state.hoveredEdge;
        if (edge.type === 'truck') removeTruckEdge(edge.from, edge.to);
        else if (edge.type === 'drone') deleteDroneFlight(edge.customer);
        else if (edge.type === 'pending') deletePendingDrone(edge.customer);
        state.hoveredEdge = null;
        return;
    }

    if (clickedNode !== null && state.drawingFrom === null) {
        state.selectedNode = state.selectedNode === clickedNode ? null : clickedNode;
        render();
    }
}

function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(5, zoomLevel * factor));

    if (newZoom !== zoomLevel) {
        const [wx, wy] = toWorld(sx, sy);
        zoomLevel = newZoom;
        scale = baseScale * zoomLevel;
        offsetX = sx - wx * scale;
        offsetY = canvasHeight - sy - wy * scale;

        const cx = state.coords.reduce((s, c) => s + c[0], 0) / state.coords.length;
        const cy = state.coords.reduce((s, c) => s + c[1], 0) / state.coords.length;
        panOffset.x = offsetX - (canvasWidth / 2 - cx * scale);
        panOffset.y = offsetY - (canvasHeight / 2 - cy * scale);

        render();
        updateZoom();
    }
}

function onKey(e) {
    const tag = e.target.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'Escape') { state.drawingFrom = null; e.target.blur(); render(); }
    else if (e.key === ' ' && !inInput) { e.preventDefault(); toggleAnimation(); }
    else if (inInput) return;
    else if (e.key === '1') selectDrone(0);
    else if (e.key === '2') selectDrone(1);
    else if (e.key === 'Tab') { e.preventDefault(); selectDrone(state.activeDrone === 0 ? 1 : 0); }
    else if (e.key === 'd' || e.key === 'D') selectDrone(state.activeDrone === 0 ? 1 : 0);
    else if (e.key === 'c') toggleCompareMode();
    else if (e.key === 'q' || e.key === 'Q') selectDrone(0);
    else if (e.key === 'w' || e.key === 'W') selectDrone(1);
}

function getFlightColor(utilization) {
    if (utilization > 95) return '#f85149';
    if (utilization > 80) return '#f0883e';
    if (utilization > 50) return '#ffd33d';
    return null;
}

function getUtilizationColor(pct) {
    if (pct > 95) return '#f85149';
    if (pct > 80) return '#f0883e';
    if (pct > 50) return '#ffd33d';
    return '#3fb950';
}

// Resize Handle
function setupResizeHandle() {
    const handle = document.getElementById('resize-handle');
    const controlPanel = document.getElementById('control-panel');
    if (!handle || !controlPanel) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = controlPanel.offsetWidth;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const diff = startX - e.clientX;
        const newWidth = Math.min(600, Math.max(280, startWidth + diff));
        controlPanel.style.width = newWidth + 'px';
        resizeCanvas();
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// ============================================================================
// Solutions Library (localStorage, scoped per instance)
// ============================================================================

function loadAllSolutions() {
    try {
        const raw = localStorage.getItem(SOLUTIONS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function loadSolutionsLibrary() {
    const all = loadAllSolutions();
    state.savedSolutions = all.filter(s => s.instanceName === state.currentInstanceName);
    renderSolutionsList();
}

function persistSolutions() {
    // Load all, replace current instance solutions, save back
    let all = loadAllSolutions();
    all = all.filter(s => s.instanceName !== state.currentInstanceName);
    all.push(...state.savedSolutions);
    localStorage.setItem(SOLUTIONS_STORAGE_KEY, JSON.stringify(all));
}

function saveSolutionToLibrary() {
    const nameInput = document.getElementById('solution-name');
    const name = nameInput.value.trim() || `Solution ${state.savedSolutions.length + 1}`;
    const solution = buildSolutionString();
    const v = state.lastValidation || {};

    state.savedSolutions.push({
        id: Date.now(),
        name,
        solution_str: solution,
        objective: v.objective != null ? v.objective : null,
        feasible: v.feasible != null ? v.feasible : null,
        timestamp: new Date().toISOString(),
        instanceName: state.currentInstanceName,
    });

    persistSolutions();
    nameInput.value = '';
    renderSolutionsList();
}

function loadSolutionFromLibrary(id) {
    const sol = state.savedSolutions.find(s => s.id === id);
    if (sol && sol.solution_str) loadSolution(sol.solution_str);
}

function deleteSolutionFromLibrary(id) {
    if (!confirm('Delete this solution?')) return;
    state.savedSolutions = state.savedSolutions.filter(s => s.id !== id);
    persistSolutions();
    renderSolutionsList();
}

function renderSolutionsList() {
    const container = document.getElementById('solutions-list');
    if (!container) return;

    if (state.savedSolutions.length === 0) {
        container.innerHTML = '<div class="solutions-empty">No saved solutions</div>';
        updateCompareDropdown();
        return;
    }

    const currentObj = (state.lastValidation || {}).objective;
    const sorted = [...state.savedSolutions].sort((a, b) => {
        if (a.objective == null && b.objective == null) return 0;
        if (a.objective == null) return 1;
        if (b.objective == null) return -1;
        return a.objective - b.objective;
    });

    container.innerHTML = sorted.map(sol => {
        const feasClass = sol.feasible ? 'feasible' : sol.feasible === false ? 'infeasible' : '';
        const objText = sol.objective != null ? Math.round(sol.objective) : '?';

        let deltaHtml = '';
        if (currentObj != null && sol.objective != null) {
            const delta = sol.objective - currentObj;
            const sign = delta > 0 ? '+' : '';
            const cls = delta < 0 ? 'delta-better' : delta > 0 ? 'delta-worse' : 'delta-same';
            deltaHtml = `<span class="solution-delta ${cls}">${sign}${Math.round(delta)}</span>`;
        }

        const timeStr = sol.timestamp ? new Date(sol.timestamp).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';

        return `
            <div class="solution-item ${feasClass}">
                <div class="solution-info">
                    <span class="solution-name">${escapeHtml(sol.name)}</span>
                    <span class="solution-obj">${objText} ${deltaHtml}</span>
                    <span class="solution-time">${timeStr}</span>
                </div>
                <div class="solution-actions">
                    <button class="btn-mini btn-load-sol" onclick="loadSolutionFromLibrary(${sol.id})" title="Load this solution">Load</button>
                    <button class="btn-mini btn-delete-sol" onclick="deleteSolutionFromLibrary(${sol.id})" title="Delete">&times;</button>
                </div>
            </div>
        `;
    }).join('');

    updateCompareDropdown();
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================================
// Animation System
// ============================================================================

function buildAnimationData() {
    const timeline = state.timingData;
    const fa = state.flightAnalysis;
    if (!timeline || timeline.length === 0) return false;

    state.animTruckKeyframes = [];
    for (const entry of timeline) {
        const node = entry.node;
        if (node >= state.coords.length) continue;
        const [x, y] = state.coords[node];
        state.animTruckKeyframes.push({
            arriveTime: entry.truck_arrival,
            departTime: entry.truck_departure,
            node, x, y,
        });
    }

    if (state.animTruckKeyframes.length === 0) return false;
    state.animMaxTime = state.animTruckKeyframes[state.animTruckKeyframes.length - 1].arriveTime;

    state.animDroneFlights = [[], []];
    if (fa) {
        for (const [custStr, info] of Object.entries(fa)) {
            const cust = parseInt(custStr);
            const droneId = info.drone_id;
            if (droneId !== 0 && droneId !== 1) continue;

            const customerTime = info.customer_arrival_time;
            const launchTime = customerTime - info.outbound_time;
            const landTime = launchTime + info.total_flight_time;

            const launchCoords = state.coords[info.launch_node];
            const custCoords = state.coords[cust];
            const landCoords = state.coords[info.land_node];

            state.animDroneFlights[droneId].push({
                launchTime, customerTime, landTime,
                launchX: launchCoords[0], launchY: launchCoords[1],
                custX: custCoords[0], custY: custCoords[1],
                landX: landCoords[0], landY: landCoords[1],
                customer: cust,
                launchNode: info.launch_node,
                landNode: info.land_node,
            });
        }
    }

    for (let d = 0; d < 2; d++) {
        state.animDroneFlights[d].sort((a, b) => a.launchTime - b.launchTime);
    }
    return true;
}

function getTruckPos(t) {
    const kfs = state.animTruckKeyframes;
    if (kfs.length === 0) { const [sx, sy] = toScreen(0, 0); return { x: sx, y: sy }; }

    let wx, wy;
    if (t <= kfs[0].arriveTime) {
        wx = kfs[0].x; wy = kfs[0].y;
    } else {
        let found = false;
        for (let i = 0; i < kfs.length; i++) {
            const kf = kfs[i];
            if (t >= kf.arriveTime && t <= kf.departTime) {
                wx = kf.x; wy = kf.y; found = true; break;
            }
            if (i < kfs.length - 1 && t > kf.departTime && t < kfs[i + 1].arriveTime) {
                const progress = (t - kf.departTime) / (kfs[i + 1].arriveTime - kf.departTime);
                wx = kf.x + (kfs[i + 1].x - kf.x) * progress;
                wy = kf.y + (kfs[i + 1].y - kf.y) * progress;
                found = true; break;
            }
        }
        if (!found) { wx = kfs[kfs.length - 1].x; wy = kfs[kfs.length - 1].y; }
    }
    const [sx, sy] = toScreen(wx, wy);
    return { x: sx, y: sy };
}

function getDronePos(droneId, t) {
    const flights = state.animDroneFlights[droneId];
    for (const fl of flights) {
        if (t >= fl.launchTime && t <= fl.landTime) {
            let wx, wy, leg;
            if (t <= fl.customerTime) {
                const dur = fl.customerTime - fl.launchTime;
                const progress = dur > 0 ? (t - fl.launchTime) / dur : 1;
                wx = fl.launchX + (fl.custX - fl.launchX) * progress;
                wy = fl.launchY + (fl.custY - fl.launchY) * progress;
                leg = 'outbound';
            } else {
                const dur = fl.landTime - fl.customerTime;
                const progress = dur > 0 ? (t - fl.customerTime) / dur : 1;
                wx = fl.custX + (fl.landX - fl.custX) * progress;
                wy = fl.custY + (fl.landY - fl.custY) * progress;
                leg = 'return';
            }
            const [sx, sy] = toScreen(wx, wy);
            return { x: sx, y: sy, inFlight: true, flight: fl, leg };
        }
    }
    const tp = getTruckPos(t);
    return { x: tp.x, y: tp.y, inFlight: false };
}

function animationTick(wallTimestamp) {
    if (!state.animating) return;

    if (state.animLastWall === null) {
        state.animLastWall = wallTimestamp;
        state.animFrameId = requestAnimationFrame(animationTick);
        return;
    }

    // Normalize: 1x = full animation in ~30 seconds
    const baseRate = state.animMaxTime > 0 ? state.animMaxTime / 30 : 1;
    const dt = (wallTimestamp - state.animLastWall) / 1000 * state.animSpeed * baseRate;
    state.animLastWall = wallTimestamp;
    state.animTime = Math.min(state.animTime + dt, state.animMaxTime);

    const scrubber = document.getElementById('anim-scrubber');
    if (scrubber && state.animMaxTime > 0) {
        scrubber.value = (state.animTime / state.animMaxTime) * 1000;
    }
    updateAnimTimeDisplay();
    render();

    if (state.animTime >= state.animMaxTime) {
        stopAnimation();
        return;
    }

    state.animFrameId = requestAnimationFrame(animationTick);
}

function drawAnimationOverlay() {
    if (!state.animating && state.animTime === 0) return;
    const t = state.animTime;

    for (let i = 1; i <= state.nCustomers; i++) {
        const arrivals = state.customerArrivals;
        const arrInfo = arrivals ? arrivals[i] : null;
        const arrivalTime = arrInfo ? arrInfo.arrival_time : Infinity;
        if (arrivalTime > t) {
            const [x, y] = toScreen(...state.coords[i]);
            ctx.beginPath();
            ctx.arc(x, y, NODE_RADIUS + 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(13, 17, 23, 0.6)';
            ctx.fill();
        } else {
            const [x, y] = toScreen(...state.coords[i]);
            ctx.beginPath();
            ctx.arc(x, y, NODE_RADIUS + 5, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(88, 166, 255, 0.6)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    for (let d = 0; d < 2; d++) {
        const dp = getDronePos(d, t);
        if (dp.inFlight) {
            const fl = dp.flight;
            const color = d === 0 ? COLORS.drone0 : COLORS.drone1;
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.8;
            ctx.setLineDash([]);
            ctx.beginPath();
            if (dp.leg === 'outbound') {
                const [lx, ly] = toScreen(fl.launchX, fl.launchY);
                ctx.moveTo(lx, ly);
            } else {
                const [cx, cy] = toScreen(fl.custX, fl.custY);
                ctx.moveTo(cx, cy);
            }
            ctx.lineTo(dp.x, dp.y);
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
    }

    const tp = getTruckPos(t);
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#58a6ff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', tp.x, tp.y);

    const droneColors = ['#3fb950', '#a371f7'];
    for (let d = 0; d < 2; d++) {
        const dp = getDronePos(d, t);
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = droneColors[d];
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.toString(), dp.x, dp.y);
    }

    const hudX = 12, hudY = canvasHeight - 50, hudW = 200, hudH = 40;
    ctx.fillStyle = 'rgba(22, 27, 34, 0.9)';
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(hudX, hudY, hudW, hudH, 6);
    ctx.fill();
    ctx.stroke();

    const barX = hudX + 8, barY = hudY + 26, barW = hudW - 16, barH = 6;
    const progress = state.animMaxTime > 0 ? t / state.animMaxTime : 0;
    ctx.fillStyle = '#21262d';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 3);
    ctx.fill();
    ctx.fillStyle = '#58a6ff';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW * progress, barH, 3);
    ctx.fill();

    ctx.fillStyle = '#c9d1d9';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`t = ${t.toFixed(1)} / ${state.animMaxTime.toFixed(1)}  (${state.animSpeed}x)`, hudX + 8, hudY + 6);
}

function updateAnimTimeDisplay() {
    const el = document.getElementById('anim-time-display');
    if (el) el.textContent = `${state.animTime.toFixed(1)} / ${state.animMaxTime.toFixed(1)}`;
}

function startAnimation() {
    if (!buildAnimationData()) return;
    state.animating = true;
    state.animTime = 0;
    state.animLastWall = null;
    state.animFrameId = requestAnimationFrame(animationTick);

    const btn = document.getElementById('btn-anim-toggle');
    if (btn) btn.textContent = 'Pause';
    updateAnimTimeDisplay();
}

function stopAnimation() {
    state.animating = false;
    if (state.animFrameId !== null) {
        cancelAnimationFrame(state.animFrameId);
        state.animFrameId = null;
    }
    state.animLastWall = null;

    const btn = document.getElementById('btn-anim-toggle');
    if (btn) btn.textContent = 'Play';
    render();
}

function toggleAnimation() {
    if (state.animating) {
        stopAnimation();
    } else {
        if (state.animTime >= state.animMaxTime && state.animMaxTime > 0) {
            state.animTime = 0;
        }
        if (!buildAnimationData()) return;
        state.animating = true;
        state.animLastWall = null;
        state.animFrameId = requestAnimationFrame(animationTick);

        const btn = document.getElementById('btn-anim-toggle');
        if (btn) btn.textContent = 'Pause';
    }
}

// ============================================================================
// Start
// ============================================================================

document.addEventListener('DOMContentLoaded', init);
