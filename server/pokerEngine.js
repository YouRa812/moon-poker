// Texas Hold'em Game Logic
import pokersolver from 'pokersolver';
const { Hand } = pokersolver;
import { getRandomMat } from './matEngine.js';

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_MAP = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export function createDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({
        rank: r,
        suit: s,
        code: `${r === '10' ? 'T' : r}${s}`,
        color: (s === '♥' || s === '♦') ? 'red' : 'black'
      });
    }
  }
  // Shuffle Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export class TexasHoldemRoom {
  constructor(roomCode, hostPlayer, config = {}) {
    this.roomCode = roomCode;
    this.hostId = hostPlayer.id;
    this.config = {
      startingChips: config.startingChips || 1000,
      smallBlind: config.smallBlind || 10,
      bigBlind: config.bigBlind || 20,
      turnTime: config.turnTime || 30, // seconds
      ...config
    };

    this.players = []; // { id, name, avatar, chips, currentBet, cards, folded, isAllIn, isSittingOut }
    this.chatLogs = [];
    this.addPlayer(hostPlayer);

    this.state = 'LOBBY'; // LOBBY, PREFLOP, FLOP, TURN, RIVER, SHOWDOWN
    this.deck = [];
    this.board = []; // 5 community cards
    this.pot = 0;
    this.currentBet = 0;
    this.dealerIndex = 0;
    this.activePlayerIndex = -1;
    this.lastAction = null;
    this.timer = null;
    this.turnEndTime = null;
  }

  addPlayer(player) {
    if (this.players.find(p => p.id === player.id)) return false;
    if (this.players.length >= 8) return false;

    this.players.push({
      id: player.id,
      name: player.name || `Игрок ${this.players.length + 1}`,
      avatar: player.avatar || Math.floor(Math.random() * 8) + 1,
      chips: this.config.startingChips,
      currentBet: 0,
      cards: [],
      folded: false,
      isAllIn: false,
      reaction: null,
      lastActionText: ''
    });

    this.addLog(`Игрок ${player.name} ворвался за стол!`);
    return true;
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      const p = this.players[idx];
      this.addLog(`${p.name} с позором ливнул со стола.`);
      this.players.splice(idx, 1);
      if (this.state !== 'LOBBY' && this.players.filter(p => !p.folded).length <= 1) {
        this.endHandPrematurely();
      }
    }
  }

  addLog(msg) {
    this.chatLogs.push({ time: new Date().toLocaleTimeString(), text: msg });
    if (this.chatLogs.length > 50) this.chatLogs.shift();
  }

  startHand() {
    const activeCount = this.players.filter(p => p.chips > 0).length;
    if (activeCount < 2) {
      this.state = 'LOBBY';
      this.addLog("Недостаточно игроков с фишками для продолжения раздачи!");
      return;
    }

    this.deck = createDeck();
    this.board = [];
    this.pot = 0;
    this.state = 'PREFLOP';

    // Move dealer
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    while (this.players[this.dealerIndex].chips <= 0) {
      this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    }

    // Reset players for new hand
    for (const p of this.players) {
      p.cards = [];
      p.currentBet = 0;
      p.folded = p.chips <= 0;
      p.isAllIn = false;
      p.reaction = null;
      p.lastActionText = '';
    }

    // Deal 2 hole cards
    for (let i = 0; i < 2; i++) {
      for (const p of this.players) {
        if (!p.folded) {
          p.cards.push(this.deck.pop());
        }
      }
    }

    // Trigger initial reactions based on cards!
    for (const p of this.players) {
      if (!p.folded) {
        const c1 = p.cards[0];
        const c2 = p.cards[1];
        if (c1.rank === c2.rank && ['A', 'K', 'Q'].includes(c1.rank)) {
          p.reaction = getRandomMat('deal', 'monsters');
        } else if ((c1.rank === '7' && c2.rank === '2') || (c1.rank === '8' && c2.rank === '3')) {
          p.reaction = getRandomMat('deal', 'trash');
        } else if (c1.suit === c2.suit) {
          p.reaction = getRandomMat('deal', 'suited_connectors');
        } else if (Math.random() < 0.4) {
          p.reaction = getRandomMat('deal', 'trash');
        }
      }
    }

    // Post blinds
    const sbPlayer = this.getNextActivePlayerIndex(this.dealerIndex);
    const bbPlayer = this.getNextActivePlayerIndex(sbPlayer);

    this.postBet(sbPlayer, this.config.smallBlind);
    this.players[sbPlayer].lastActionText = `SB ${this.config.smallBlind}`;

    this.postBet(bbPlayer, this.config.bigBlind);
    this.players[bbPlayer].lastActionText = `BB ${this.config.bigBlind}`;

    this.currentBet = this.config.bigBlind;
    this.activePlayerIndex = this.getNextActivePlayerIndex(bbPlayer);

    this.startTurnTimer();
    this.addLog(`Новая раздача началась! Блайнды: ${this.config.smallBlind}/${this.config.bigBlind}`);
  }

  getNextActivePlayerIndex(fromIndex) {
    let idx = (fromIndex + 1) % this.players.length;
    let loopCount = 0;
    while (loopCount < this.players.length) {
      const p = this.players[idx];
      if (!p.folded && !p.isAllIn && p.chips > 0) {
        return idx;
      }
      idx = (idx + 1) % this.players.length;
      loopCount++;
    }
    return -1;
  }

  postBet(playerIndex, amount) {
    const player = this.players[playerIndex];
    const actualBet = Math.min(player.chips, amount);
    player.chips -= actualBet;
    player.currentBet += actualBet;
    this.pot += actualBet;
    if (player.chips === 0) {
      player.isAllIn = true;
    }
    return actualBet;
  }

  handleAction(playerId, action, raiseAmount = 0) {
    const playerIdx = this.players.findIndex(p => p.id === playerId);
    if (playerIdx === -1 || playerIdx !== this.activePlayerIndex) return false;

    const player = this.players[playerIdx];
    this.clearTurnTimer();

    switch (action) {
      case 'fold':
        player.folded = true;
        player.lastActionText = 'Fold';
        player.reaction = getRandomMat('actions', 'fold');
        this.addLog(`${player.name} сфолдил: "${player.reaction}"`);
        break;

      case 'check':
        if (player.currentBet < this.currentBet) {
          return false; // Can't check if there's a bet to call
        }
        player.lastActionText = 'Check';
        player.reaction = getRandomMat('actions', 'check');
        this.addLog(`${player.name} чекнул.`);
        break;

      case 'call': {
        const callAmount = this.currentBet - player.currentBet;
        this.postBet(playerIdx, callAmount);
        player.lastActionText = 'Call';
        player.reaction = getRandomMat('actions', 'call');
        this.addLog(`${player.name} уравнял.`);
        break;
      }

      case 'raise': {
        const totalTarget = Math.max(this.currentBet * 2, raiseAmount);
        const needed = totalTarget - player.currentBet;
        this.postBet(playerIdx, needed);
        this.currentBet = player.currentBet;
        if (player.isAllIn) {
          player.lastActionText = 'All-in!';
          player.reaction = getRandomMat('actions', 'all_in');
          this.addLog(`${player.name} ЕБАНУЛ ALL-IN ${player.currentBet}!`);
        } else {
          player.lastActionText = `Raise ${this.currentBet}`;
          player.reaction = getRandomMat('actions', 'raise');
          this.addLog(`${player.name} повысил до ${this.currentBet}.`);
        }
        break;
      }
    }

    // Check if only 1 player remains
    const remaining = this.players.filter(p => !p.folded);
    if (remaining.length === 1) {
      this.endHandPrematurely();
      return true;
    }

    this.advanceBettingRound();
    return true;
  }

  advanceBettingRound() {
    // Check if round is complete (all non-folded, non-allin players have matched currentBet)
    const activeContenders = this.players.filter(p => !p.folded && !p.isAllIn);
    const allMatched = activeContenders.every(p => p.currentBet === this.currentBet);

    const nextIdx = this.getNextActivePlayerIndex(this.activePlayerIndex);

    // If everyone matched or everyone is all-in/folded
    if (allMatched && (nextIdx === -1 || this.hasEveryoneActedThisRound())) {
      this.nextStreet();
    } else {
      this.activePlayerIndex = nextIdx;
      this.startTurnTimer();
    }
  }

  hasEveryoneActedThisRound() {
    // Round is finished if everyone has either matched currentBet or folded/allin
    return this.players.filter(p => !p.folded && !p.isAllIn).every(p => p.currentBet === this.currentBet);
  }

  nextStreet() {
    // Reset round bets
    for (const p of this.players) {
      p.currentBet = 0;
      p.lastActionText = '';
    }
    this.currentBet = 0;

    if (this.state === 'PREFLOP') {
      this.state = 'FLOP';
      this.deck.pop(); // Burn card
      this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      this.addLog(`Флоп: ${this.board.map(c => c.code).join(' ')}`);
    } else if (this.state === 'FLOP') {
      this.state = 'TURN';
      this.deck.pop(); // Burn
      this.board.push(this.deck.pop());
      this.addLog(`Тёрн: ${this.board[3].code}`);
    } else if (this.state === 'TURN') {
      this.state = 'RIVER';
      this.deck.pop(); // Burn
      this.board.push(this.deck.pop());
      this.addLog(`Ривер: ${this.board[4].code}`);
    } else if (this.state === 'RIVER') {
      this.showdown();
      return;
    }

    // Find next player to act after dealer
    this.activePlayerIndex = this.getNextActivePlayerIndex(this.dealerIndex);

    const activeCanBet = this.players.filter(p => !p.folded && !p.isAllIn);
    if (activeCanBet.length <= 1) {
      // Auto-advance streets to river
      setTimeout(() => this.nextStreet(), 1500);
    } else {
      this.startTurnTimer();
    }
  }

  showdown() {
    this.state = 'SHOWDOWN';
    this.clearTurnTimer();

    const contenders = this.players.filter(p => !p.folded);
    if (contenders.length === 1) {
      this.awardPot([contenders[0]]);
      return;
    }

    // Format hands for pokersolver
    // Hand format: 'As', 'Kh', 'Td', etc
    const solvedHands = contenders.map(player => {
      const cards7 = [...player.cards, ...this.board].map(c => `${c.rank === '10' ? 'T' : c.rank}${SUIT_MAP[c.suit]}`);
      const hand = Hand.solve(cards7);
      hand.player = player;
      return hand;
    });

    const winnersHands = Hand.winners(solvedHands);
    const winners = winnersHands.map(h => h.player);

    const desc = winnersHands[0].descr;
    this.addLog(`Победил(и): ${winners.map(w => w.name).join(', ')} с комбинацией: ${desc}`);

    for (const p of this.players) {
      if (winners.some(w => w.id === p.id)) {
        p.reaction = getRandomMat('showdown', 'win');
      } else if (!p.folded) {
        p.reaction = getRandomMat('showdown', 'lose');
      }
    }

    this.awardPot(winners);
  }

  endHandPrematurely() {
    this.state = 'SHOWDOWN';
    this.clearTurnTimer();
    const remaining = this.players.filter(p => !p.folded);
    if (remaining.length > 0) {
      this.awardPot(remaining);
    }
  }

  awardPot(winners) {
    const share = Math.floor(this.pot / winners.length);
    for (const w of winners) {
      w.chips += share;
      w.lastActionText = `+${share} win!`;
    }
    this.pot = 0;

    // Check bust players
    for (const p of this.players) {
      if (p.chips <= 0) {
        p.reaction = getRandomMat('showdown', 'bust');
        this.addLog(`${p.name} банкрот!`);
      }
    }

    // Auto start next hand after 5s if host or automatic
    setTimeout(() => {
      const active = this.players.filter(p => p.chips > 0);
      if (active.length >= 2) {
        this.startHand();
      } else {
        this.state = 'LOBBY';
        this.addLog("Игра окончена! Недостаточно игроков с фишками.");
      }
    }, 6000);
  }

  startTurnTimer() {
    this.clearTurnTimer();
    this.turnEndTime = Date.now() + this.config.turnTime * 1000;
    this.timer = setTimeout(() => {
      // Time out!
      if (this.activePlayerIndex !== -1) {
        const player = this.players[this.activePlayerIndex];
        player.reaction = getRandomMat('actions', 'timeout');
        // If can check, check, else fold
        if (player.currentBet === this.currentBet) {
          this.handleAction(player.id, 'check');
        } else {
          this.handleAction(player.id, 'fold');
        }
      }
    }, this.config.turnTime * 1000);
  }

  clearTurnTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.turnEndTime = null;
  }

  getPublicState(forPlayerId) {
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      config: this.config,
      state: this.state,
      pot: this.pot,
      currentBet: this.currentBet,
      board: this.board,
      dealerIndex: this.dealerIndex,
      activePlayerIndex: this.activePlayerIndex,
      turnEndTime: this.turnEndTime,
      chatLogs: this.chatLogs.slice(-15),
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        chips: p.chips,
        currentBet: p.currentBet,
        folded: p.folded,
        isAllIn: p.isAllIn,
        reaction: p.reaction,
        lastActionText: p.lastActionText,
        // Only show cards if showdown or to the owner
        cards: (p.id === forPlayerId || (this.state === 'SHOWDOWN' && !p.folded)) ? p.cards : (p.cards.length > 0 ? [{ hidden: true }, { hidden: true }] : [])
      }))
    };
  }
}
