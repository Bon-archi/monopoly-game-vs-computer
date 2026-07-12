const START_MONEY = 1500;
const GO_BONUS = 200;
const JAIL_TILE = 10;
const GOTOJAIL_TILE = 30;
const BAIL = 50;

const state = {
  players: [
    { id: 0, name: "אתה", isBot: false, token: "p0", position: 0, money: START_MONEY, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
    { id: 1, name: "המחשב", isBot: true, token: "p1", position: 0, money: START_MONEY, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false }
  ],
  currentPlayer: 0,
  doublesStreak: 0,
  ownership: {},
  gameOver: false,
  pendingTile: null,
  awaitingBuyDecision: false
};

const tileEls = {};
const tokenEls = {};

function log(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  document.getElementById("log").appendChild(p);
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
  board.innerHTML = "";

  const center = document.createElement("div");
  center.className = "center";
  center.innerHTML = "<h1>מונופול</h1>";
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
    inner += `<div class="owner-mark" data-owner="${tile.id}" style="display:none"></div>`;
    el.innerHTML = inner;
    board.appendChild(el);
    tileEls[tile.id] = el;
  });

  state.players.forEach(p => {
    const t = document.createElement("div");
    t.className = "token " + p.token;
    tokenEls[p.id] = t;
    tileEls[0].appendChild(t);
  });
}

function renderPlayers() {
  const container = document.getElementById("players");
  container.innerHTML = "";
  state.players.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "player-card" + (idx === state.currentPlayer && !state.gameOver ? " active" : "");
    const propNames = Object.keys(state.ownership)
      .filter(tid => state.ownership[tid].owner === idx)
      .map(tid => BOARD[tid].name);
    card.innerHTML = `
      <h3>${p.name} ${p.bankrupt ? "(פשט רגל)" : ""}</h3>
      <div class="money">₪${p.money}</div>
      <div class="props">${propNames.length ? propNames.join(", ") : "אין נכסים"}</div>
      ${p.inJail ? '<div class="props">🚔 בכלא</div>' : ""}
    `;
    container.appendChild(card);
  });
}

function updateTileVisual(tileId) {
  const owner = state.ownership[tileId];
  const mark = document.querySelector(`[data-owner="${tileId}"]`);
  if (owner && mark) {
    mark.style.display = "block";
    mark.style.background = owner.owner === 0 ? "#ff5252" : "#4fc3f7";
  }
  const housesEl = document.querySelector(`[data-houses="${tileId}"]`);
  if (housesEl && owner) {
    if (owner.houses >= 5) housesEl.textContent = "🏨";
    else if (owner.houses > 0) housesEl.textContent = "🏠".repeat(owner.houses);
  }
}

