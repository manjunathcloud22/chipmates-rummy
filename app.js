const STORAGE_KEY = "chipmates-score-tracker-state";
const ACTIVE_GAME_EXPIRY_MS = 24 * 60 * 60 * 1000;
const ENDED_GAME_EXPIRY_MS = 6 * 60 * 60 * 1000;
const SUPABASE_URL = "https://enurxbewxprrzwilvsgf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVudXJ4YmV3eHBycnp3aWx2c2dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1ODMzOTAsImV4cCI6MjA5NTE1OTM5MH0.8btKD7z106kPIMNMM6rCYt4-hTRkAAAdeVqNGT77yPw";

const initialState = {
  pointLimit: 251,
  players: [],
  rounds: [],
  moneyEntries: [],
  started: false,
  ended: false,
  updatedAt: null,
};

const searchParams = new URLSearchParams(window.location.search);
const actionStyle = searchParams.get("actions") || "icons";
if (["compact", "mini", "icons", "split"].includes(actionStyle)) {
  document.body.classList.add(`actions-${actionStyle}`);
}
let gameId = searchParams.get("g") || searchParams.get("gameId");
let state = loadState();
let editingRoundIndex = null;
let moneyHistoryVisible = false;
let reenteringPlayerId = null;
let isLoadingRoom = Boolean(gameId);
let roomLoadFailed = false;
let isCloudSaving = false;
let lastLocalChangeAt = 0;
let lastRefreshedAt = new Date();
let roomPollTimer = null;

const els = {
  appShell: document.querySelector("#appShell"),
  scoreboardPanel: document.querySelector("#scoreboardPanel"),
  tablePanel: document.querySelector("#tablePanel"),
  setupPanel: document.querySelector("#setupPanel"),
  setupStatus: document.querySelector("#setupStatus"),
  pointLimit: document.querySelector("#pointLimit"),
  playerName: document.querySelector("#playerName"),
  addPlayer: document.querySelector("#addPlayer"),
  playerChips: document.querySelector("#playerChips"),
  startGame: document.querySelector("#startGame"),
  tableMeta: document.querySelector("#tableMeta"),
  tableStatus: document.querySelector("#tableStatus"),
  tableActions: document.querySelector("#tableActions"),
  addPoints: document.querySelector("#addPoints"),
  addGamePlayer: document.querySelector("#addGamePlayer"),
  addMoney: document.querySelector("#addMoney"),
  restartGame: document.querySelector("#restartGame"),
  endGame: document.querySelector("#endGame"),
  newGame: document.querySelector("#newGame"),
  pointsDialog: document.querySelector("#pointsDialog"),
  pointsForm: document.querySelector("#pointsForm"),
  pointsTitle: document.querySelector("#pointsTitle"),
  cancelPoints: document.querySelector("#cancelPoints"),
  cancelPointsFooter: document.querySelector("#cancelPointsFooter"),
  saveRound: document.querySelector("#saveRound"),
  moneyDialog: document.querySelector("#moneyDialog"),
  moneyForm: document.querySelector("#moneyForm"),
  moneyTitle: document.querySelector("#moneyTitle"),
  moneyPlayerName: document.querySelector("#moneyPlayerName"),
  addMoneyPlayer: document.querySelector("#addMoneyPlayer"),
  moneyDialogStatus: document.querySelector("#moneyDialogStatus"),
  cancelMoney: document.querySelector("#cancelMoney"),
  cancelMoneyFooter: document.querySelector("#cancelMoneyFooter"),
  saveMoney: document.querySelector("#saveMoney"),
  playerDialog: document.querySelector("#playerDialog"),
  playerTitle: document.querySelector("#playerTitle"),
  gamePlayerNameRow: document.querySelector("#gamePlayerNameRow"),
  gamePlayerName: document.querySelector("#gamePlayerName"),
  joinScoreOptions: document.querySelector("#joinScoreOptions"),
  customJoinScoreRow: document.querySelector("#customJoinScoreRow"),
  customJoinScore: document.querySelector("#customJoinScore"),
  playerDialogStatus: document.querySelector("#playerDialogStatus"),
  cancelGamePlayer: document.querySelector("#cancelGamePlayer"),
  cancelGamePlayerFooter: document.querySelector("#cancelGamePlayerFooter"),
  saveGamePlayer: document.querySelector("#saveGamePlayer"),
  shareGame: document.querySelector("#shareGame"),
  refreshScores: document.querySelector("#refreshScores"),
  refreshMeta: document.querySelector("#refreshMeta"),
  standings: document.querySelector("#standings"),
  history: document.querySelector("#history"),
  winnerBadge: document.querySelector("#winnerBadge"),
};

function loadState() {
  if (gameId) {
    return { ...initialState };
  }

  const sharedState = readSharedState();
  if (sharedState) {
    if (isStateExpired(sharedState)) {
      return { ...initialState };
    }
    return sharedState;
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return { ...initialState };
  }

  try {
    const savedState = normalizeState(JSON.parse(saved));
    if (isStateExpired(savedState)) {
      localStorage.removeItem(STORAGE_KEY);
      return { ...initialState };
    }
    return savedState;
  } catch {
    return { ...initialState };
  }
}

