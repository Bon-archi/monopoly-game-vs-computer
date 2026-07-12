const START_MONEY = 1500;
const GO_BONUS = 200;
const JAIL_TILE = 10;
const GOTOJAIL_TILE = 30;
const BAIL = 50;

const PLAYER_COLORS = ["#ff5252", "#4fc3f7", "#ffca28", "#66bb6a", "#ab47bc", "#ff8a65"];

const BOT_DIFFICULTY = {
  conservative: { buyReserve: 300, auctionMaxPct: 0.75, auctionReserve: 300, buildReserve: 300, tradeOfferMult: 1.15, tradeAcceptThreshold: 1.05 },
  balanced: { buyReserve: 80, auctionMaxPct: 0.9, auctionReserve: 100, buildReserve: 150, tradeOfferMult: 1.3, tradeAcceptThreshold: 0.95 },
  aggressive: { buyReserve: 20, auctionMaxPct: 1.05, auctionReserve: 30, buildReserve: 50, tradeOfferMult: 1.5, tradeAcceptThreshold: 0.85 }
};

const state = {
  players: [],
  currentPlayer: 0,
  doublesStreak: 0,
  ownership: {},
  gameOver: false,
  pendingTile: null,
  awaitingBuyDecision: false,
  auction: null,
  botDifficulty: "balanced",
  fastMode: false,
  stats: { turns: 0, rentPaid: {}, rentByProperty: {} }
};

function botConfig() {
  return BOT_DIFFICULTY[state.botDifficulty] || BOT_DIFFICULTY.balanced;
}

function speed(ms) {
  return state.fastMode ? Math.round(ms / 4) : ms;
}

const tileEls = {};
const tokenEls = {};

const TOKEN_SLOTS = [
  { top: "2px", left: "2px" },
  { top: "2px", right: "2px" },
  { bottom: "2px", left: "2px" },
  { bottom: "2px", right: "2px" },
  { top: "50%", left: "2px", transform: "translateY(-50%)" },
  { top: "50%", right: "2px", transform: "translateY(-50%)" }
];

function layoutTokensInTile(tileEl) {
  const tokens = Array.from(tileEl.children).filter(c => c.classList.contains("token"));
  tokens.forEach((t, i) => {
    t.style.top = "";
    t.style.left = "";
    t.style.right = "";
    t.style.bottom = "";
    t.style.transform = "";
    const slot = TOKEN_SLOTS[i % TOKEN_SLOTS.length];
    Object.keys(slot).forEach(k => { t.style[k] = slot[k]; });
  });
}

const LOG_STYLES = {
  turn: { color: "#f5d90a", icon: "▶️", bold: true },
  dice: { color: "#cfd3e6", icon: "🎲" },
  buy: { color: "#7de37d", icon: "🛒" },
  rent: { color: "#ff8a80", icon: "💸" },
  tax: { color: "#ffb74d", icon: "🏛️" },
  card: { color: "#ce93d8", icon: "🎴" },
  jail: { color: "#90a4ae", icon: "🚔" },
  build: { color: "#4fc3f7", icon: "🏗️" },
  bonus: { color: "#7de37d", icon: "✨" },
  bankrupt: { color: "#ff5252", icon: "💥", bold: true },
  mortgage: { color: "#ffb74d", icon: "🏦" },
  info: { color: "#ccc", icon: "" }
};

function log(msg, type = "info") {
  const style = LOG_STYLES[type] || LOG_STYLES.info;
  const p = document.createElement("p");
  p.style.color = style.color;
  if (style.bold) p.style.fontWeight = "700";
  p.textContent = (style.icon ? style.icon + " " : "") + msg;
  document.getElementById("log").appendChild(p);
}

const DICE_PATTERNS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
};

function renderDie(el, value) {
  el.innerHTML = "";
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement("div");
    pip.className = "pip" + (DICE_PATTERNS[value].includes(i) ? " on" : "");
    el.appendChild(pip);
  }
}

function resetDice() {
  const die1 = document.getElementById("die1");
  const die2 = document.getElementById("die2");
  [die1, die2].forEach(el => {
    el.innerHTML = "";
    for (let i = 0; i < 9; i++) el.appendChild(Object.assign(document.createElement("div"), { className: "pip" }));
  });
}

function animateDice(d1, d2) {
  const die1 = document.getElementById("die1");
  const die2 = document.getElementById("die2");
  die1.classList.add("rolling");
  die2.classList.add("rolling");
  setTimeout(() => {
    renderDie(die1, d1);
    renderDie(die2, d2);
    die1.classList.remove("rolling");
    die2.classList.remove("rolling");
  }, speed(300));
}

function showMoneyPopup(playerId, amount) {
  if (!amount) return;
  const idx = state.players.findIndex(pl => pl.id === playerId);
  const cards = document.querySelectorAll(".player-card");
  const card = cards[idx];
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "money-popup " + (amount >= 0 ? "positive" : "negative");
  popup.textContent = (amount >= 0 ? "+" : "") + amount + "₪";
  popup.style.left = rect.left + rect.width / 2 + "px";
  popup.style.top = rect.top + "px";
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1200);
}

function changeMoney(p, amount) {
  p.money += amount;
  showMoneyPopup(p.id, amount);
}

function tilePos(id) {
  if (id === 0) return { row: 11, col: 11 };
  if (id === 10) return { row: 11, col: 1 };
  if (id === 20) return { row: 1, col: 1 };
  if (id === 30) return { row: 1, col: 11 };
  if (id >= 1 && id <= 9) return { row: 11, col: 11 - id };
  if (id >= 11 && id <= 19) return { row: 21 - id, col: 1 };
  if (id >= 21 && id <= 29) return { row: 1, col: id - 19 };
  return { row: id - 29, col: 11 };
}

function tileIcon(tile) {
  if (tile.type === "railroad") return "🚆";
  if (tile.type === "utility") return tile.name.includes("חשמל") ? "💡" : "📡";
  if (tile.type === "chance") return "❓";
  if (tile.type === "chest") return "📦";
  if (tile.type === "tax") return "💰";
  if (tile.type === "go") return "➡️ GO";
  if (tile.type === "jail") return "🚔";
  if (tile.type === "freeparking") return "🅿️";
  if (tile.type === "gotojail") return "👮";
  return "";
}