function moveToken(playerId, tileId) {
  tileEls[tileId].appendChild(tokenEls[playerId]);
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
function opponent() { return state.players[1 - state.currentPlayer]; }

function setButtons(cfg) {
  document.getElementById("rollBtn").style.display = cfg.roll ? "inline-block" : "none";
  document.getElementById("buyBtn").style.display = cfg.buy ? "inline-block" : "none";
  document.getElementById("skipBtn").style.display = cfg.buy ? "inline-block" : "none";
  document.getElementById("payBailBtn").style.display = cfg.bail ? "inline-block" : "none";
  document.getElementById("buildBtn").style.display = cfg.build ? "inline-block" : "none";
  document.getElementById("endTurnBtn").style.display = cfg.end ? "inline-block" : "none";
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

function refreshBuildButton() {
  const p = player();
  const buildable = findBuildable(state.currentPlayer);
  const btn = document.getElementById("buildBtn");
  if (buildable && p.money >= buildable.houseCost) {
    btn.style.display = "inline-block";
    btn.textContent = `בנה ${state.ownership[buildable.id].houses === 4 ? "מלון" : "בית"} ב${buildable.name} (₪${buildable.houseCost})`;
    btn.onclick = () => buildHouse(buildable.id);
  } else {
    btn.style.display = "none";
  }
}

function buildHouse(tileId) {
  const p = player();
  const tile = BOARD[tileId];
  p.money -= tile.houseCost;
  state.ownership[tileId].houses += 1;
  log(`${p.name} בנה ${state.ownership[tileId].houses >= 5 ? "מלון" : "בית"} ב${tile.name}`);
  updateTileVisual(tileId);
  renderPlayers();
  refreshBuildButton();
}

function checkBankrupt(p) {
  if (p.money >= 0) return false;
  const ownedIds = Object.keys(state.ownership).filter(tid => state.ownership[tid].owner === p.id && !state.ownership[tid].mortgaged);
  for (const tid of ownedIds) {
    if (p.money >= 0) break;
    const tile = BOARD[tid];
    state.ownership[tid].mortgaged = true;
    state.ownership[tid].houses = 0;
    p.money += Math.floor(tile.price / 2);
    log(`${p.name} משכן את ${tile.name} כדי לכסות חוב`);
    updateTileVisual(tid);
  }
  if (p.money < 0) {
    p.bankrupt = true;
    state.gameOver = true;
    Object.keys(state.ownership).forEach(tid => {
      if (state.ownership[tid].owner === p.id) delete state.ownership[tid];
      updateTileVisual(tid);
    });
    const winner = state.players.find(pl => pl.id !== p.id);
    log(`${p.name} פשט רגל! ${winner.name} מנצח את המשחק! 🎉`);
    showModal("המשחק נגמר", `${winner.name} ניצח! ${p.name} פשט רגל.`);
    renderPlayers();
    setButtons({});
    return true;
  }
  renderPlayers();
  return false;
}

function payRent(payer, owner, amount) {
  payer.money -= amount;
  owner.money += amount;
  log(`${payer.name} שילם ₪${amount} שכירות ל${owner.name}`);
  renderPlayers();
  checkBankrupt(payer);
}

function showModal(title, body) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").textContent = body;
  document.getElementById("modalOverlay").style.display = "flex";
}

function goToJail(p) {
  p.position = JAIL_TILE;
  p.inJail = true;
  p.jailTurns = 0;
  moveToken(p.id, JAIL_TILE);
  log(`${p.name} נשלח לכלא!`);
}

function applyCard(p, card) {
  log(`${p.name} שלף קלף: ${card.text}`);
  if (card.money) {
    p.money += card.money;
    checkBankrupt(p);
  }
  if (card.collectFromEach) {
    const other = opponent();
    if (p.id === state.players[state.currentPlayer].id) {
      other.money -= card.collectFromEach;
      p.money += card.collectFromEach;
    }
  }
  if (card.getOutOfJail) {
    p.jailCards += 1;
  }
  if (card.gotoJail) {
    goToJail(p);
  } else if (card.move !== undefined) {
    if (card.passGo && card.move <= p.position) p.money += GO_BONUS;
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
      p.money -= total;
      log(`${p.name} שילם ₪${total} עבור תיקונים`);
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
      if (state.awaitingBuyDecision) return;
    } else if (own.owner !== state.currentPlayer && !own.mortgaged) {
      const owner = state.players[own.owner];
      const diceTotal = state.lastDice ? state.lastDice[0] + state.lastDice[1] : 7;
      const rent = calcRent(tile, diceTotal);
      payRent(p, owner, rent);
    }
  } else if (tile.type === "tax") {
    p.money -= tile.amount;
    log(`${p.name} שילם מס של ₪${tile.amount}`);
    renderPlayers();
    checkBankrupt(p);
  } else if (tile.type === "chance") {
    const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
    applyCard(p, card);
  } else if (tile.type === "chest") {
    const card = CHEST_CARDS[Math.floor(Math.random() * CHEST_CARDS.length)];
    applyCard(p, card);
  } else if (tile.type === "gotojail") {
    goToJail(p);
  }

  if (isPrimaryLanding && !state.awaitingBuyDecision) afterLandingResolved();
}

function afterLandingResolved() {
  if (state.gameOver) return;
  const p = player();
  if (p.inJail) {
    endTurn();
    return;
  }
  if (p.isBot) {
    botPostRoll();
  } else {
    const canRollAgain = state.doublesStreak > 0 && state.doublesStreak < 3;
    setButtons({ roll: canRollAgain, end: !canRollAgain });
    refreshBuildButton();
  }
}