function readSharedState() {
  const params = new URLSearchParams(window.location.search);
  const game = params.get("game");
  if (!game) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(escape(atob(game)));
    return normalizeState(JSON.parse(decoded));
  } catch {
    return null;
  }
}

function normalizeState(value) {
  return {
    pointLimit: Number(value.pointLimit) || 251,
    players: Array.isArray(value.players)
      ? value.players
          .map((player) => ({
            id: String(player.id || crypto.randomUUID()),
            name: String(player.name || "").trim(),
          }))
          .filter((player) => player.name)
      : [],
    rounds: Array.isArray(value.rounds) ? value.rounds : [],
    moneyEntries: Array.isArray(value.moneyEntries) ? value.moneyEntries : [],
    started: Boolean(value.started),
    ended: Boolean(value.ended),
    updatedAt: value.updatedAt || null,
  };
}

function isStateExpired(value) {
  if (!value?.started || !value.updatedAt) {
    return false;
  }

  const updatedAt = new Date(value.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  const expiryMs = value.ended ? ENDED_GAME_EXPIRY_MS : ACTIVE_GAME_EXPIRY_MS;
  return Date.now() - updatedAt > expiryMs;
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  lastLocalChangeAt = Date.now();
  syncRoom();
}

function totals() {
  return state.players.map((player) => {
    const score = state.rounds.reduce((sum, round) => sum + (Number(round[player.id]) || 0), 0);
    return {
      ...player,
      score,
      out: score >= state.pointLimit,
    };
  });
}

function orderedStandings() {
  return totals().sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

function addPlayer() {
  const name = els.playerName.value.trim();
  if (!name) {
    els.playerName.focus();
    return;
  }

  const duplicate = state.players.some((player) => player.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    els.playerName.select();
    return;
  }

  state.players.push({ id: crypto.randomUUID(), name });
  els.playerName.value = "";
  saveState();
  render();
}

function removePlayer(id) {
  state.players = state.players.filter((player) => player.id !== id);
  saveState();
  render();
}

function removeGamePlayer(id) {
  if (state.ended) {
    return;
  }

  const player = state.players.find((item) => item.id === id);
  if (!player) {
    return;
  }

  const shouldRemove = window.confirm(`Remove ${player.name} from the points table?`);
  if (!shouldRemove) {
    return;
  }

  state.players = state.players.filter((item) => item.id !== id);
  state.rounds.forEach((round) => {
    delete round[id];
  });
  saveState();
  render();
}

function startGame() {
  if (state.players.length < 2) {
    els.playerName.focus();
    els.setupStatus.textContent = "Add at least two players to begin.";
    return;
  }

  state.pointLimit = readPointLimit();
  state.started = true;
  state.ended = false;
  els.setupStatus.textContent = "";
  saveState();
  render();
}

function saveRound() {
  if (state.ended) {
    return;
  }

  const round = editingRoundIndex === null ? {} : { ...state.rounds[editingRoundIndex] };
  playersForPointsForm(round).forEach((player) => {
    const input = document.querySelector(`[data-points-input="${player.id}"]`);
    if (input) {
      round[player.id] = Number(input.value) || 0;
    }
  });

  const hasScore = Object.values(round).some((value) => value !== 0);
  if (!hasScore) {
    return;
  }

  if (editingRoundIndex === null) {
    state.rounds.push(round);
  } else {
    state.rounds[editingRoundIndex] = round;
  }
  closePointsDialog();
  saveState();
  render();
}

function openPointsDialog() {
  if (!state.started || state.ended) {
    return;
  }

  editingRoundIndex = null;
  renderPointsForm();
  if (!els.pointsForm.querySelector("input")) {
    return;
  }
  els.pointsDialog.classList.remove("hidden");
  const firstInput = els.pointsForm.querySelector("input");
  firstInput?.focus();
  firstInput?.select();
}

function openMoneyDialog() {
  if (!state.started || state.ended) {
    return;
  }

  renderMoneyForm();
  els.moneyPlayerName.value = "";
  els.moneyDialogStatus.textContent = "";
  els.moneyDialog.classList.remove("hidden");
  const firstInput = els.moneyForm.querySelector("input");
  firstInput?.focus();
  firstInput?.select();
}

function openGamePlayerDialog() {
  if (!state.started || state.ended) {
    return;
  }

  reenteringPlayerId = null;
  els.playerTitle.textContent = "Add Player";
  els.gamePlayerNameRow.classList.remove("hidden");
  els.saveGamePlayer.textContent = "Add Player";
  els.gamePlayerName.value = "";
  const defaultRule = state.rounds.length ? "maxPlusOne" : "custom";
  setJoinScoreRule(defaultRule);
  updateJoinScorePreview();
  els.playerDialog.classList.remove("hidden");
  els.gamePlayerName.focus();
}

function openReenterDialog(playerId) {
  if (state.ended) {
    return;
  }

  const player = totals().find((item) => item.id === playerId);
  if (!player || !player.out) {
    return;
  }

  reenteringPlayerId = playerId;
  els.playerTitle.textContent = `Re-enter ${player.name}`;
  els.gamePlayerName.value = player.name;
  els.gamePlayerNameRow.classList.add("hidden");
  els.saveGamePlayer.textContent = "Re-enter";
  setJoinScoreRule("maxPlusOne");
  updateJoinScorePreview();
  els.playerDialog.classList.remove("hidden");
  if (selectedJoinScoreRule() === "custom") {
    els.customJoinScore.focus();
    els.customJoinScore.select();
  }
}

function closeGamePlayerDialog() {
  els.playerDialog.classList.add("hidden");
  reenteringPlayerId = null;
  els.gamePlayerNameRow.classList.remove("hidden");
}

function saveGamePlayer() {
  if (!state.started || state.ended) {
    return;
  }

  if (reenteringPlayerId) {
    savePlayerReentry();
    return;
  }

  const name = els.gamePlayerName.value.trim();
  if (!name) {
    els.gamePlayerName.focus();
    return;
  }

  const duplicate = state.players.some((player) => player.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    els.gamePlayerName.select();
    els.playerDialogStatus.textContent = "Player already exists.";
    return;
  }

  const player = { id: crypto.randomUUID(), name };
  const startingScore = readJoinStartingScore();
  state.players.push(player);
  if (state.rounds.length) {
    state.rounds[state.rounds.length - 1][player.id] = startingScore;
  }

  closeGamePlayerDialog();
  saveState();
  render();
}

function savePlayerReentry() {
  const player = totals().find((item) => item.id === reenteringPlayerId);
  if (!player || !state.rounds.length) {
    return;
  }

  const targetScore = readJoinStartingScore();
  const adjustment = targetScore - player.score;
  const latestRound = state.rounds[state.rounds.length - 1];
  latestRound[player.id] = (Number(latestRound[player.id]) || 0) + adjustment;

  closeGamePlayerDialog();
  saveState();
  render();
}

function currentMaxScore(excludedPlayerId = null) {
  const allTotals = totals().filter((player) => player.id !== excludedPlayerId);
  const activeTotals = allTotals.filter((player) => !player.out);
  const source = activeTotals.length ? activeTotals : allTotals;
  return Math.max(0, ...source.map((player) => player.score));
}

function selectedJoinScoreRule() {
  return document.querySelector('input[name="joinScoreRule"]:checked')?.value || "maxPlusOne";
}

function setJoinScoreRule(rule) {
  const input = document.querySelector(`input[name="joinScoreRule"][value="${rule}"]`);
  if (input) {
    input.checked = true;
  }
  els.joinScoreOptions.classList.toggle("hidden", !state.rounds.length);
  els.customJoinScoreRow.classList.toggle("hidden", selectedJoinScoreRule() !== "custom");
  els.customJoinScore.value = String(state.rounds.length ? currentMaxScore(reenteringPlayerId) + 1 : 0);
}

function readJoinStartingScore() {
  if (!state.rounds.length) {
    return 0;
  }

  const maxScore = currentMaxScore(reenteringPlayerId);
  const rule = selectedJoinScoreRule();
  if (rule === "max") {
    return maxScore;
  }
  if (rule === "custom") {
    return Math.max(0, Number(els.customJoinScore.value) || 0);
  }
  return maxScore + 1;
}

function updateJoinScorePreview() {
  const isCustom = selectedJoinScoreRule() === "custom";
  els.customJoinScoreRow.classList.toggle("hidden", !isCustom);
  const startingScore = readJoinStartingScore();
  if (reenteringPlayerId) {
    els.playerDialogStatus.textContent = `Player will re-enter at ${startingScore} points.`;
    return;
  }

  els.playerDialogStatus.textContent = state.rounds.length
    ? `New player will start at ${startingScore} points.`
    : "New player will start at 0 points.";
}

function closeMoneyDialog() {
  els.moneyDialog.classList.add("hidden");
  els.moneyDialogStatus.textContent = "";
}

function saveMoney() {
  if (state.ended) {
    return;
  }

  const entry = {};
  state.players.forEach((player) => {
    const input = document.querySelector(`[data-money-input="${player.id}"]`);
    entry[player.id] = readSignedAmount(input?.value);
  });

  const hasMoney = Object.values(entry).some((value) => value !== 0);
  if (!hasMoney) {
    return;
  }

  const moneyTotal = Object.values(entry).reduce((sum, value) => sum + value, 0);
  if (moneyTotal !== 0) {
    els.moneyDialogStatus.textContent = '+ and - are not adding up.';
    return;
  }

  state.moneyEntries.push({
    amounts: entry,
    gameNumber: state.moneyEntries.length + 1,
    players: state.players.map((player) => ({ id: player.id, name: player.name })),
    savedAt: new Date().toISOString(),
  });
  closeMoneyDialog();
  moneyHistoryVisible = true;
  saveState();
  render();
}

function addMoneyPlayer() {
  if (state.ended) {
    return;
  }

  const name = els.moneyPlayerName.value.trim();
  if (!name) {
    els.moneyPlayerName.focus();
    return;
  }

  const duplicate = state.players.some((player) => player.name.toLowerCase() === name.toLowerCase());
  if (!duplicate) {
    state.players.push({ id: crypto.randomUUID(), name });
    saveState();
  }

  els.moneyPlayerName.value = "";
  els.moneyDialogStatus.textContent = "";
  renderMoneyForm();
  const inputs = els.moneyForm.querySelectorAll("input");
  inputs[inputs.length - 1]?.focus();
}

function removeMoneyPlayer(id) {
  if (state.ended) {
    return;
  }

  const player = state.players.find((item) => item.id === id);
  if (!player) {
    return;
  }

  const shouldRemove = window.confirm(`Remove ${player.name} from this game?`);
  if (!shouldRemove) {
    return;
  }

  state.players = state.players.filter((item) => item.id !== id);
  state.rounds.forEach((round) => {
    delete round[id];
  });
  els.moneyDialogStatus.textContent = "";
  saveState();
  renderMoneyForm();
  renderStandings();
  renderHistory();
}

function openEditRoundDialog(roundIndex) {
  if (!state.started || state.ended || !state.rounds[roundIndex]) {
    return;
  }

  editingRoundIndex = roundIndex;
  renderPointsForm(state.rounds[roundIndex]);
  els.pointsDialog.classList.remove("hidden");
  const firstInput = els.pointsForm.querySelector("input");
  firstInput?.focus();
  firstInput?.select();
}

function closePointsDialog() {
  els.pointsDialog.classList.add("hidden");
  editingRoundIndex = null;
}

function resetMoneyHistory() {
  const confirmed = window.confirm("Clear today's game history?");
  if (!confirmed) {
    return;
  }

  state.moneyEntries = [];
  moneyHistoryVisible = false;
  saveState();
  render();
}

function endGame() {
  const confirmed = window.confirm("End this game and lock scoring?");
  if (!confirmed) {
    return;
  }

  closePointsDialog();
  closeMoneyDialog();
  closeGamePlayerDialog();
  state.ended = true;
  saveState();
  render();
}

function startNewGame() {
  const confirmed = window.confirm("Start a new game from the setup page?");
  if (!confirmed) {
    return;
  }

  const todaysGameHistory = state.moneyEntries;
  detachFromSharedRoom();
  state = { ...initialState, players: [], rounds: [], moneyEntries: todaysGameHistory };
  moneyHistoryVisible = false;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function restartGameWithSamePlayers() {
  const confirmed = window.confirm("Restart with the same players and clear scores?");
  if (!confirmed) {
    return;
  }

  const currentPlayers = state.players.map((player) => ({ ...player }));
  const todaysGameHistory = state.moneyEntries;
  const pointLimit = state.pointLimit;
  detachFromSharedRoom();
  closePointsDialog();
  closeMoneyDialog();
  closeGamePlayerDialog();
  state = {
    ...initialState,
    pointLimit,
    players: currentPlayers,
    rounds: [],
    moneyEntries: todaysGameHistory,
    started: true,
    ended: false,
  };
  moneyHistoryVisible = false;
  saveState();
  render();
}

function detachFromSharedRoom() {
  gameId = null;
  isLoadingRoom = false;
  roomLoadFailed = false;
  isCloudSaving = false;
  if (roomPollTimer) {
    window.clearInterval(roomPollTimer);
    roomPollTimer = null;
  }
  window.history.replaceState({}, "", window.location.pathname);
}

async function shareGame() {
  const url = await buildShareUrl();
  if (!url) {
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({ title: "Score Tracker", text: "Current scorecard", url });
      els.tableStatus.textContent = "Share sheet opened.";
      return;
    }

    await navigator.clipboard.writeText(url);
    els.tableStatus.textContent = "Score link copied.";
  } catch {
    els.tableStatus.textContent = url;
  }
}

async function buildShareUrl() {
  const cloudUrl = await ensureCloudGame();
  if (cloudUrl) {
    return cloudUrl;
  }

  return null;
}

async function ensureCloudGame() {
  try {
    if (gameId) {
      await saveCloudGame();
      return roomUrl();
    }

    const response = await supabaseFetch("/games", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ state_json: state }),
    });
    if (!response.ok) {
      els.tableStatus.textContent = "Could not create share link. Check Supabase setup.";
      return null;
    }

    const data = await response.json();
    gameId = data[0]?.id;
    if (!gameId) {
      return null;
    }

    window.history.replaceState({}, "", `${window.location.pathname}?g=${gameId}`);
    startRoomPolling();
    return roomUrl();
  } catch {
    els.tableStatus.textContent = "Could not create share link. Check internet connection.";
    return null;
  }
}