function renderBoard() {
  const board = document.getElementById("board");
  const appEl = document.querySelector(".app");
  const sidebar = document.querySelector(".sidebar");
  if (sidebar && appEl) appEl.appendChild(sidebar);
  board.innerHTML = "";

  const center = document.createElement("div");
  center.className = "center";
  center.innerHTML = '<div id="centerControlsSlot" class="center-controls-slot"></div>';
  board.appendChild(center);

  BOARD.forEach(tile => {
    const el = document.createElement("div");
    const pos = tilePos(tile.id);
    el.style.gridRow = pos.row;
    el.style.gridColumn = pos.col;
    el.className = "tile" + ([0, 10, 20, 30].includes(tile.id) ? " corner" : "");

    let inner = "";
    if (tile.type === "property") {
      inner += `<div class="group-bar" style="background:${GROUP_COLORS[tile.group]}"></div>`;
      inner += `<div class="houses" data-houses="${tile.id}"></div>`;
      inner += `<div class="name">${tile.name}</div>`;
      inner += `<div class="price">₪${tile.price}</div>`;
    } else if (tile.type === "railroad" || tile.type === "utility") {
      inner += `<div class="name">${tileIcon(tile)} ${tile.name}</div>`;
      inner += `<div class="price">₪${tile.price}</div>`;
    } else if (tile.type === "tax") {
      inner += `<div class="name">${tileIcon(tile)} ${tile.name}</div>`;
      inner += `<div class="price">₪${tile.amount}</div>`;
    } else {
      inner += `<div class="name">${tileIcon(tile)} ${tile.name}</div>`;
    }
    if (tile.type === "property" || tile.type === "railroad" || tile.type === "utility") {
      inner += `<div class="owner-stripe" data-owner="${tile.id}"></div>`;
      inner += `<div class="mortgage-overlay" data-mortgage="${tile.id}">🔒 משועבד</div>`;
    }
    el.innerHTML = inner;
    if (tile.type === "property" || tile.type === "railroad" || tile.type === "utility") {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => showPropertyModal(tile.id));
    }
    board.appendChild(el);
    tileEls[tile.id] = el;
  });

  state.players.forEach(p => {
    const t = document.createElement("div");
    t.className = "token " + p.token;
    t.textContent = p.name[0];
    tokenEls[p.id] = t;
    tileEls[0].appendChild(t);
    tileEls[0].classList.add("occupied-" + p.token);
  });
  layoutTokensInTile(tileEls[0]);
  relocateControls();
}

function relocateControls() {
  const slot = document.getElementById("centerControlsSlot");
  const sidebar = document.querySelector(".sidebar");
  if (slot && sidebar) {
    slot.appendChild(sidebar);
  }
}

function canActNow() {
  return state.currentPlayer === 0 && !state.gameOver && !state.awaitingBuyDecision && !state.auction &&
    document.getElementById("tradeOverlay").style.display !== "flex";
}

function canBuildOn(tileId, playerIdx) {
  const tile = BOARD[tileId];
  const own = state.ownership[tileId];
  if (tile.type !== "property" || !own || own.owner !== playerIdx || own.mortgaged) return false;
  if (!isMonopoly(playerIdx, tile.group)) return false;
  const groupTiles = getGroupTiles(tile.group);
  const minHouses = Math.min(...groupTiles.map(t => (state.ownership[t.id] || { houses: 0 }).houses));
  return own.houses === minHouses && own.houses < 5;
}

function canSellHouseOn(tileId, playerIdx) {
  const tile = BOARD[tileId];
  const own = state.ownership[tileId];
  if (tile.type !== "property" || !own || own.owner !== playerIdx || own.houses === 0) return false;
  const groupTiles = getGroupTiles(tile.group);
  const maxHouses = Math.max(...groupTiles.map(t => (state.ownership[t.id] || { houses: 0 }).houses));
  return own.houses === maxHouses;
}

function canMortgage(tileId, playerIdx) {
  const own = state.ownership[tileId];
  return !!(own && own.owner === playerIdx && !own.mortgaged && own.houses === 0);
}

function canUnmortgage(tileId, playerIdx) {
  const own = state.ownership[tileId];
  return !!(own && own.owner === playerIdx && own.mortgaged);
}

function sellHouse(tileId) {
  const tile = BOARD[tileId];
  const p = player();
  state.ownership[tileId].houses -= 1;
  changeMoney(p, Math.floor(tile.houseCost / 2));
  log(`${p.name} מכר בית ב${tile.name} בחזרה לבנק`, "mortgage");
  updateTileVisual(tileId);
  renderPlayers();
}

function mortgageProperty(tileId) {
  const tile = BOARD[tileId];
  const p = player();
  state.ownership[tileId].mortgaged = true;
  const amount = Math.floor(tile.price / 2);
  changeMoney(p, amount);
  log(`${p.name} משכן את ${tile.name} תמורת ₪${amount}`, "mortgage");
  updateTileVisual(tileId);
  renderPlayers();
}

function unmortgageProperty(tileId) {
  const tile = BOARD[tileId];
  const p = player();
  const amount = Math.ceil((tile.price / 2) * 1.1);
  if (p.money < amount) return;
  changeMoney(p, -amount);
  state.ownership[tileId].mortgaged = false;
  log(`${p.name} פדה את המשכון על ${tile.name} תמורת ₪${amount}`, "mortgage");
  updateTileVisual(tileId);
  renderPlayers();
}