function offerBuy(p, tile) {
  if (p.isBot) {
    const decision = p.money - tile.price >= 80;
    if (decision) {
      buyProperty(p, tile);
    } else {
      log(`${p.name} החליט לא לקנות את ${tile.name}`);
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
  p.money -= tile.price;
  state.ownership[tile.id] = { owner: p.id, houses: 0, mortgaged: false };
  log(`${p.name} קנה את ${tile.name} תמורת ₪${tile.price}`);
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
  log(`${player().name} ויתר על ${BOARD[state.pendingTile].name}`);
  state.pendingTile = null;
  state.awaitingBuyDecision = false;
  afterLandingResolved();
});

document.getElementById("modalCloseBtn").addEventListener("click", () => {
  document.getElementById("modalOverlay").style.display = "none";
});

function rollDiceValues() {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

function movePlayerBySteps(p, steps) {
  const newPos = (p.position + steps) % 40;
  if (newPos < p.position) {
    p.money += GO_BONUS;
    log(`${p.name} עבר בהתחלה, קיבל ₪${GO_BONUS}`);
  }
  p.position = newPos;
  moveToken(p.id, p.position);
  renderPlayers();
}

function doRollForPlayer() {
  const p = player();
  const [d1, d2] = rollDiceValues();
  state.lastDice = [d1, d2];
  document.getElementById("dice").textContent = `🎲 ${d1}  🎲 ${d2}`;
  log(`${p.name} הטיל ${d1} + ${d2} = ${d1 + d2}`);

  if (p.inJail) {
    if (d1 === d2) {
      p.inJail = false;
      log(`${p.name} השליך כפולות ויצא מהכלא!`);
      movePlayerBySteps(p, d1 + d2);
      resolveTile(p);
    } else {
      p.jailTurns += 1;
      if (p.jailTurns >= 3) {
        p.inJail = false;
        p.money -= BAIL;
        log(`${p.name} לא הצליח לצאת 3 פעמים, שילם ₪${BAIL} ויצא`);
        renderPlayers();
        checkBankrupt(p);
        movePlayerBySteps(p, d1 + d2);
        resolveTile(p);
      } else {
        log(`${p.name} נשאר בכלא (ניסיון ${p.jailTurns}/3)`);
        renderPlayers();
        endTurn();
      }
    }
    return;
  }

  if (d1 === d2) {
    state.doublesStreak += 1;
    if (state.doublesStreak === 3) {
      log(`${p.name} השליך 3 כפולות ברצף ונשלח לכלא!`);
      goToJail(p);
      renderPlayers();
      endTurn();
      return;
    }
  } else {
    state.doublesStreak = 0;
  }

  movePlayerBySteps(p, d1 + d2);
  resolveTile(p);
}

document.getElementById("rollBtn").addEventListener("click", () => {
  setButtons({});
  doRollForPlayer();
});

document.getElementById("payBailBtn").addEventListener("click", () => {
  const p = player();
  p.money -= BAIL;
  p.inJail = false;
  log(`${p.name} שילם ₪${BAIL} ויצא מהכלא`);
  renderPlayers();
  if (checkBankrupt(p)) return;
  setButtons({ roll: true });
});

document.getElementById("endTurnBtn").addEventListener("click", () => {
  endTurn();
});

function startTurn() {
  if (state.gameOver) return;
  renderPlayers();
  const p = player();
  document.getElementById("dice").textContent = "🎲 🎲";
  log(`--- תור של ${p.name} ---`);

  if (p.bankrupt) {
    endTurn();
    return;
  }

  if (p.isBot) {
    setButtons({});
    setTimeout(botTurn, 800);
    return;
  }

  if (p.inJail) {
    if (p.jailCards > 0) {
      p.jailCards -= 1;
      p.inJail = false;
      log(`${p.name} השתמש בכרטיס יציאה מהכלא`);
      renderPlayers();
      setButtons({ roll: true });
    } else {
      setButtons({ roll: true, bail: true });
    }
    return;
  }

  setButtons({ roll: true });
}

function endTurn() {
  if (state.gameOver) return;
  state.doublesStreak = 0;
  state.currentPlayer = 1 - state.currentPlayer;
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
    if (buildable && p.money - buildable.houseCost >= 150) {
      buildHouse(buildable.id);
    } else {
      built = false;
    }
  }
  setTimeout(() => {
    if (state.doublesStreak > 0 && state.doublesStreak < 3) {
      log(`${p.name} מקבל תור נוסף בזכות כפולות`);
      setTimeout(botTurn, 700);
    } else {
      endTurn();
    }
  }, 600);
}

renderBoard();
renderPlayers();
startTurn();