async function syncRoom() {
  if (isLoadingRoom) {
    return;
  }
  await saveCloudGame();
}

async function saveCloudGame() {
  if (!gameId) {
    return;
  }

  try {
    isCloudSaving = true;
    const response = await supabaseFetch(`/games?id=eq.${encodeURIComponent(gameId)}`, {
      method: "PATCH",
      body: JSON.stringify({ state_json: state, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) {
      els.tableStatus.textContent = "Could not save latest scores to cloud.";
    }
  } catch {
    els.tableStatus.textContent = "Offline: latest changes are saved on this device only.";
  } finally {
    isCloudSaving = false;
  }
}

async function loadRoomState({ silent = false, force = false } = {}) {
  if (!gameId) {
    return;
  }
  if (!force && (isCloudSaving || Date.now() - lastLocalChangeAt < 1500)) {
    return;
  }

  try {
    const response = await supabaseFetch(`/games?id=eq.${encodeURIComponent(gameId)}&select=state_json`);
    if (!response.ok) {
      els.tableStatus.textContent = "Could not load shared game.";
      roomLoadFailed = true;
      return;
    }

    const data = await response.json();
    if (!data[0]?.state_json) {
      els.tableStatus.textContent = "Shared game not found.";
      roomLoadFailed = true;
      return;
    }

    const nextState = normalizeState(data[0].state_json);
    if (isStateExpired(nextState)) {
      state = { ...initialState };
      gameId = null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      window.history.replaceState({}, "", window.location.pathname);
      isLoadingRoom = false;
      roomLoadFailed = false;
      if (roomPollTimer) {
        clearInterval(roomPollTimer);
        roomPollTimer = null;
      }
      els.setupStatus.textContent = "Previous game expired. Start a new game.";
      render();
      return;
    }

    const changed = JSON.stringify(nextState) !== JSON.stringify(state);
    state = nextState;
    lastRefreshedAt = new Date();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.history.replaceState({}, "", `${window.location.pathname}?g=${gameId}`);
    isLoadingRoom = false;
    roomLoadFailed = false;
    if (!silent) {
      els.tableStatus.textContent = "";
    }
    if (changed || !silent) {
      render();
    } else {
      renderRefreshMeta();
    }
  } catch {
    roomLoadFailed = true;
    if (!silent) {
      els.tableStatus.textContent = "Could not refresh shared game.";
    }
  } finally {
    isLoadingRoom = false;
    render();
  }
}

async function refreshScoreSheet() {
  if (gameId) {
    els.tableStatus.textContent = "Refreshing scores...";
    await loadRoomState({ force: true });
    if (!roomLoadFailed) {
      els.tableStatus.textContent = "Scores refreshed.";
    }
    return;
  }

  const sharedState = readSharedState();
  if (sharedState && !isStateExpired(sharedState)) {
    state = sharedState;
    lastRefreshedAt = new Date();
    render();
    els.tableStatus.textContent = "Scores refreshed.";
    return;
  }

  lastRefreshedAt = new Date();
  render();
  els.tableStatus.textContent = "Scores are up to date.";
}

function startRoomPolling() {
  if (!gameId || roomPollTimer) {
    return;
  }
  roomPollTimer = window.setInterval(() => {
    if (!document.hidden && !isDialogOpen()) {
      loadRoomState({ silent: true });
    }
  }, 5000);
}

function roomUrl() {
  return `${window.location.origin}${window.location.pathname}?g=${gameId}`;
}

function supabaseFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

function renderPlayers() {
  els.pointLimit.value = String(state.pointLimit);
  els.playerChips.innerHTML = state.players
    .map(
      (player) => `
        <span class="chip">
          ${escapeHtml(player.name)}
          <button type="button" aria-label="Remove ${escapeHtml(player.name)}" data-remove-player="${player.id}">×</button>
        </span>
      `,
    )
    .join("");
}

function renderPointsForm(round = null) {
  els.pointsTitle.textContent = editingRoundIndex === null ? "Add Points" : `Edit Round ${editingRoundIndex + 1}`;
  els.saveRound.textContent = editingRoundIndex === null ? "Save Points" : "Update Points";
  const players = playersForPointsForm(round);
  els.pointsForm.innerHTML = players.length
    ? players
    .map(
      (player) => {
        const value = round ? Number(round[player.id]) || 0 : 25;
        return `
        <div class="round-input-row">
          <label for="points-${player.id}">${escapeHtml(player.name)}</label>
          <input id="points-${player.id}" inputmode="numeric" type="number" min="0" step="1" data-points-input="${player.id}" value="${value}" />
        </div>
      `;
      },
    )
    .join("")
    : `<p class="empty-state">All players are eliminated. Re-enter a player before adding points.</p>`;
}

function playersForPointsForm(round = null) {
  if (round) {
    return state.players.filter((player) => {
      const total = totals().find((item) => item.id === player.id);
      const roundScore = Number(round[player.id]) || 0;
      return !total?.out || roundScore !== 0;
    });
  }

  const playerTotals = totals();
  return state.players.filter((player) => !playerTotals.find((item) => item.id === player.id)?.out);
}

function renderMoneyForm() {
  els.moneyTitle.textContent = `Game ${state.moneyEntries.length + 1}`;
  els.moneyForm.innerHTML = state.players
    .map(
      (player) => `
        <div class="round-input-row money-input-row">
          <label for="money-${player.id}">${escapeHtml(player.name)}</label>
          <input id="money-${player.id}" type="text" data-money-input="${player.id}" value="0" placeholder="0 or -50" autocomplete="off" />
          <button class="remove-money-player" type="button" data-remove-money-player="${escapeHtml(player.id)}" title="Remove ${escapeHtml(player.name)}" aria-label="Remove ${escapeHtml(player.name)}">×</button>
        </div>
      `,
    )
    .join("");
}

function renderStandings() {
  if (roomLoadFailed && !state.started) {
    els.tableMeta.textContent = "";
    els.winnerBadge.classList.add("hidden");
    els.standings.innerHTML = `<p class="empty-state">Shared game could not load. Check the link or Supabase permissions.</p>`;
    return;
  }

  const standings = orderedStandings();
  const activePlayers = standings.filter((player) => !player.out);
  const playerTotals = totals();

  els.tableMeta.textContent = state.started
    ? `Point limit ${state.pointLimit} · ${state.rounds.length} rounds played${state.ended ? " · Game ended" : ""}`
    : "";

  const winner = activePlayers.length === 1 && standings.length > 1 ? activePlayers[0] : null;
  els.winnerBadge.classList.toggle("hidden", !winner);
  els.winnerBadge.textContent = winner ? `${winner.name} wins` : "";

  els.standings.innerHTML = state.players.length
    ? `
      <div class="score-sheet-wrap">
        <table class="score-sheet">
          <thead>
            <tr>
              <th scope="col">Rounds</th>
              ${state.players.map((player) => renderPlayerHeader(player)).join("")}
            </tr>
          </thead>
          <tbody>
            <tr class="total-row">
              <th scope="row">Total</th>
              ${state.players
                .map((player) => {
                  const total = playerTotals.find((item) => item.id === player.id);
                  return renderTotalCell(player, total);
                })
                .join("")}
            </tr>
            ${
              state.rounds.length
                ? state.rounds
                    .map((round, index) => ({ round, index }))
                    .reverse()
                    .map(
                      ({ round, index }) => `
                        <tr>
                          <th scope="row">
                            <span class="round-label">Round ${index + 1}</span>
                            ${
                              state.ended
                                ? ""
                                : `<button class="edit-round-button" type="button" data-edit-round="${index}" title="Edit Round ${index + 1}" aria-label="Edit Round ${index + 1}">✎</button>`
                            }
                          </th>
                          ${state.players
                            .map(
                              (player) =>
                                renderRoundCell(player, round),
                            )
                            .join("")}
                        </tr>
                      `,
                    )
                    .join("")
                : `
                  <tr>
                    <th scope="row">Round 1</th>
                    ${state.players
                      .map((player) => `<td class="empty-score" data-label="${escapeHtml(player.name)}">-</td>`)
                      .join("")}
                  </tr>
                `
            }
          </tbody>
        </table>
      </div>
    `
    : `<p class="empty-state">Add players to begin tracking scores.</p>`;
}

function renderPlayerHeader(player) {
  const playerName = escapeHtml(player.name);
  return `
    <th scope="col">
      <span class="player-header-name">${playerName}</span>
      ${
        state.ended
          ? ""
          : `<button class="remove-table-player" type="button" data-remove-game-player="${escapeHtml(player.id)}" title="Remove ${playerName}" aria-label="Remove ${playerName}">×</button>`
      }
    </th>
  `;
}

function renderRoundCell(player, round) {
  const score = Number(round[player.id]) || 0;
  const playerName = escapeHtml(player.name);
  if (score < 0) {
    return `<td class="limit-reached" data-label="${playerName}">${state.pointLimit}</td>`;
  }

  const scoreClass = score >= state.pointLimit ? "limit-reached" : "";
  return `<td class="${scoreClass}" data-label="${playerName}">${score}</td>`;
}

function renderTotalCell(player, total) {
  const score = total?.score || 0;
  const playerName = escapeHtml(player.name);
  if (!total?.out) {
    return `<td class="${scoreToneClass(score)}" data-label="${playerName}">${score}</td>`;
  }

  return `
    <td class="${scoreToneClass(score)} eliminated-cell" data-label="${playerName}">
      <span class="score-value">${score}</span>
      <span class="eliminated-label">Eliminated</span>
      ${
        state.ended
          ? ""
          : `<button class="reenter-button" type="button" data-reenter-player="${escapeHtml(player.id)}">Re-enter</button>`
      }
    </td>
  `;
}

function scoreToneClass(score) {
  const pointLimit = Math.max(1, Number(state.pointLimit) || 251);
  const scorePercent = score / pointLimit;
  if (scorePercent >= 0.8) {
    return "score-danger";
  }
  if (scorePercent > 0.6) {
    return "score-warning";
  }
  return "score-safe";
}

function renderHistory() {
  if (!state.moneyEntries.length) {
    els.history.innerHTML = "";
    return;
  }

  if (!moneyHistoryVisible) {
    els.history.innerHTML = `
      <button class="history-toggle" id="toggleMoneyHistory" type="button">
        View Today's Game history (${state.moneyEntries.length})
      </button>
    `;
    return;
  }

  const moneyPlayers = dailyMoneyPlayers();
  const moneyTotals = dailyMoneyTotals(moneyPlayers);

  els.history.innerHTML = `
    <button class="history-toggle" id="toggleMoneyHistory" type="button">Hide Today's Game history</button>
    <section class="money-history">
      <div class="money-history-heading">
        <div>
          <p class="eyebrow">Today's Game history</p>
          <h3>Money Games</h3>
        </div>
        <button class="clear-history-button" id="clearMoneyHistory" type="button">Reset History</button>
      </div>
      <div class="money-history-table-wrap">
        <table class="money-history-table">
          <thead>
            <tr>
              <th scope="col">Game</th>
              ${moneyPlayers.map((player) => `<th scope="col">${escapeHtml(player.name)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${state.moneyEntries
              .map((entry, index) => {
                const amounts = moneyEntryAmounts(entry);
                return `
                  <tr>
                    <th scope="row">Game ${entry.gameNumber || index + 1}</th>
                    ${moneyPlayers
                      .map((player) => {
                        const amount = Number(amounts[player.id]) || 0;
                        return `<td class="${moneyToneClass(amount)}">${formatMoneyWithSign(amount)}</td>`;
                      })
                      .join("")}
                  </tr>
                `;
              })
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              ${moneyPlayers
                .map((player) => {
                  const total = moneyTotals[player.id] || 0;
                  return `<td class="${moneyToneClass(total)}">${formatMoneyWithSign(total)}</td>`;
                })
                .join("")}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

function moneyEntryAmounts(entry) {
  return entry.amounts || entry;
}

function moneyEntryPlayers(entry) {
  if (Array.isArray(entry.players)) {
    return entry.players;
  }
  return state.players;
}

function dailyMoneyPlayers() {
  const players = new Map();
  state.moneyEntries.forEach((entry) => {
    moneyEntryPlayers(entry).forEach((player) => {
      if (!players.has(player.id)) {
        players.set(player.id, player);
      }
    });
  });
  state.players.forEach((player) => {
    if (!players.has(player.id)) {
      players.set(player.id, player);
    }
  });
  return Array.from(players.values());
}

function dailyMoneyTotals(players) {
  return players.reduce((totals, player) => {
    totals[player.id] = state.moneyEntries.reduce((sum, entry) => {
      const amounts = moneyEntryAmounts(entry);
      return sum + (Number(amounts[player.id]) || 0);
    }, 0);
    return totals;
  }, {});
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
  });
}

function formatMoneyWithSign(value) {
  const amount = Number(value) || 0;
  if (amount > 0) {
    return `+$${formatMoney(amount)}`;
  }
  if (amount < 0) {
    return `-$${formatMoney(Math.abs(amount))}`;
  }
  return "$0";
}

function moneyToneClass(value) {
  if (value > 0) {
    return "money-positive";
  }
  if (value < 0) {
    return "money-negative";
  }
  return "money-zero";
}

function readPointLimit() {
  return Math.max(1, Number(els.pointLimit.value) || 251);
}

function readSignedAmount(value) {
  const cleaned = String(value || "")
    .replace(/[,$\s]/g, "")
    .replace(/[−–—]/g, "-");
  return Number(cleaned) || 0;
}

function isDialogOpen() {
  return (
    !els.pointsDialog.classList.contains("hidden") ||
    !els.moneyDialog.classList.contains("hidden") ||
    !els.playerDialog.classList.contains("hidden")
  );
}

function renderRefreshMeta() {
  if (!els.refreshMeta) {
    return;
  }

  const formatted = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(lastRefreshedAt);
  els.refreshMeta.textContent = `Last refreshed: ${formatted}`;
}

function render() {
  const showGame = state.started || isLoadingRoom || roomLoadFailed;
  els.appShell.classList.toggle("game-active", showGame);
  els.scoreboardPanel.classList.toggle("hidden", showGame);
  els.tablePanel.classList.toggle("hidden", !showGame);
  els.tableActions.classList.toggle("hidden", !state.started || isLoadingRoom);
  els.startGame.classList.toggle("hidden", state.started);
  els.addPoints.classList.toggle("hidden", state.ended);
  els.addGamePlayer.classList.toggle("hidden", state.ended);
  els.addMoney.classList.toggle("hidden", state.ended);
  els.restartGame.classList.toggle("hidden", state.ended);
  els.endGame.classList.toggle("hidden", state.ended);
  els.newGame.classList.toggle("hidden", !state.ended);
  renderPlayers();
  renderStandings();
  renderHistory();
  if (isLoadingRoom) {
    els.tableStatus.textContent = "Loading shared game...";
  }
  renderRefreshMeta();
  renderActionLabels();
}

function renderActionLabels() {
  if (document.body.classList.contains("actions-icons")) {
    els.shareGame.textContent = "↗";
    els.shareGame.setAttribute("title", "Share link");
    els.refreshScores.textContent = "Refresh";
    els.refreshScores.setAttribute("title", "Refresh Scores");
    els.addPoints.textContent = "+ Points";
    els.addPoints.setAttribute("title", "Add Points");
    els.addGamePlayer.textContent = "+ Player";
    els.addGamePlayer.setAttribute("title", "Add Player");
    els.restartGame.textContent = "Restart";
    els.restartGame.setAttribute("title", "Restart Game");
    els.endGame.textContent = "End Game";
    els.endGame.setAttribute("title", "End Game");
    return;
  }

  els.shareGame.textContent = "Share link";
  els.refreshScores.textContent = "Refresh";
  els.addPoints.textContent = "+ Points";
  els.addGamePlayer.textContent = "+ Player";
  els.restartGame.textContent = "Restart Game";
  els.endGame.textContent = "End Game";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.addPlayer.addEventListener("click", addPlayer);
els.playerName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    addPlayer();
  }
});
els.playerChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-player]");
  if (button) {
    removePlayer(button.dataset.removePlayer);
  }
});
els.startGame.addEventListener("click", startGame);
els.addPoints.addEventListener("click", openPointsDialog);
els.addGamePlayer.addEventListener("click", openGamePlayerDialog);
els.addMoney.addEventListener("click", openMoneyDialog);
els.refreshScores.addEventListener("click", refreshScoreSheet);
els.restartGame.addEventListener("click", restartGameWithSamePlayers);
els.endGame.addEventListener("click", endGame);
els.newGame.addEventListener("click", startNewGame);
els.standings.addEventListener("click", (event) => {
  const removeGamePlayerButton = event.target.closest("[data-remove-game-player]");
  if (removeGamePlayerButton) {
    removeGamePlayer(removeGamePlayerButton.dataset.removeGamePlayer);
    return;
  }

  const reenterButton = event.target.closest("[data-reenter-player]");
  if (reenterButton) {
    openReenterDialog(reenterButton.dataset.reenterPlayer);
    return;
  }

  const button = event.target.closest("[data-edit-round]");
  if (button) {
    openEditRoundDialog(Number(button.dataset.editRound));
  }
});
els.saveRound.addEventListener("click", saveRound);
els.cancelPoints.addEventListener("click", closePointsDialog);
els.cancelPointsFooter.addEventListener("click", closePointsDialog);
els.pointsDialog.addEventListener("click", (event) => {
  if (event.target === els.pointsDialog) {
    closePointsDialog();
  }
});
els.history.addEventListener("click", (event) => {
  if (event.target.closest("#toggleMoneyHistory")) {
    moneyHistoryVisible = !moneyHistoryVisible;
    renderHistory();
    return;
  }

  if (event.target.closest("#clearMoneyHistory")) {
    resetMoneyHistory();
  }
});
els.saveMoney.addEventListener("click", saveMoney);
els.addMoneyPlayer.addEventListener("click", addMoneyPlayer);
els.moneyForm.addEventListener("click", (event) => {
  const removeMoneyPlayerButton = event.target.closest("[data-remove-money-player]");
  if (removeMoneyPlayerButton) {
    removeMoneyPlayer(removeMoneyPlayerButton.dataset.removeMoneyPlayer);
  }
});
els.moneyPlayerName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    addMoneyPlayer();
  }
});
els.cancelMoney.addEventListener("click", closeMoneyDialog);
els.cancelMoneyFooter.addEventListener("click", closeMoneyDialog);
els.moneyDialog.addEventListener("click", (event) => {
  if (event.target === els.moneyDialog) {
    closeMoneyDialog();
  }
});
els.saveGamePlayer.addEventListener("click", saveGamePlayer);
els.cancelGamePlayer.addEventListener("click", closeGamePlayerDialog);
els.cancelGamePlayerFooter.addEventListener("click", closeGamePlayerDialog);
els.gamePlayerName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    saveGamePlayer();
  }
});
els.joinScoreOptions.addEventListener("change", updateJoinScorePreview);
els.customJoinScore.addEventListener("input", updateJoinScorePreview);
els.playerDialog.addEventListener("click", (event) => {
  if (event.target === els.playerDialog) {
    closeGamePlayerDialog();
  }
});
els.shareGame.addEventListener("click", shareGame);
els.pointLimit.addEventListener("change", () => {
  state.pointLimit = readPointLimit();
  saveState();
  render();
});

render();
loadRoomState();
startRoomPolling();