function showPropertyModal(tileId) {
  const tile = BOARD[tileId];
  const own = state.ownership[tileId];
  let rows = "";
  if (tile.type === "property") {
    const labels = ["שכירות בסיס", "עם בית 1", "עם בית 2", "עם בית 3", "עם בית 4", "עם מלון"];
    rows = tile.rent.map((r, i) => `<div class="rent-row"><span>${labels[i]}</span><span>₪${r}</span></div>`).join("");
    rows += `<div class="rent-row"><span>מחיר בית</span><span>₪${tile.houseCost}</span></div>`;
  } else if (tile.type === "railroad") {
    const labels = ["תחנה אחת", "2 תחנות", "3 תחנות", "4 תחנות"];
    rows = tile.rent.map((r, i) => `<div class="rent-row"><span>${labels[i]}</span><span>₪${r}</span></div>`).join("");
  } else if (tile.type === "utility") {
    rows = `<div class="rent-row"><span>חברה אחת</span><span>4x סכום קוביות</span></div><div class="rent-row"><span>שתי חברות</span><span>10x סכום קוביות</span></div>`;
  }
  const ownerText = own ? `בבעלות ${state.players[own.owner].name}${own.mortgaged ? " (ממושכן)" : ""}` : "ללא בעלים";

  let actionsHtml = "";
  if (canActNow()) {
    if (canBuildOn(tileId, 0)) {
      actionsHtml += `<button class="btn success modal-action-btn" data-action="build" data-tile="${tileId}">בנה ${own.houses === 4 ? "מלון" : "בית"} (₪${tile.houseCost})</button>`;
    }
    if (canSellHouseOn(tileId, 0)) {
      actionsHtml += `<button class="btn secondary modal-action-btn" data-action="sellhouse" data-tile="${tileId}">מכור ${own.houses >= 5 ? "מלון" : "בית"} (+₪${Math.floor(tile.houseCost / 2)})</button>`;
    }
    if (canMortgage(tileId, 0)) {
      actionsHtml += `<button class="btn secondary modal-action-btn" data-action="mortgage" data-tile="${tileId}">משכן נכס (+₪${Math.floor(tile.price / 2)})</button>`;
    }
    if (canUnmortgage(tileId, 0)) {
      const cost = Math.ceil((tile.price / 2) * 1.1);
      actionsHtml += `<button class="btn secondary modal-action-btn" data-action="unmortgage" data-tile="${tileId}" ${state.players[0].money < cost ? "disabled" : ""}>פדה משכון (-₪${cost})</button>`;
    }
  }

  document.getElementById("modalTitle").textContent = tile.name;
  document.getElementById("modalBody").innerHTML = `
    <div class="prop-price">מחיר: ₪${tile.price}</div>
    <div class="rent-table">${rows}</div>
    <div class="prop-owner">${ownerText}</div>
    ${actionsHtml ? `<div class="modal-actions">${actionsHtml}</div>` : ""}
  `;
  document.getElementById("modalOverlay").style.display = "flex";
}

document.getElementById("modalBody").addEventListener("click", e => {
  const btn = e.target.closest(".modal-action-btn");
  if (!btn) return;
  const action = btn.dataset.action;
  const tileId = parseInt(btn.dataset.tile, 10);
  if (action === "build") buildHouse(tileId);
  else if (action === "sellhouse") sellHouse(tileId);
  else if (action === "mortgage") mortgageProperty(tileId);
  else if (action === "unmortgage") unmortgageProperty(tileId);
  showPropertyModal(tileId);
});

function updateActiveToken() {
  state.players.forEach((p, idx) => {
    tokenEls[p.id].classList.toggle("active-turn", idx === state.currentPlayer && !state.gameOver);
  });
}

function renderPlayers() {
  updateActiveToken();
  const container = document.getElementById("players");
  container.innerHTML = "";
  state.players.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "player-card" + (idx === state.currentPlayer && !state.gameOver ? " active" : "") + (p.bankrupt ? " bankrupt" : "");
    const propNames = Object.keys(state.ownership)
      .filter(tid => state.ownership[tid].owner === idx)
      .map(tid => BOARD[tid].name);
    card.innerHTML = `
      <h3><span class="player-dot" style="background:${PLAYER_COLORS[idx]}"></span>${p.name} ${p.bankrupt ? "(פשט רגל)" : ""}${idx === state.currentPlayer && p.isBot && !state.gameOver ? '<span class="thinking-indicator">🤔 חושב...</span>' : ""}</h3>
      <div class="money">₪${p.money}</div>
      <div class="props">${propNames.length ? propNames.join(", ") : "אין נכסים"}</div>
      ${p.inJail ? '<div class="props">🚔 בכלא</div>' : ""}
    `;
    container.appendChild(card);
  });
  renderMonopolyProgress();
  renderLeaderboard();
  saveGame();
}

function calcNetWorth(idx) {
  let worth = state.players[idx].money;
  Object.keys(state.ownership).forEach(tid => {
    const own = state.ownership[tid];
    if (own.owner === idx) {
      const tile = BOARD[tid];
      worth += tile.price;
      if (tile.houseCost) worth += own.houses * tile.houseCost;
    }
  });
  return worth;
}

function renderLeaderboard() {
  const ranked = state.players
    .map((p, idx) => ({ p, idx, worth: calcNetWorth(idx) }))
    .sort((a, b) => b.worth - a.worth);
  const rows = ranked.map((r, rank) => `
    <div class="leaderboard-row${r.p.bankrupt ? " bankrupt" : ""}">
      <span class="lb-rank">#${rank + 1}</span>
      <span class="player-dot" style="background:${PLAYER_COLORS[r.idx]}"></span>
      <span class="lb-name">${r.p.name}</span>
      <span class="lb-worth">₪${r.worth}</span>
    </div>
  `).join("");
  document.getElementById("leaderboard").innerHTML = `<div class="progress-title">דירוג שווי נטו</div>${rows}`;
}

function renderMonopolyProgress() {
  const idx = state.currentPlayer;
  const p = state.players[idx];
  const groups = [...new Set(BOARD.filter(t => t.type === "property").map(t => t.group))];
  const chips = groups.map(g => {
    const tiles = getGroupTiles(g);
    const owned = tiles.filter(t => state.ownership[t.id] && state.ownership[t.id].owner === idx).length;
    const complete = owned === tiles.length;
    return `<div class="group-chip${complete ? " complete" : ""}">
      <span class="group-dot" style="background:${GROUP_COLORS[g]}"></span>
      <span>${owned}/${tiles.length}${complete ? " ✓" : ""}</span>
    </div>`;
  }).join("");
  document.getElementById("monopolyProgress").innerHTML = `
    <div class="progress-title">התקדמות מונופולים — ${p.name}</div>
    <div class="chips">${chips}</div>
  `;
}

function updateTileVisual(tileId) {
  const owner = state.ownership[tileId];
  const stripe = document.querySelector(`[data-owner="${tileId}"]`);
  if (stripe) {
    if (owner) {
      stripe.style.display = "block";
      stripe.style.background = PLAYER_COLORS[owner.owner];
    } else {
      stripe.style.display = "none";
    }
  }
  const overlay = document.querySelector(`[data-mortgage="${tileId}"]`);
  if (overlay) {
    overlay.style.display = owner && owner.mortgaged ? "flex" : "none";
  }
  const housesEl = document.querySelector(`[data-houses="${tileId}"]`);
  if (housesEl) {
    if (!owner || owner.houses === 0) housesEl.textContent = "";
    else if (owner.houses >= 5) housesEl.textContent = "🏨";
    else housesEl.textContent = "🏠".repeat(owner.houses);
  }
}

