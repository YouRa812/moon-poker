import React, { useState, useEffect, useRef } from 'react';
import { Peer } from 'peerjs';
import confetti from 'canvas-confetti';
import QRCode from 'qrcode';
import {
  Users, Volume2, VolumeX, Shield, Play, Settings, RefreshCw,
  QrCode, Share2, Flame, LogOut, ChevronUp, ChevronDown
} from 'lucide-react';
import { TexasHoldemRoom } from './pokerEngine';
import { getRandomMat } from './matEngine';

const AVATARS = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🦁', '🐯',
  '🐸', '🐵', '🐔', '🐧', '🦆', '🦅', '🦉', '🦇'
];

export default function App() {
  const [peer, setPeer] = useState(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('poker_name') || '');
  const [avatarIndex, setAvatarIndex] = useState(() => parseInt(localStorage.getItem('poker_avatar') || '0', 10));
  const [roomCodeInput, setRoomCodeInput] = useState('');
  
  // Settings for room creation
  const [config, setConfig] = useState({
    startingChips: 1000,
    smallBlind: 10,
    bigBlind: 20,
    turnTime: 30
  });

  const [gameState, setGameState] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [raiseVal, setRaiseVal] = useState(40);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showMatQuickMenu, setShowMatQuickMenu] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // References for Host P2P
  const roomRef = useRef(null); // TexasHoldemRoom instance
  const connsRef = useRef(new Map()); // peerId -> DataConnection
  const myConnToHostRef = useRef(null); // DataConnection to host (if client)

  // Initialize PeerJS
  useEffect(() => {
    const p = new Peer();
    setPeer(p);

    p.on('open', (id) => {
      setMyPeerId(id);
    });

    p.on('connection', (conn) => {
      // Incoming connection (HOST handles this)
      conn.on('open', () => {
        connsRef.current.set(conn.peer, conn);
      });

      conn.on('data', (data) => {
        handleHostIncomingMessage(conn.peer, data);
      });

      conn.on('close', () => {
        connsRef.current.delete(conn.peer);
        if (roomRef.current) {
          roomRef.current.removePlayer(conn.peer);
          broadcastHostState();
        }
      });
    });

    return () => p.destroy();
  }, []);

  // Save profile
  useEffect(() => {
    localStorage.setItem('poker_name', playerName);
    localStorage.setItem('poker_avatar', avatarIndex.toString());
  }, [playerName, avatarIndex]);

  // Generate QR code for room link
  const generateQrForRoom = (code) => {
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    QRCode.toDataURL(url).then(url => setQrCodeDataUrl(url)).catch(() => {});
  };

  // Check URL query for room code auto-fill
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('room');
    if (r) {
      setRoomCodeInput(r.toUpperCase());
    }
  }, []);

  // HOST Broadcast State
  const broadcastHostState = () => {
    if (!roomRef.current) return;
    const room = roomRef.current;

    // Update host's local game state
    setGameState(room.getPublicState(peer.id));

    // Send personalized state to each connected player
    for (const [peerId, conn] of connsRef.current.entries()) {
      if (conn.open) {
        conn.send({
          type: 'ROOM_STATE',
          state: room.getPublicState(peerId)
        });
      }
    }
  };

  // HOST Handler for player messages
  const handleHostIncomingMessage = (fromPeerId, msg) => {
    const room = roomRef.current;
    if (!room) return;

    if (msg.type === 'JOIN_REQUEST') {
      const added = room.addPlayer({
        id: fromPeerId,
        name: msg.playerName || 'Игрок',
        avatar: msg.avatar || 0
      });

      const conn = connsRef.current.get(fromPeerId);
      if (conn && conn.open) {
        if (added) {
          conn.send({ type: 'JOIN_SUCCESS', state: room.getPublicState(fromPeerId) });
          broadcastHostState();
        } else {
          conn.send({ type: 'JOIN_ERROR', error: 'Стол полон или ошибка входа' });
        }
      }
    } else if (msg.type === 'ACTION') {
      room.handleAction(fromPeerId, msg.action, msg.amount);
      broadcastHostState();
    } else if (msg.type === 'MAT_REACTION') {
      const p = room.players.find(pl => pl.id === fromPeerId);
      if (p) {
        p.reaction = msg.matText;
        room.addLog(`${p.name}: "${msg.matText}"`);
        broadcastHostState();
      }
    }
  };

  // Host creates room with 4-letter code as peer ID suffix or uses code
  const handleCreateRoom = () => {
    if (!playerName.trim()) return alert('Введи имя!');
    if (!peer) return alert('Инициализация сети...');

    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    // Create new room with host
    const hostPlayer = {
      id: peer.id,
      name: playerName,
      avatar: avatarIndex
    };

    const room = new TexasHoldemRoom(code, hostPlayer, config);
    roomRef.current = room;
    setIsHost(true);
    setGameState(room.getPublicState(peer.id));
    generateQrForRoom(peer.id);
  };

  // Client joins room by host's peer ID or code
  const handleJoinRoom = () => {
    if (!playerName.trim()) return alert('Введи имя!');
    if (!roomCodeInput.trim()) return alert('Введи код комнаты!');
    if (!peer) return alert('Инициализация сети...');

    const targetHostId = roomCodeInput.trim();
    const conn = peer.connect(targetHostId);
    myConnToHostRef.current = conn;

    conn.on('open', () => {
      conn.send({
        type: 'JOIN_REQUEST',
        playerName,
        avatar: avatarIndex
      });
    });

    conn.on('data', (data) => {
      if (data.type === 'JOIN_SUCCESS' || data.type === 'ROOM_STATE') {
        setGameState(data.state);
        setIsHost(false);

        // Win confetti
        const me = data.state.players.find(p => p.id === peer.id);
        if (data.state.state === 'SHOWDOWN' && me && me.lastActionText && me.lastActionText.includes('win')) {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        }
      } else if (data.type === 'JOIN_ERROR') {
        alert(data.error);
      }
    });

    conn.on('error', (err) => {
      alert('Ошибка подключения к комнате: ' + err.message);
    });
  };

  // Perform Poker Action
  const handleAction = (action, amount = 0) => {
    if (isHost) {
      if (roomRef.current) {
        roomRef.current.handleAction(peer.id, action, amount);
        broadcastHostState();
      }
    } else {
      if (myConnToHostRef.current && myConnToHostRef.current.open) {
        myConnToHostRef.current.send({
          type: 'ACTION',
          action,
          amount
        });
      }
    }
  };

  // Host starts game
  const handleStartGame = () => {
    if (isHost && roomRef.current) {
      roomRef.current.startHand();
      broadcastHostState();
    }
  };

  // Send Custom Mat
  const handleSendCustomMat = (text) => {
    if (isHost) {
      if (roomRef.current) {
        const p = roomRef.current.players.find(pl => pl.id === peer.id);
        if (p) {
          p.reaction = text;
          roomRef.current.addLog(`${p.name}: "${text}"`);
          broadcastHostState();
        }
      }
    } else {
      if (myConnToHostRef.current && myConnToHostRef.current.open) {
        myConnToHostRef.current.send({
          type: 'MAT_REACTION',
          matText: text
        });
      }
    }
    setShowMatQuickMenu(false);
  };

  // Current player info
  const myId = peer?.id;
  const me = gameState?.players?.find(p => p.id === myId);
  const isMyTurn = gameState && gameState.activePlayerIndex !== -1 &&
    gameState.players[gameState.activePlayerIndex]?.id === myId;
  const otherPlayers = gameState?.players?.filter(p => p.id !== myId) || [];

  // 1. Lobby / Start screen
  if (!gameState) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at 50% 20%, #1e1338 0%, #0d0f17 80%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        color: '#fff'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '420px',
          background: 'rgba(23, 27, 43, 0.85)',
          backdropFilter: 'blur(16px)',
          borderRadius: '24px',
          padding: '28px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: 'rgba(255, 75, 75, 0.15)',
              border: '1px solid rgba(255, 75, 75, 0.3)',
              color: '#ff5e5e',
              fontSize: '12px',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '12px'
            }}>
              <Flame size={15} /> 18+ Матерный Холдем
            </div>
            <h1 style={{
              margin: '0',
              fontSize: '28px',
              fontWeight: '800',
              background: 'linear-gradient(135deg, #ffffff 0%, #a5b4fc 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              MOON POKER
            </h1>
            <p style={{ margin: '6px 0 0', color: '#8e9bb5', fontSize: '14px' }}>
              Играй с друзьями на телефоне без установки!
            </p>
          </div>

          {/* Profile Setup */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#8e9bb5', marginBottom: '8px', fontWeight: '600' }}>
              Твой ник / имя:
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Например: Саня Олл-Ин"
              style={{
                width: '100%',
                background: '#121524',
                border: '1px solid #282e4b',
                borderRadius: '12px',
                padding: '12px 14px',
                color: '#fff',
                fontSize: '15px',
                outline: 'none'
              }}
            />
          </div>

          {/* Avatar Picker */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#8e9bb5', marginBottom: '8px', fontWeight: '600' }}>
              Выбери аватар:
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: '6px'
            }}>
              {AVATARS.map((av, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setAvatarIndex(idx)}
                  style={{
                    fontSize: '22px',
                    padding: '8px 0',
                    background: avatarIndex === idx ? 'rgba(129, 140, 248, 0.25)' : '#121524',
                    border: avatarIndex === idx ? '2px solid #818cf8' : '1px solid #232840',
                    borderRadius: '10px',
                    cursor: 'pointer'
                  }}
                >
                  {av}
                </button>
              ))}
            </div>
          </div>

          {/* Join with Code / Link */}
          <div style={{
            background: '#121524',
            padding: '16px',
            borderRadius: '16px',
            border: '1px solid #232840',
            marginBottom: '18px'
          }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#c3cde3', marginBottom: '10px' }}>
              Войти по коду комнаты:
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
                placeholder="Вставь ID / Код"
                style={{
                  flex: 1,
                  background: '#0a0c16',
                  border: '1px solid #2d3558',
                  borderRadius: '10px',
                  padding: '10px',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: '600',
                  textAlign: 'center',
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={handleJoinRoom}
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#fff',
                  padding: '0 20px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Войти
              </button>
            </div>
          </div>

          {/* Create Room Button & Config */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              type="button"
              onClick={handleCreateRoom}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: 'none',
                borderRadius: '14px',
                padding: '14px',
                color: '#fff',
                fontSize: '16px',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 8px 20px rgba(16, 185, 129, 0.3)'
              }}
            >
              <Play size={18} fill="#fff" /> Создать свою комнату
            </button>

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              style={{
                background: 'transparent',
                border: '1px solid #2d3558',
                borderRadius: '12px',
                padding: '10px',
                color: '#94a3b8',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <Settings size={15} /> Настройки фишек и блайндов
            </button>
          </div>
        </div>

        {/* Modal Settings */}
        {showSettingsModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px'
          }} onClick={() => setShowSettingsModal(false)}>
            <div style={{
              background: '#171b2b',
              padding: '24px',
              borderRadius: '24px',
              width: '100%',
              maxWidth: '380px',
              border: '1px solid #2d3558'
            }} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 18px', fontSize: '18px', fontWeight: '700' }}>Параметры стола</h3>
              
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#8e9bb5', marginBottom: '6px' }}>
                  Стартовый стек фишек:
                </label>
                <input
                  type="number"
                  value={config.startingChips}
                  onChange={e => setConfig({ ...config, startingChips: parseInt(e.target.value, 10) || 500 })}
                  style={{
                    width: '100%',
                    background: '#0d0f17',
                    border: '1px solid #282e4b',
                    borderRadius: '10px',
                    padding: '10px',
                    color: '#fff',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#8e9bb5', marginBottom: '6px' }}>
                    Small Blind:
                  </label>
                  <input
                    type="number"
                    value={config.smallBlind}
                    onChange={e => setConfig({ ...config, smallBlind: parseInt(e.target.value, 10) || 5 })}
                    style={{
                      width: '100%',
                      background: '#0d0f17',
                      border: '1px solid #282e4b',
                      borderRadius: '10px',
                      padding: '10px',
                      color: '#fff',
                      outline: 'none'
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#8e9bb5', marginBottom: '6px' }}>
                    Big Blind:
                  </label>
                  <input
                    type="number"
                    value={config.bigBlind}
                    onChange={e => setConfig({ ...config, bigBlind: parseInt(e.target.value, 10) || 10 })}
                    style={{
                      width: '100%',
                      background: '#0d0f17',
                      border: '1px solid #282e4b',
                      borderRadius: '10px',
                      padding: '10px',
                      color: '#fff',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#8e9bb5', marginBottom: '6px' }}>
                  Время на ход (секунд):
                </label>
                <select
                  value={config.turnTime}
                  onChange={e => setConfig({ ...config, turnTime: parseInt(e.target.value, 10) })}
                  style={{
                    width: '100%',
                    background: '#0d0f17',
                    border: '1px solid #282e4b',
                    borderRadius: '10px',
                    padding: '10px',
                    color: '#fff',
                    outline: 'none'
                  }}
                >
                  <option value={15}>15 сек (Блиц-разъёб)</option>
                  <option value={30}>30 сек (Стандарт)</option>
                  <option value={45}>45 сек (Вдумчивый)</option>
                  <option value={60}>60 сек (Для тугодумов)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                style={{
                  width: '100%',
                  background: '#4f46e5',
                  border: 'none',
                  color: '#fff',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 2. Table Screen (Moon Poker Style)
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'radial-gradient(ellipse at 50% 35%, #1d1838 0%, #0d0e15 70%, #08090d 100%)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Top Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(10, 11, 18, 0.7)',
        backdropFilter: 'blur(10px)',
        zIndex: 20
      }}>
        {/* Brand & Room Code */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#ffc837',
            boxShadow: '0 0 10px #ffc837'
          }} />
          <span style={{ fontWeight: '800', fontSize: '15px', letterSpacing: '-0.3px' }}>
            Moon Poker
          </span>
          <button
            type="button"
            onClick={() => {
              if (isHost) {
                setShowQrModal(true);
              } else {
                navigator.clipboard?.writeText(window.location.href);
                alert('Ссылка скопирована!');
              }
            }}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: '700',
              color: '#a5b4fc',
              marginLeft: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <QrCode size={13} /> {isHost ? 'QR / ПРИГЛАСИТЬ' : 'КОД: ' + gameState.roomCode}
          </button>
        </div>

        {/* Right tools */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setShowMatQuickMenu(!showMatQuickMenu)}
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              padding: '4px 10px',
              borderRadius: '14px',
              fontSize: '12px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer'
            }}
          >
            <Flame size={14} /> МАТ
          </button>
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
          >
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>
      </div>

      {/* Quick Mat Popover */}
      {showMatQuickMenu && (
        <div style={{
          position: 'absolute',
          top: '52px',
          right: '12px',
          width: '260px',
          background: '#1a1f33',
          border: '1px solid #374169',
          borderRadius: '16px',
          padding: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '2px' }}>
            Быстрый высер в чат:
          </div>
          {[
            "Сука, где мои карты?!",
            "Опять наебалово ебаное!",
            "Ходи быстрее, чмоня!",
            "Всех раздену до трусов!",
            "В рот компот этот покер...",
            "ОЛЛ-ИН НАХУЙ!"
          ].map((m, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSendCustomMat(m)}
              style={{
                textAlign: 'left',
                background: '#111424',
                border: '1px solid #232a48',
                borderRadius: '8px',
                padding: '6px 10px',
                color: '#e2e8f0',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {/* Modal QR for Friend Invite */}
      {showQrModal && qrCodeDataUrl && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '20px'
        }} onClick={() => setShowQrModal(false)}>
          <div style={{
            background: '#1a1e33',
            padding: '24px',
            borderRadius: '24px',
            textAlign: 'center',
            border: '1px solid rgba(255,255,255,0.1)',
            maxWidth: '320px'
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>Пригласи друзей!</h3>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 14px' }}>
              Отсканируй камерой смартфона:
            </p>
            <img src={qrCodeDataUrl} alt="QR" style={{ width: '200px', height: '200px', borderRadius: '12px', background: '#fff', padding: '8px' }} />
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#cbd5e1', wordBreak: 'break-all' }}>
              ID: <b>{peer?.id}</b>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?room=${peer.id}`);
                alert('Ссылка скопирована!');
              }}
              style={{
                width: '100%',
                marginTop: '14px',
                background: '#4f46e5',
                border: 'none',
                color: '#fff',
                padding: '10px',
                borderRadius: '10px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Скопировать ссылку на вход
            </button>
          </div>
        </div>
      )}

      {/* Poker Table Area */}
      <div style={{
        flex: 1,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px 14px'
      }}>
        {/* Curved Table Arc Indicator */}
        <div style={{
          position: 'absolute',
          top: '18%',
          width: '92%',
          height: '65%',
          borderRadius: '50% / 35%',
          borderTop: '2px solid rgba(139, 92, 246, 0.35)',
          boxShadow: '0 -20px 40px rgba(139, 92, 246, 0.1)',
          pointerEvents: 'none'
        }} />

        {/* TOP: Opponents seated in an arc */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'flex-start',
          gap: '8px',
          zIndex: 10,
          minHeight: '110px'
        }}>
          {otherPlayers.map((player) => {
            const isTurn = gameState.activePlayerIndex !== -1 && gameState.players[gameState.activePlayerIndex]?.id === player.id;
            const isDealer = gameState.players[gameState.dealerIndex]?.id === player.id;

            return (
              <div
                key={player.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  position: 'relative',
                  width: '90px'
                }}
              >
                {/* Comic Mat Speech Bubble */}
                {player.reaction && (
                  <div
                    className="animate-shake"
                    style={{
                      position: 'absolute',
                      bottom: '95px',
                      background: '#ff2e56',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: '800',
                      padding: '4px 8px',
                      borderRadius: '10px',
                      whiteSpace: 'normal',
                      width: '130px',
                      textAlign: 'center',
                      boxShadow: '0 4px 12px rgba(255, 46, 86, 0.4)',
                      zIndex: 30,
                      lineHeight: '1.2'
                    }}
                  >
                    {player.reaction}
                    <div style={{
                      position: 'absolute',
                      bottom: '-6px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      borderLeft: '5px solid transparent',
                      borderRight: '5px solid transparent',
                      borderTop: '6px solid #ff2e56'
                    }} />
                  </div>
                )}

                {/* Status Badge */}
                {player.lastActionText && (
                  <div style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: player.folded ? '#f43f5e' : '#38bdf8',
                    marginBottom: '2px',
                    textTransform: 'uppercase'
                  }}>
                    {player.lastActionText}
                  </div>
                )}

                {/* Avatar with Turn glow and dealer badge */}
                <div style={{
                  position: 'relative',
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #2b3252 0%, #151828 100%)',
                  border: isTurn ? '3px solid #ffc837' : '2px solid rgba(255,255,255,0.15)',
                  boxShadow: isTurn ? '0 0 18px #ffc837' : '0 4px 12px rgba(0,0,0,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '26px'
                }}>
                  {AVATARS[player.avatar] || '👤'}

                  {isDealer && (
                    <div style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#fff',
                      color: '#000',
                      fontSize: '10px',
                      fontWeight: '900',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      D
                    </div>
                  )}

                  {/* Hidden Mini Cards */}
                  {player.cards && player.cards.length > 0 && !player.folded && (
                    <div style={{
                      position: 'absolute',
                      bottom: '-6px',
                      right: '-10px',
                      display: 'flex'
                    }}>
                      <div style={{
                        width: '16px',
                        height: '24px',
                        background: '#ffffff',
                        borderRadius: '3px',
                        border: '1px solid #94a3b8',
                        transform: 'rotate(-8deg)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
                      }} />
                      <div style={{
                        width: '16px',
                        height: '24px',
                        background: '#ffffff',
                        borderRadius: '3px',
                        border: '1px solid #94a3b8',
                        marginLeft: '-8px',
                        transform: 'rotate(10deg)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
                      }} />
                    </div>
                  )}
                </div>

                {/* Name & Chips */}
                <div style={{ fontSize: '13px', fontWeight: '700', marginTop: '6px', textAlign: 'center' }}>
                  {player.name}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  color: '#94a3b8',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>
                  🪙 {player.chips}
                </div>
                {player.currentBet > 0 && (
                  <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: '700' }}>
                    Ставка: {player.currentBet}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CENTER: Pot & Community Cards */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          zIndex: 10,
          margin: 'auto 0'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              fontSize: '13px',
              color: '#8b9bb4',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}>
              <span>🪙 Pot</span>
            </div>
            <div style={{
              fontSize: '44px',
              fontWeight: '900',
              letterSpacing: '-1px',
              color: '#ffffff',
              textShadow: '0 4px 20px rgba(0,0,0,0.8)'
            }}>
              {gameState.pot}
            </div>
          </div>

          {/* 5 Community Cards */}
          <div style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '76px'
          }}>
            {[0, 1, 2, 3, 4].map((idx) => {
              const card = gameState.board[idx];
              if (!card) {
                return (
                  <div
                    key={idx}
                    style={{
                      width: '48px',
                      height: '70px',
                      borderRadius: '8px',
                      border: '1.5px dashed rgba(255,255,255,0.12)',
                      background: 'rgba(255,255,255,0.02)'
                    }}
                  />
                );
              }
              const isRed = card.color === 'red';
              return (
                <div
                  key={idx}
                  style={{
                    width: '52px',
                    height: '74px',
                    background: '#ffffff',
                    borderRadius: '8px',
                    padding: '4px 6px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 8px 18px rgba(0,0,0,0.5)',
                    color: isRed ? '#dc2626' : '#111827',
                    fontWeight: '800',
                    transform: 'translateY(-2px)'
                  }}
                >
                  <div style={{ fontSize: '15px', lineHeight: 1 }}>{card.rank}</div>
                  <div style={{ fontSize: '24px', textAlign: 'center', lineHeight: 1 }}>{card.suit}</div>
                  <div style={{ fontSize: '11px', alignSelf: 'flex-end', lineHeight: 1 }}>{card.suit}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* BOTTOM: Current Player's Cards & Info */}
        {me && (
          <div style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: 15,
            width: '100%'
          }}>
            {/* My Reaction Comic Bubble */}
            {me.reaction && (
              <div
                className="animate-shake"
                style={{
                  position: 'absolute',
                  top: '-38px',
                  background: '#ff2e56',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: '800',
                  padding: '6px 12px',
                  borderRadius: '12px',
                  boxShadow: '0 4px 15px rgba(255, 46, 86, 0.5)',
                  zIndex: 30,
                  maxWidth: '280px',
                  textAlign: 'center'
                }}
              >
                {me.reaction}
                <div style={{
                  position: 'absolute',
                  bottom: '-6px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  borderLeft: '6px solid transparent',
                  borderRight: '6px solid transparent',
                  borderTop: '6px solid #ff2e56'
                }} />
              </div>
            )}

            {/* Two Cards angled exactly like in reference */}
            <div style={{
              position: 'relative',
              width: '150px',
              height: '110px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-end',
              marginBottom: '6px'
            }}>
              {me.cards && me.cards.length === 2 ? (
                <>
                  {/* Left Card */}
                  <div style={{
                    position: 'absolute',
                    width: '68px',
                    height: '98px',
                    background: '#ffffff',
                    borderRadius: '10px',
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.7)',
                    color: me.cards[0].color === 'red' ? '#dc2626' : '#111827',
                    fontWeight: '900',
                    transform: 'rotate(-10deg) translateX(-22px)',
                    zIndex: 2
                  }}>
                    <div style={{ fontSize: '18px', lineHeight: 1 }}>{me.cards[0].rank}</div>
                    <div style={{ fontSize: '32px', textAlign: 'center', lineHeight: 1 }}>{me.cards[0].suit}</div>
                    <div style={{ fontSize: '12px', alignSelf: 'flex-end', lineHeight: 1 }}>{me.cards[0].suit}</div>
                  </div>

                  {/* Right Card */}
                  <div style={{
                    position: 'absolute',
                    width: '68px',
                    height: '98px',
                    background: '#ffffff',
                    borderRadius: '10px',
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.7)',
                    color: me.cards[1].color === 'red' ? '#dc2626' : '#111827',
                    fontWeight: '900',
                    transform: 'rotate(10deg) translateX(22px)',
                    zIndex: 3
                  }}>
                    <div style={{ fontSize: '18px', lineHeight: 1 }}>{me.cards[1].rank}</div>
                    <div style={{ fontSize: '32px', textAlign: 'center', lineHeight: 1 }}>{me.cards[1].suit}</div>
                    <div style={{ fontSize: '12px', alignSelf: 'flex-end', lineHeight: 1 }}>{me.cards[1].suit}</div>
                  </div>
                </>
              ) : (
                <div style={{ color: '#64748b', fontSize: '13px', paddingBottom: '20px' }}>
                  Ожидание сдачи карт...
                </div>
              )}
            </div>

            {/* My Info Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              maxWidth: '380px',
              padding: '0 8px',
              marginBottom: '4px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '18px' }}>{AVATARS[me.avatar]}</span>
                <span style={{ fontWeight: '700', fontSize: '14px' }}>{me.name}</span>
                {me.currentBet > 0 && (
                  <span style={{
                    background: 'rgba(56, 189, 248, 0.2)',
                    color: '#38bdf8',
                    padding: '1px 6px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontWeight: '700'
                  }}>
                    Ставка: {me.currentBet}
                  </span>
                )}
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>Твой банк:</div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#fff' }}>
                  🪙 {me.chips}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER ACTION BAR */}
      <div style={{
        background: '#090a10',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 14px 16px',
        zIndex: 25
      }}>
        {gameState.state === 'LOBBY' ? (
          <div style={{ display: 'flex', gap: '10px' }}>
            {isHost ? (
              <button
                type="button"
                onClick={handleStartGame}
                disabled={gameState.players.length < 2}
                style={{
                  flex: 1,
                  background: gameState.players.length >= 2 ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#272f45',
                  border: 'none',
                  borderRadius: '14px',
                  padding: '14px',
                  color: '#fff',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: gameState.players.length >= 2 ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <Play size={18} fill="#fff" />
                {gameState.players.length >= 2 ? 'Раздать карты!' : 'Ждём игроков (мин. 2)'}
              </button>
            ) : (
              <div style={{
                flex: 1,
                textAlign: 'center',
                padding: '12px',
                color: '#94a3b8',
                fontSize: '14px',
                fontWeight: '600'
              }}>
                Ожидаем, пока хост начнёт раздачу...
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Raise Slider (if my turn) */}
            {isMyTurn && !me?.folded && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: '#121522',
                padding: '6px 12px',
                borderRadius: '12px'
              }}>
                <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>Рейз:</span>
                <input
                  type="range"
                  min={Math.max(gameState.currentBet * 2, gameState.config.bigBlind * 2)}
                  max={me.chips + me.currentBet}
                  step={gameState.config.bigBlind}
                  value={raiseVal}
                  onChange={(e) => setRaiseVal(parseInt(e.target.value, 10))}
                  style={{ flex: 1, accentColor: '#10b981', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '13px', fontWeight: '800', minWidth: '45px', textAlign: 'right' }}>
                  {raiseVal}
                </span>
              </div>
            )}

            {/* 3 Main Action Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* FOLD */}
              <button
                type="button"
                onClick={() => handleAction('fold')}
                disabled={!isMyTurn || me?.folded}
                style={{
                  flex: 1,
                  background: '#1a1824',
                  border: '1px solid #3b222a',
                  borderRadius: '12px',
                  padding: '14px 4px',
                  color: isMyTurn && !me?.folded ? '#f43f5e' : '#573b45',
                  fontSize: '15px',
                  fontWeight: '800',
                  cursor: isMyTurn && !me?.folded ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px'
                }}
              >
                <span>Fold</span>
                <span style={{ fontSize: '10px', fontWeight: '500', opacity: 0.7 }}>Сбросить</span>
              </button>

              {/* CHECK / CALL */}
              <button
                type="button"
                onClick={() => {
                  if (me.currentBet >= gameState.currentBet) {
                    handleAction('check');
                  } else {
                    handleAction('call');
                  }
                }}
                disabled={!isMyTurn || me?.folded}
                style={{
                  flex: 1,
                  background: '#131b2c',
                  border: '1px solid #1e3a5f',
                  borderRadius: '12px',
                  padding: '14px 4px',
                  color: isMyTurn && !me?.folded ? '#38bdf8' : '#314b68',
                  fontSize: '15px',
                  fontWeight: '800',
                  cursor: isMyTurn && !me?.folded ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px'
                }}
              >
                <span>{me?.currentBet >= gameState?.currentBet ? 'Check' : 'Call'}</span>
                <span style={{ fontSize: '10px', fontWeight: '500', opacity: 0.7 }}>
                  {me?.currentBet >= gameState?.currentBet ? 'Чекнуть' : `${gameState.currentBet - (me?.currentBet || 0)}`}
                </span>
              </button>

              {/* RAISE */}
              <button
                type="button"
                onClick={() => handleAction('raise', raiseVal)}
                disabled={!isMyTurn || me?.folded || me?.chips <= 0}
                style={{
                  flex: 1,
                  background: '#132420',
                  border: '1px solid #16533d',
                  borderRadius: '12px',
                  padding: '14px 4px',
                  color: isMyTurn && !me?.folded ? '#34d399' : '#285848',
                  fontSize: '15px',
                  fontWeight: '800',
                  cursor: isMyTurn && !me?.folded ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px'
                }}
              >
                <span>Raise</span>
                <span style={{ fontSize: '10px', fontWeight: '500', opacity: 0.7 }}>
                  {raiseVal >= me?.chips + me?.currentBet ? 'All-in!' : `до ${raiseVal}`}
                </span>
              </button>
            </div>

            {/* Turn Banner */}
            {isMyTurn && (
              <div style={{
                textAlign: 'center',
                background: 'rgba(234, 179, 8, 0.15)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                padding: '6px',
                borderRadius: '8px',
                color: '#facc15',
                fontSize: '13px',
                fontWeight: '700'
              }}>
                ⏳ Твой ход! Не тупи, ходи!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