function moveToken(playerId, tileId) {
  const tokenEl = tokenEls[playerId];
  const occupiedClass = "occupied-" + state.players[playerId].token;
  const oldTile = tokenEl.parentElement;
  if (oldTile) {
    oldTile.classList.remove(occupiedClass);
  }
  tileEls[tileId].appendChild(tokenEl);
  tileEls[tileId].classList.add(occupiedClass);
  if (oldTile && oldTile !== tileEls[tileId]) layoutTokensInTile(oldTile);
  layoutTokensInTile(tileEls[tileId]);
}

function getGroupTiles(group) {
  return BOARD.filter(t => t.group === group);
}

function isMonopoly(playerIdx, group) {
  return getGroupTiles(group).every(t => state.ownership[t.id] && state.ownership[t.id].owner === playerIdx);
}

function calcRent(tile, diceTotal) {
  const own = state.ownership[tile.id];
  if (!own) return 0;
  const ownerIdx = own.owner;
  if (tile.type === "property") {
    if (own.houses > 0) return tile.rent[own.houses];
    return isMonopoly(ownerIdx, tile.group) ? tile.rent[0] * 2 : tile.rent[0];
  }
  if (tile.type === "railroad") {
    const count = BOARD.filter(t => t.type === "railroad" && state.ownership[t.id] && state.ownership[t.id].owner === ownerIdx).length;
    return tile.rent[count - 1];
  }
  if (tile.type === "utility") {
    const count = BOARD.filter(t => t.type === "utility" && state.ownership[t.id] && state.ownership[t.id].owner === ownerIdx).length;
    return diceTotal * (count === 1 ? 4 : 10);
  }
  return 0;
}

function player() { return state.players[state.currentPlayer]; }

function getNextActivePlayer(fromIdx) {
  let next = (fromIdx + 1) % state.players.length;
  let guard = 0;
  while (state.players[next].bankrupt && guard < state.players.length) {
    next = (next + 1) % state.players.length;
    guard++;
  }
  return next;
}

function setButtons(cfg) {
  document.getElementById("rollBtn").style.display = cfg.roll ? "inline-block" : "none";
  document.getElementById("buyBtn").style.display = cfg.buy ? "inline-block" : "none";
  document.getElementById("skipBtn").style.display = cfg.buy ? "inline-block" : "none";
  document.getElementById("payBailBtn").style.display = cfg.bail ? "inline-block" : "none";
  document.getElementById("endTurnBtn").style.display = cfg.end ? "inline-block" : "none";
  const canTrade = cfg.trade && state.players.some((pl, i) => i !== state.currentPlayer && !pl.bankrupt);
  document.getElementById("tradeBtn").style.display = canTrade ? "inline-block" : "none";
}

function findBuildable(playerIdx) {
  const groups = [...new Set(BOARD.filter(t => t.type === "property").map(t => t.group))];
  for (const g of groups) {
    if (!isMonopoly(playerIdx, g)) continue;
    const tiles = getGroupTiles(g);
    const minHouses = Math.min(...tiles.map(t => (state.ownership[t.id] || { houses: 0 }).houses));
    const candidate = tiles.find(t => (state.ownership[t.id].houses) === minHouses && minHouses < 5);
    if (candidate) return candidate;
  }
  return null;
}

function buildHouse(tileId) {
  const p = player();
  const tile = BOARD[tileId];
  changeMoney(p, -tile.houseCost);
  state.ownership[tileId].houses += 1;
  log(`${p.name} בנה ${state.ownership[tileId].houses >= 5 ? "מלון" : "בית"} ב${tile.name}`, "build");
  updateTileVisual(tileId);
  renderPlayers();
}

function checkBankrupt(p) {
  if (p.money >= 0) return false;
  const ownedIds = Object.keys(state.ownership).filter(tid => state.ownership[tid].owner === p.id && !state.ownership[tid].mortgaged);
  for (const tid of ownedIds) {
    if (p.money >= 0) break;
    const tile = BOARD[tid];
    state.ownership[tid].mortgaged = true;
    state.ownership[tid].houses = 0;
    changeMoney(p, Math.floor(tile.price / 2));
    log(`${p.name} משכן את ${tile.name} כדי לכסות חוב`, "mortgage");
    updateTileVisual(tid);
  }
  if (p.money < 0) {
    p.bankrupt = true;
    Object.keys(state.ownership).forEach(tid => {
      if (state.ownership[tid].owner === p.id) delete state.ownership[tid];
      updateTileVisual(tid);
    });
    log(`${p.name} פשט רגל!`, "bankrupt");
    showBankruptBanner(p.name);
    const remaining = state.players.filter(pl => !pl.bankrupt);
    if (remaining.length <= 1) {
      state.gameOver = true;
      const winner = remaining[0];
      log(`${winner.name} מנצח את המשחק! 🎉`, "bankrupt");
      showGameOverModal(winner);
      setButtons({});
    }
    renderPlayers();
    return true;
  }
  renderPlayers();
  return false;
}

function payRent(payer, owner, amount, tileId) {
  changeMoney(payer, -amount);
  changeMoney(owner, amount);
  state.stats.rentPaid[payer.id] = (state.stats.rentPaid[payer.id] || 0) + amount;
  if (tileId !== undefined) state.stats.rentByProperty[tileId] = (state.stats.rentByProperty[tileId] || 0) + amount;
  log(`${payer.name} שילם ₪${amount} שכירות ל${owner.name}`, "rent");
  renderPlayers();
  checkBankrupt(payer);
}

function showModal(title, body) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").textContent = body;
  document.getElementById("modalOverlay").style.display = "flex";
}

function showGameOverModal(winner) {
  const rentRows = state.players.map(p => `<div class="rent-row"><span>${p.name}</span><span>₪${state.stats.rentPaid[p.id] || 0}</span></div>`).join("");
  let bestPropId = null;
  let bestAmt = 0;
  Object.keys(state.stats.rentByProperty).forEach(tid => {
    if (state.stats.rentByProperty[tid] > bestAmt) {
      bestAmt = state.stats.rentByProperty[tid];
      bestPropId = tid;
    }
  });
  const bestPropText = bestPropId !== null ? `${BOARD[bestPropId].name} (₪${bestAmt})` : "אין נתונים";
  document.getElementById("modalTitle").textContent = "המשחק נגמר";
  document.getElementById("modalBody").innerHTML = `
    <div class="prop-price">${winner.name} ניצח! 🎉</div>
    <div class="rent-table">
      <div class="rent-row"><span>סה"כ תורות</span><span>${state.stats.turns}</span></div>
      <div class="rent-row"><span>הנכס הכי רווחי</span><span>${bestPropText}</span></div>
    </div>
    <div class="prop-owner">שכירות ששולמה על ידי כל שחקן:</div>
    <div class="rent-table">${rentRows}</div>
  `;
  document.getElementById("modalOverlay").style.display = "flex";
}

function goToJail(p) {
  p.position = JAIL_TILE;
  p.inJail = true;
  p.jailTurns = 0;
  moveToken(p.id, JAIL_TILE);
  log(`${p.name} נשלח לכלא!`, "jail");
}

function applyCard(p, card, deckName) {
  log(`${p.name} שלף קלף: ${card.text}`, "card");
  showCardBanner(deckName, card.text, p.name);
  if (card.money) {
    changeMoney(p, card.money);
    checkBankrupt(p);
  }
  if (card.collectFromEach) {
    state.players.forEach(other => {
      if (other.id !== p.id && !other.bankrupt) {
        changeMoney(other, -card.collectFromEach);
        changeMoney(p, card.collectFromEach);
        checkBankrupt(other);
      }
    });
  }
  if (card.getOutOfJail) {
    p.jailCards += 1;
  }
  if (card.gotoJail) {
    goToJail(p);
  } else if (card.move !== undefined) {
    if (card.passGo && card.move <= p.position) changeMoney(p, GO_BONUS);
    p.position = card.move;
    moveToken(p.id, p.position);
    resolveTile(p, false);
  } else if (card.moveRelative) {
    p.position = (p.position + card.moveRelative + 40) % 40;
    moveToken(p.id, p.position);
    resolveTile(p, false);
  }
  if (card.repairs) {
    const ids = Object.keys(state.ownership).filter(tid => state.ownership[tid].owner === p.id);
    let total = 0;
    ids.forEach(tid => {
      const h = state.ownership[tid].houses;
      if (h >= 5) total += card.repairs.hotel;
      else total += h * card.repairs.house;
    });
    if (total > 0) {
      changeMoney(p, -total);
      log(`${p.name} שילם ₪${total} עבור תיקונים`, "tax");
      checkBankrupt(p);
    }
  }
  renderPlayers();
}

function resolveTile(p, isPrimaryLanding = true) {
  const tile = BOARD[p.position];

  if (tile.type === "property" || tile.type === "railroad" || tile.type === "utility") {
    const own = state.ownership[tile.id];
    if (!own) {
      offerBuy(p, tile);
      if (state.awaitingBuyDecision || state.auction) return;
    } else if (own.owner !== state.currentPlayer && !own.mortgaged) {
      const owner = state.players[own.owner];
      const diceTotal = state.lastDice ? state.lastDice[0] + state.lastDice[1] : 7;
      const rent = calcRent(tile, diceTotal);
      payRent(p, owner, rent, tile.id);
    }
  } else if (tile.type === "tax") {
    changeMoney(p, -tile.amount);
    log(`${p.name} שילם מס של ₪${tile.amount}`, "tax");
    renderPlayers();
    checkBankrupt(p);
  } else if (tile.type === "chance") {
    const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
    applyCard(p, card, "מזל");
  } else if (tile.type === "chest") {
    const card = CHEST_CARDS[Math.floor(Math.random() * CHEST_CARDS.length)];
    applyCard(p, card, "קופה קהילתית");
  } else if (tile.type === "gotojail") {
    goToJail(p);
  }

  if (isPrimaryLanding && !state.awaitingBuyDecision && !state.auction) afterLandingResolved();
}

function afterLandingResolved() {
  if (state.gameOver) return;
  const p = player();
  if (p.bankrupt) {
    endTurn();
    return;
  }
  if (p.inJail) {
    endTurn();
    return;
  }
  if (p.isBot) {
    botPostRoll();
  } else {
    const canRollAgain = state.doublesStreak > 0 && state.doublesStreak < 3;
    setButtons({ roll: canRollAgain, end: !canRollAgain, trade: true });
  }
}

function offerBuy(p, tile) {
  if (p.isBot) {
    const decision = p.money - tile.price >= botConfig().buyReserve;
    if (decision) {
      buyProperty(p, tile);
    } else {
      log(`${p.name} החליט לא לקנות את ${tile.name}`, "info");
      startAuction(tile.id);
    }
    return;
  }
  state.pendingTile = tile.id;
  state.awaitingBuyDecision = true;
  const buyBtn = document.getElementById("buyBtn");
  buyBtn.textContent = `קנה את ${tile.name} ב-₪${tile.price}`;
  setButtons({ buy: true });
}

function buyProperty(p, tile) {
  changeMoney(p, -tile.price);
  state.ownership[tile.id] = { owner: p.id, houses: 0, mortgaged: false };
  log(`${p.name} קנה את ${tile.name} תמורת ₪${tile.price}`, "buy");
  updateTileVisual(tile.id);
  renderPlayers();
}

document.getElementById("buyBtn").addEventListener("click", () => {
  const tile = BOARD[state.pendingTile];
  buyProperty(player(), tile);
  state.pendingTile = null;
  state.awaitingBuyDecision = false;
  afterLandingResolved();
});

document.getElementById("skipBtn").addEventListener("click", () => {
  const tileId = state.pendingTile;
  log(`${player().name} ויתר על ${BOARD[tileId].name}`, "info");
  state.pendingTile = null;
  state.awaitingBuyDecision = false;
  startAuction(tileId);
});

document.getElementById("modalCloseBtn").addEventListener("click", () => {
  document.getElementById("modalOverlay").style.display = "none";
});

function startAuction(tileId) {
  const decliner = state.currentPlayer;
  const starter = getNextActivePlayer(decliner);
  const passed = state.players.map(pl => pl.bankrupt);
  state.auction = { tileId, highBid: 0, highBidder: null, turn: starter, passed };
  log(`מכירה פומבית על ${BOARD[tileId].name} מתחילה!`, "info");
  setButtons({});
  document.getElementById("auctionPanel").style.display = "flex";
  runAuctionTurn();
}

function auctionActiveBidders() {
  const a = state.auction;
  return state.players.map((pl, i) => i).filter(i => !a.passed[i]);
}

function updateAuctionPanel() {
  const a = state.auction;
  const tile = BOARD[a.tileId];
  const bidderName = a.highBidder !== null ? state.players[a.highBidder].name : "אין הצעות עדיין";
  document.getElementById("auctionInfo").textContent = `מכירה פומבית: ${tile.name} — הצעה גבוהה: ₪${a.highBid} (${bidderName})`;
  const input = document.getElementById("auctionBidInput");
  input.min = a.highBid + 10;
  input.value = a.highBid + 10;
  const isHumanTurn = a.turn === 0;
  document.getElementById("auctionBidBtn").disabled = !isHumanTurn;
  document.getElementById("auctionPassBtn").disabled = !isHumanTurn;
}

function runAuctionTurn() {
  const a = state.auction;
  if (!a) return;
  updateAuctionPanel();
  if (state.players[a.turn].isBot) {
    setTimeout(botAuctionAction, speed(700));
  }
}

function botAuctionAction() {
  const a = state.auction;
  if (!a) return;
  const tile = BOARD[a.tileId];
  const bot = state.players[a.turn];
  const cfg = botConfig();
  const maxWilling = Math.floor(tile.price * cfg.auctionMaxPct);
  const nextBid = a.highBid + 10;
  if (a.highBidder !== a.turn && nextBid <= maxWilling && bot.money - nextBid >= cfg.auctionReserve) {
    auctionBid(a.turn, nextBid);
  } else {
    auctionPass(a.turn);
  }
}

function auctionBid(idx, amount) {
  const a = state.auction;
  a.highBid = amount;
  a.highBidder = idx;
  log(`${state.players[idx].name} מציע ₪${amount} על ${BOARD[a.tileId].name}`, "info");
  afterAuctionAction(idx);
}

function auctionPass(idx) {
  const a = state.auction;
  a.passed[idx] = true;
  log(`${state.players[idx].name} פורש מהמכירה הפומבית`, "info");
  afterAuctionAction(idx);
}

function afterAuctionAction(idx) {
  const a = state.auction;
  const remaining = auctionActiveBidders();
  if (remaining.length === 0 || (a.highBidder !== null && remaining.length <= 1)) {
    finishAuction();
    return;
  }
  let next = (idx + 1) % state.players.length;
  let guard = 0;
  while (a.passed[next] && guard < state.players.length) {
    next = (next + 1) % state.players.length;
    guard++;
  }
  a.turn = next;
  runAuctionTurn();
}

function finishAuction() {
  const a = state.auction;
  const tile = BOARD[a.tileId];
  if (a.highBidder !== null) {
    const winner = state.players[a.highBidder];
    changeMoney(winner, -a.highBid);
    state.ownership[a.tileId] = { owner: winner.id, houses: 0, mortgaged: false };
    log(`${winner.name} זכה במכירה הפומבית על ${tile.name} תמורת ₪${a.highBid}!`, "buy");
    updateTileVisual(a.tileId);
  } else {
    log(`אף אחד לא רצה את ${tile.name} — הנכס נשאר ללא בעלים`, "info");
  }
  state.auction = null;
  document.getElementById("auctionPanel").style.display = "none";
  renderPlayers();
  afterLandingResolved();
}

document.getElementById("auctionBidBtn").addEventListener("click", () => {
  const a = state.auction;
  if (!a || a.turn !== 0) return;
  const amount = parseInt(document.getElementById("auctionBidInput").value, 10);
  if (!amount || amount <= a.highBid || amount > state.players[0].money) return;
  auctionBid(0, amount);
});

document.getElementById("auctionPassBtn").addEventListener("click", () => {
  const a = state.auction;
  if (!a || a.turn !== 0) return;
  auctionPass(0);
});

function botConsiderInitiateTrade(bot) {
  const groups = [...new Set(BOARD.filter(t => t.type === "property").map(t => t.group))];
  for (const g of groups) {
    const tiles = getGroupTiles(g);
    const ownedByBot = tiles.filter(t => state.ownership[t.id] && state.ownership[t.id].owner === bot.id);
    const missingFromHuman = tiles.find(t => state.ownership[t.id] && state.ownership[t.id].owner === 0);
    if (ownedByBot.length === tiles.length - 1 && missingFromHuman) {
      const offerCash = Math.round((missingFromHuman.price * botConfig().tradeOfferMult) / 10) * 10;
      if (bot.money >= offerCash + 50) {
        proposeBotTrade(bot, missingFromHuman, offerCash);
        return true;
      }
    }
  }
  return false;
}

function proposeBotTrade(bot, tile, offerCash) {
  state.incomingOffer = { bot, tileId: tile.id, offerCash };
  document.getElementById("incomingTradeTitle").textContent = `${bot.name} מציע עסקה`;
  document.getElementById("incomingTradeBody").textContent = `${bot.name} מציע לך ₪${offerCash} תמורת ${tile.name}`;
  document.getElementById("incomingTradeOverlay").style.display = "flex";
}

document.getElementById("incomingTradeAcceptBtn").addEventListener("click", () => {
  const o = state.incomingOffer;
  if (!o) return;
  executeTrade(o.bot, state.players[0], [], [o.tileId], o.offerCash, 0);
  log(`קיבלת את הצעת המסחר של ${o.bot.name}!`, "buy");
  document.getElementById("incomingTradeOverlay").style.display = "none";
  state.incomingOffer = null;
  setTimeout(botTurn, speed(500));
});

document.getElementById("incomingTradeDeclineBtn").addEventListener("click", () => {
  const o = state.incomingOffer;
  if (!o) return;
  log(`דחית את הצעת המסחר של ${o.bot.name}`, "info");
  document.getElementById("incomingTradeOverlay").style.display = "none";
  state.incomingOffer = null;
  setTimeout(botTurn, speed(500));
});

function openTradePanel() {
  const others = state.players.filter((pl, i) => i !== state.currentPlayer && !pl.bankrupt);
  if (others.length === 0) return;
  state.pendingCounter = null;
  document.getElementById("counterOfferBtn").style.display = "none";
  const select = document.getElementById("tradePartnerSelect");
  select.innerHTML = others.map(pl => `<option value="${pl.id}">${pl.name}</option>`).join("");
  document.getElementById("tradeYourCash").value = 0;
  document.getElementById("tradeTheirCash").value = 0;
  renderTradeProps();
  document.getElementById("tradeOverlay").style.display = "flex";
}

function renderTradeProps() {
  const partnerId = parseInt(document.getElementById("tradePartnerSelect").value, 10);
  const yourProps = Object.keys(state.ownership).filter(tid => state.ownership[tid].owner === state.currentPlayer);
  const theirProps = Object.keys(state.ownership).filter(tid => state.ownership[tid].owner === partnerId);
  document.getElementById("tradeYourProps").innerHTML = yourProps.length
    ? yourProps.map(tid => `<label class="trade-prop-item"><input type="checkbox" value="${tid}" /> ${BOARD[tid].name}</label>`).join("")
    : '<span class="trade-empty">אין נכסים</span>';
  document.getElementById("tradeTheirProps").innerHTML = theirProps.length
    ? theirProps.map(tid => `<label class="trade-prop-item"><input type="checkbox" value="${tid}" /> ${BOARD[tid].name}</label>`).join("")
    : '<span class="trade-empty">אין נכסים</span>';
}

function tradeValue(propIds, cash) {
  let val = cash;
  propIds.forEach(tid => {
    const tile = BOARD[tid];
    const own = state.ownership[tid];
    val += tile.price;
    if (tile.houseCost && own) val += own.houses * tile.houseCost;
  });
  return val;
}

function executeTrade(a, b, aPropIds, bPropIds, aCash, bCash) {
  aPropIds.forEach(tid => {
    state.ownership[tid].owner = b.id;
    updateTileVisual(tid);
  });
  bPropIds.forEach(tid => {
    state.ownership[tid].owner = a.id;
    updateTileVisual(tid);
  });
  changeMoney(a, bCash - aCash);
  changeMoney(b, aCash - bCash);
  log(`עסקה בוצעה בין ${a.name} ל${b.name}`, "buy");
  renderPlayers();
}

function evaluateBotTrade(bot, yourPropIds, theirPropIds, yourCash, theirCash) {
  const threshold = botConfig().tradeAcceptThreshold;
  const botGets = tradeValue(yourPropIds, yourCash);
  const botGives = tradeValue(theirPropIds, theirCash);
  const accept = botGets >= botGives * threshold;
  if (accept) {
    executeTrade(player(), bot, yourPropIds, theirPropIds, yourCash, theirCash);
    log(`${bot.name} קיבל את הצעת המסחר!`, "buy");
    return;
  }
  const deficit = Math.ceil((botGives * threshold - botGets) / 10) * 10;
  const humanMoney = state.players[0].money;
  if (deficit > 0 && yourCash + deficit <= humanMoney) {
    log(`${bot.name} דוחה, אבל מציע: תוסיף ₪${deficit} במזומן ואני אסכים`, "info");
    showCounterOffer(bot, yourPropIds, theirPropIds, yourCash + deficit, theirCash, deficit);
  } else {
    log(`${bot.name} דחה את הצעת המסחר`, "info");
  }
}

function showCounterOffer(bot, yourPropIds, theirPropIds, counterYourCash, theirCash, deficit) {
  state.pendingCounter = { bot, yourPropIds, theirPropIds, yourCash: counterYourCash, theirCash };
  const btn = document.getElementById("counterOfferBtn");
  btn.textContent = `קבל הצעה נגדית (+₪${deficit})`;
  btn.style.display = "inline-block";
}

document.getElementById("counterOfferBtn").addEventListener("click", () => {
  const c = state.pendingCounter;
  if (!c) return;
  executeTrade(player(), c.bot, c.yourPropIds, c.theirPropIds, c.yourCash, c.theirCash);
  log(`${c.bot.name} קיבל את ההצעה הנגדית!`, "buy");
  state.pendingCounter = null;
  document.getElementById("counterOfferBtn").style.display = "none";
});

document.getElementById("tradeBtn").addEventListener("click", openTradePanel);
document.getElementById("tradePartnerSelect").addEventListener("change", renderTradeProps);
document.getElementById("tradeCancelBtn").addEventListener("click", () => {
  document.getElementById("tradeOverlay").style.display = "none";
});

document.getElementById("tradeProposeBtn").addEventListener("click", () => {
  const partnerId = parseInt(document.getElementById("tradePartnerSelect").value, 10);
  const partner = state.players[partnerId];
  const yourPropIds = Array.from(document.querySelectorAll("#tradeYourProps input:checked")).map(el => parseInt(el.value, 10));
  const theirPropIds = Array.from(document.querySelectorAll("#tradeTheirProps input:checked")).map(el => parseInt(el.value, 10));
  const yourCash = parseInt(document.getElementById("tradeYourCash").value, 10) || 0;
  const theirCash = parseInt(document.getElementById("tradeTheirCash").value, 10) || 0;
  if (yourCash > state.players[0].money) return;
  document.getElementById("tradeOverlay").style.display = "none";
  if (partner.isBot) {
    evaluateBotTrade(partner, yourPropIds, theirPropIds, yourCash, theirCash);
  }
});

function rollDiceValues() {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

function movePlayerBySteps(p, steps, onComplete) {
  let stepsLeft = steps;
  function stepOnce() {
    if (stepsLeft <= 0) {
      if (onComplete) onComplete();
      return;
    }
    p.position = (p.position + 1) % 40;
    stepsLeft -= 1;
    moveToken(p.id, p.position);
    renderPlayers();
    if (p.position === 0) {
      changeMoney(p, GO_BONUS);
      log(`${p.name} עבר בהתחלה, קיבל ₪${GO_BONUS}`, "bonus");
    }
    setTimeout(stepOnce, speed(120));
  }
  stepOnce();
}

function doRollForPlayer() {
  const p = player();
  const [d1, d2] = rollDiceValues();
  state.lastDice = [d1, d2];
  animateDice(d1, d2);
  log(`${p.name} הטיל ${d1} + ${d2} = ${d1 + d2}`, "dice");

  if (p.inJail) {
    if (d1 === d2) {
      p.inJail = false;
      log(`${p.name} השליך כפולות ויצא מהכלא!`, "jail");
      movePlayerBySteps(p, d1 + d2, () => resolveTile(p));
    } else {
      p.jailTurns += 1;
      if (p.jailTurns >= 3) {
        p.inJail = false;
        changeMoney(p, -BAIL);
        log(`${p.name} לא הצליח לצאת 3 פעמים, שילם ₪${BAIL} ויצא`, "jail");
        renderPlayers();
        if (checkBankrupt(p)) return;
        movePlayerBySteps(p, d1 + d2, () => resolveTile(p));
      } else {
        log(`${p.name} נשאר בכלא (ניסיון ${p.jailTurns}/3)`, "jail");
        renderPlayers();
        endTurn();
      }
    }
    return;
  }

  if (d1 === d2) {
    state.doublesStreak += 1;
    if (state.doublesStreak === 3) {
      log(`${p.name} השליך 3 כפולות ברצף ונשלח לכלא!`, "jail");
      goToJail(p);
      renderPlayers();
      endTurn();
      return;
    }
  } else {
    state.doublesStreak = 0;
  }

  movePlayerBySteps(p, d1 + d2, () => resolveTile(p));
}

document.getElementById("rollBtn").addEventListener("click", () => {
  setButtons({});
  doRollForPlayer();
});

document.getElementById("payBailBtn").addEventListener("click", () => {
  const p = player();
  changeMoney(p, -BAIL);
  p.inJail = false;
  log(`${p.name} שילם ₪${BAIL} ויצא מהכלא`, "jail");
  renderPlayers();
  if (checkBankrupt(p)) return;
  setButtons({ roll: true });
});

document.getElementById("endTurnBtn").addEventListener("click", () => {
  endTurn();
});

function showTurnBanner(p) {
  const banner = document.getElementById("turnBanner");
  const variant = p.isBot ? "bot" : "you";
  banner.classList.remove("show", "you", "bot");
  void banner.offsetWidth;
  banner.textContent = p.isBot ? "תור המחשב..." : "התור שלך!";
  banner.classList.add("show", variant);
}

function showCardBanner(deckName, text, playerName) {
  const banner = document.getElementById("cardBanner");
  banner.classList.remove("show");
  void banner.offsetWidth;
  banner.innerHTML = `<div class="card-banner-deck">${deckName === "מזל" ? "❓" : "📦"} ${deckName} — ${playerName}</div><div class="card-banner-text">${text}</div>`;
  banner.classList.add("show");
}

function showBankruptBanner(name) {
  const banner = document.getElementById("bankruptBanner");
  banner.classList.remove("show");
  void banner.offsetWidth;
  banner.textContent = `💥 ${name} פשט רגל!`;
  banner.classList.add("show");
}

function startTurn() {
  if (state.gameOver) return;
  state.stats.turns += 1;
  state.pendingCounter = null;
  document.getElementById("counterOfferBtn").style.display = "none";
  renderPlayers();
  const p = player();
  resetDice();
  showTurnBanner(p);
  log(`--- תור של ${p.name} ---`, "turn");

  if (p.bankrupt) {
    endTurn();
    return;
  }

  if (p.isBot) {
    setButtons({});
    setTimeout(() => {
      if (!botConsiderInitiateTrade(p)) {
        botTurn();
      }
    }, speed(800));
    return;
  }

  if (p.inJail) {
    if (p.jailCards > 0) {
      p.jailCards -= 1;
      p.inJail = false;
      log(`${p.name} השתמש בכרטיס יציאה מהכלא`, "jail");
      renderPlayers();
      setButtons({ roll: true, trade: true });
    } else {
      setButtons({ roll: true, bail: true, trade: true });
    }
    return;
  }

  setButtons({ roll: true, trade: true });
}

function endTurn() {
  if (state.gameOver) return;
  state.doublesStreak = 0;
  state.currentPlayer = getNextActivePlayer(state.currentPlayer);
  startTurn();
}

function botTurn() {
  doRollForPlayer();
}

function botPostRoll() {
  const p = player();
  let built = true;
  while (built) {
    const buildable = findBuildable(state.currentPlayer);
    if (buildable && p.money - buildable.houseCost >= botConfig().buildReserve) {
      buildHouse(buildable.id);
    } else {
      built = false;
    }
  }
  setTimeout(() => {
    if (state.doublesStreak > 0 && state.doublesStreak < 3) {
      log(`${p.name} מקבל תור נוסף בזכות כפולות`, "dice");
      setTimeout(botTurn, speed(700));
    } else {
      endTurn();
    }
  }, speed(600));
}

let selectedBotCount = 1;
let selectedDifficulty = "balanced";

function updateNameInputsVisibility() {
  document.querySelectorAll(".bot-name-input").forEach(input => {
    const n = parseInt(input.dataset.bot, 10);
    input.style.display = n <= selectedBotCount ? "block" : "none";
  });
}

document.querySelectorAll(".count-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedBotCount = parseInt(btn.dataset.count, 10);
    document.querySelectorAll(".count-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    updateNameInputsVisibility();
  });
});

document.querySelectorAll(".diff-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedDifficulty = btn.dataset.diff;
    document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
});

document.getElementById("fastModeToggle").addEventListener("change", e => {
  state.fastMode = e.target.checked;
});

document.getElementById("startGameBtn").addEventListener("click", () => {
  document.getElementById("setupScreen").style.display = "none";
  initGame(selectedBotCount);
});

document.getElementById("newGameBtn").addEventListener("click", () => {
  if (confirm("להתחיל משחק חדש? ההתקדמות הנוכחית תאבד.")) {
    localStorage.removeItem("monopolySave");
    location.reload();
  }
});

document.getElementById("resumeGameBtn").addEventListener("click", () => {
  const saved = JSON.parse(localStorage.getItem("monopolySave"));
  document.getElementById("setupScreen").style.display = "none";
  loadGame(saved);
});

function loadGame(saved) {
  state.players = saved.players;
  state.currentPlayer = saved.currentPlayer;
  state.ownership = saved.ownership;
  state.doublesStreak = saved.doublesStreak || 0;
  state.gameOver = saved.gameOver || false;
  state.botDifficulty = saved.botDifficulty || "balanced";
  state.stats = saved.stats || { turns: 0, rentPaid: {}, rentByProperty: {} };
  renderBoard();
  renderPlayers();
  startTurn();
}

(function checkForSavedGame() {
  const raw = localStorage.getItem("monopolySave");
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved && saved.players && saved.players.length && !saved.gameOver) {
      document.getElementById("resumeSection").style.display = "block";
    }
  } catch (e) {
    localStorage.removeItem("monopolySave");
  }
})();

function saveGame() {
  if (!state.players.length) return;
  localStorage.setItem("monopolySave", JSON.stringify({
    players: state.players,
    currentPlayer: state.currentPlayer,
    ownership: state.ownership,
    doublesStreak: state.doublesStreak,
    gameOver: state.gameOver,
    botDifficulty: state.botDifficulty,
    stats: state.stats
  }));
}

function initGame(botCount) {
  localStorage.removeItem("monopolySave");
  const humanName = document.getElementById("humanNameInput").value.trim() || "אתה";
  state.players = [
    { id: 0, name: humanName, isBot: false, token: "p0", position: 0, money: START_MONEY, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false }
  ];
  for (let i = 1; i <= botCount; i++) {
    const input = document.querySelector(`.bot-name-input[data-bot="${i}"]`);
    const botName = (input && input.value.trim()) || `מחשב ${i}`;
    state.players.push({ id: i, name: botName, isBot: true, token: "p" + i, position: 0, money: START_MONEY, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false });
  }
  state.currentPlayer = 0;
  state.doublesStreak = 0;
  state.ownership = {};
  state.gameOver = false;
  state.botDifficulty = selectedDifficulty;
  state.stats = { turns: 0, rentPaid: {}, rentByProperty: {} };
  renderBoard();
  renderPlayers();
  startTurn();
}
