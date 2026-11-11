/* =========================================================
 * gamestudio/templates.js — Geradores de jogos 2D (Phaser 3)
 * ---------------------------------------------------------
 * Cada template produz um projeto estático (index.html + game.js
 * + README.md) com um jogo REALMENTE jogável, sem recursos
 * externos de imagem/som: as texturas são geradas em tempo de
 * execução pelo próprio Phaser (nenhum asset baixado).
 *
 * O comportamento do jogo é controlado por GAME_CONFIG no topo
 * do game.js, o que permite "editar jogo por comando" de forma
 * determinística (sem IA), reescrevendo apenas esse arquivo.
 * =======================================================*/

export const PHASER_VERSION = '3.80.1';
export const PHASER_CDN = 'https://cdn.jsdelivr.net/npm/phaser@' + PHASER_VERSION + '/dist/phaser.min.js';

/* Recursos externos usados — origem, versão e licença registradas. */
export const GAME_RESOURCES = [
  { name: 'Phaser 3', version: PHASER_VERSION, license: 'MIT', source: 'https://phaser.io', url: PHASER_CDN, type: 'engine-2d' },
];

/* =========================================================
 * FASE 5 — Controles do jogo (declarados e controláveis)
 * ---------------------------------------------------------
 * Cada jogo gerado declara os comandos que REALMENTE implementa
 * e aceita comandos virtuais vindos do Tiagente OS via postMessage
 * (a prévia roda isolada, em iframe com sandbox). Assim o OS só
 * mostra botões que executam ações reais; se o jogo não declarar
 * controles, o OS informa isso em vez de exibir botões falsos.
 * =======================================================*/
const GAME_KEYCODES = {
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Space: 32, KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, Enter: 13, Escape: 27,
};
const GAME_KEYNAMES = {
  ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowRight: 'ArrowRight', ArrowDown: 'ArrowDown',
  Space: ' ', KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', Enter: 'Enter', Escape: 'Escape',
};

/* Comandos por gênero (espelham exatamente o que cada template lê). */
const GAME_CONTROLS_2D = {
  plataforma: [
    { action: 'left', label: 'Esquerda', group: 'move', codes: ['ArrowLeft', 'KeyA'] },
    { action: 'right', label: 'Direita', group: 'move', codes: ['ArrowRight', 'KeyD'] },
    { action: 'jump', label: 'Pular', group: 'action', codes: ['Space', 'ArrowUp', 'KeyW'] },
  ],
  corrida: [
    { action: 'jump', label: 'Pular', group: 'action', codes: ['Space', 'ArrowUp'] },
  ],
  tiro: [
    { action: 'left', label: 'Esquerda', group: 'move', codes: ['ArrowLeft'] },
    { action: 'right', label: 'Direita', group: 'move', codes: ['ArrowRight'] },
    { action: 'shoot', label: 'Atirar', group: 'action', codes: ['Space'] },
  ],
  coleta: [
    { action: 'left', label: 'Esquerda', group: 'move', codes: ['ArrowLeft'] },
    { action: 'right', label: 'Direita', group: 'move', codes: ['ArrowRight'] },
  ],
};
const GAME_CONTROLS_3D = [
  { action: 'left', label: 'Esquerda', group: 'move', codes: ['ArrowLeft', 'KeyA'] },
  { action: 'right', label: 'Direita', group: 'move', codes: ['ArrowRight', 'KeyD'] },
  { action: 'up', label: 'Frente', group: 'move', codes: ['ArrowUp', 'KeyW'] },
  { action: 'down', label: 'Trás', group: 'move', codes: ['ArrowDown', 'KeyS'] },
  { action: 'jump', label: 'Pular', group: 'action', codes: ['Space'] },
];

export function controlsForGenre(genre, type) {
  if (type === '3d') return GAME_CONTROLS_3D.slice();
  return (GAME_CONTROLS_2D[genre] || GAME_CONTROLS_2D.plataforma).slice();
}

/* Ponte injetada no jogo: anuncia os controles e reproduz, como eventos
 * de teclado reais, os comandos recebidos da janela do Tiagente OS. */
export function gameControlBridge(genre, type) {
  const engine = type === '3d' ? 'threejs' : 'phaser';
  const controls = controlsForGenre(genre, type);
  return '<script>\n' +
    '(function () {\n' +
    '  var CONTROLS = ' + JSON.stringify(controls) + ';\n' +
    '  var META = { engine: ' + JSON.stringify(engine) + ', genre: ' + JSON.stringify(genre) + ' };\n' +
    '  var KEYCODE = ' + JSON.stringify(GAME_KEYCODES) + ';\n' +
    '  var KEYNAME = ' + JSON.stringify(GAME_KEYNAMES) + ';\n' +
    '  function makeEvent(type, code) {\n' +
    '    var ev;\n' +
    '    try { ev = new KeyboardEvent(type, { code: code, key: KEYNAME[code] || code, bubbles: true, cancelable: true }); }\n' +
    '    catch (e) { ev = document.createEvent("Event"); ev.initEvent(type, true, true); }\n' +
    '    var kc = KEYCODE[code] || 0;\n' +
    '    try { Object.defineProperty(ev, "keyCode", { get: function () { return kc; } }); } catch (e) {}\n' +
    '    try { Object.defineProperty(ev, "which", { get: function () { return kc; } }); } catch (e) {}\n' +
    '    return ev;\n' +
    '  }\n' +
    '  function announce() {\n' +
    '    try {\n' +
    '      (window.parent || window).postMessage({\n' +
    '        source: "tiagente-game", type: "ready", engine: META.engine, genre: META.genre, controls: CONTROLS\n' +
    '      }, "*");\n' +
    '    } catch (e) {}\n' +
    '  }\n' +
    '  window.addEventListener("message", function (e) {\n' +
    '    var d = e.data;\n' +
    '    if (!d || d.source !== "tiagente-os") return;\n' +
    '    if (d.type === "hello") { announce(); return; }\n' +
    '    if (d.type !== "control" || !d.codes) return;\n' +
    '    var type = d.down ? "keydown" : "keyup";\n' +
    '    for (var i = 0; i < d.codes.length; i++) {\n' +
    '      try { window.dispatchEvent(makeEvent(type, d.codes[i])); } catch (err) {}\n' +
    '    }\n' +
    '  });\n' +
    '  if (document.readyState === "complete") announce();\n' +
    '  else window.addEventListener("load", announce);\n' +
    '})();\n' +
    '</script>\n';
}

export const TEMPLATES = [
  { key: 'plataforma', label: 'Plataforma 2D', genre: 'plataforma', description: 'Pule entre plataformas, colete todas as moedas e evite os espinhos.' },
  { key: 'corrida', label: 'Corrida infinita 2D', genre: 'corrida', description: 'Corra sem parar, pule os obstáculos e sobreviva o máximo possível.' },
  { key: 'tiro', label: 'Tiro espacial 2D', genre: 'tiro', description: 'Mova a nave, atire nos inimigos e não deixe nenhum passar.' },
  { key: 'coleta', label: 'Coleta 2D', genre: 'coleta', description: 'Pegue os itens que caem e desvie dos perigos para somar pontos.' },
];

const COLOR_NAMES = {
  azul: 0x4f7cff, verde: 0x22c55e, vermelho: 0xef4444, amarelo: 0xeab308,
  roxo: 0x8b5cf6, laranja: 0xf97316, rosa: 0xec4899, ciano: 0x22d3ee,
  branco: 0xffffff, preto: 0x111827, cinza: 0x94a3b8, dourado: 0xffd166,
};

export function toColor(v, fallback = 0x4f7cff) {
  if (typeof v === 'number' && Number.isFinite(v)) return v & 0xffffff;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return fallback;
  if (COLOR_NAMES[s] !== undefined) return COLOR_NAMES[s];
  if (/^#?[0-9a-f]{6}$/.test(s)) return parseInt(s.replace('#', ''), 16) & 0xffffff;
  if (/^#?[0-9a-f]{3}$/.test(s)) {
    const h = s.replace('#', '');
    return parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16) & 0xffffff;
  }
  return fallback;
}

export function sanitizeColor(v, fallback = '#0b0f1a') {
  if (typeof v === 'number' && Number.isFinite(v)) return '#' + (v & 0xffffff).toString(16).padStart(6, '0');
  const s = String(v == null ? '' : v).trim();
  if (/^#[0-9a-fA-F]{3,6}$/.test(s)) return s.toLowerCase();
  if (COLOR_NAMES[s.toLowerCase()] !== undefined) return '#' + COLOR_NAMES[s.toLowerCase()].toString(16).padStart(6, '0');
  return fallback;
}

function clamp(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

function normalizeDifficulty(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'facil' || s === 'fácil') return 'facil';
  if (s === 'dificil' || s === 'difícil') return 'dificil';
  return 'normal';
}

export function templateByKey(key) {
  const k = String(key || '').toLowerCase();
  return TEMPLATES.find(t => t.key === k || t.genre === k) || null;
}

export function defaultConfig(genre, name) {
  const cfg = {
    title: String(name || 'Meu jogo 2D').slice(0, 80),
    background: '#0b0f1a',
    playerColor: 0x4f7cff,
    enemyColor: 0xff5a5a,
    itemColor: 0xffd166,
    speed: 220,
    difficulty: 'normal',
    extraEnemies: 0,
  };
  if (genre === 'corrida') cfg.speed = 300;
  if (genre === 'tiro') cfg.speed = 300;
  if (genre === 'coleta') cfg.speed = 260;
  return cfg;
}

/** Normaliza o objeto de configuração (usado antes de gravar/gerar). */
export function normalizeConfig(input) {
  const c = input && typeof input === 'object' ? input : {};
  return {
    title: String(c.title || 'Meu jogo 2D').replace(/[\r\n]+/g, ' ').slice(0, 80),
    background: sanitizeColor(c.background),
    playerColor: toColor(c.playerColor, 0x4f7cff),
    enemyColor: toColor(c.enemyColor, 0xff5a5a),
    itemColor: toColor(c.itemColor, 0xffd166),
    speed: Math.round(clamp(c.speed, 80, 900, 220)),
    difficulty: normalizeDifficulty(c.difficulty),
    extraEnemies: Math.round(clamp(c.extraEnemies, 0, 12, 0)),
  };
}

function configBlock(cfg) {
  const c = normalizeConfig(cfg);
  return 'const GAME_CONFIG = ' + JSON.stringify(c) + ';';
}

/* ---------------------------------------------------------
 * Corpos dos jogos (Phaser 3). Sem aspas invertidas, sem ${}
 * e sem escapes: são gravados como arquivos .js independentes.
 * --------------------------------------------------------- */

const BODY_PLATAFORMA = `(function () {
  var CFG = GAME_CONFIG;
  var W = 800, H = 600, WORLD_W = 2400;
  var scene = {
    key: 'main',
    create: function () {
      var self = this;
      this.cameras.main.setBackgroundColor(CFG.background);
      function tex(key, color, w, h) {
        var g = self.make.graphics({ add: false });
        g.fillStyle(color, 1); g.fillRect(0, 0, w, h); g.generateTexture(key, w, h); g.destroy();
      }
      tex('player', CFG.playerColor, 26, 34);
      tex('plat', 0x3b4b6b, 120, 20);
      tex('coin', CFG.itemColor, 16, 16);
      tex('spike', CFG.enemyColor, 24, 24);

      this.physics.world.setBounds(0, 0, WORLD_W, H);
      this.cameras.main.setBounds(0, 0, WORLD_W, H);

      var platforms = this.physics.add.staticGroup();
      var layout = [
        [0, 560, 900, 40], [300, 460, 160, 20], [560, 370, 150, 20],
        [840, 440, 170, 20], [1120, 350, 170, 20], [1400, 450, 160, 20],
        [1680, 360, 180, 20], [1960, 470, 180, 20], [2200, 560, 200, 40]
      ];
      for (var i = 0; i < layout.length; i++) {
        var L = layout[i];
        var p = platforms.create(L[0] + L[2] / 2, L[1] + L[3] / 2, 'plat');
        p.setDisplaySize(L[2], L[3]);
        p.refreshBody();
      }

      this.player = this.physics.add.sprite(60, 460, 'player');
      this.player.setCollideWorldBounds(true);
      this.player.setMaxVelocity(CFG.speed + 80, 900);
      this.physics.add.collider(this.player, platforms);

      this.coins = this.physics.add.group({ allowGravity: false, immovable: true });
      var cps = [[330, 420], [620, 330], [900, 400], [1180, 310], [1470, 410], [1750, 320], [2010, 430], [2280, 500]];
      for (var c = 0; c < cps.length; c++) { this.coins.create(cps[c][0], cps[c][1], 'coin'); }
      this.total = this.coins.getLength();

      this.spikes = this.physics.add.staticGroup();
      var nSpikes = 3 + CFG.extraEnemies;
      for (var s = 0; s < nSpikes; s++) {
        var sx = 470 + s * 250;
        if (sx < WORLD_W - 80) {
          var sp = this.spikes.create(sx, 546, 'spike');
          sp.setDisplaySize(24, 28); sp.refreshBody();
        }
      }

      this.score = 0; this.done = false;
      this.label = this.add.text(12, 12, '', { fontFamily: 'monospace', fontSize: '16px', color: '#e2e8f0' });
      this.label.setScrollFactor(0);
      this.hint = this.add.text(12, 34, 'Setas / A D para mover  ·  ESPACO para pular', { fontFamily: 'monospace', fontSize: '13px', color: '#94a3b8' });
      this.hint.setScrollFactor(0);

      var coins = this.coins;
      this.physics.add.overlap(this.player, coins, function (pl, coin) {
        coin.destroy(); self.score++; self.refreshLabel();
        if (coins.getLength() === 0 && !self.done) {
          self.done = true; self.player.setTint(0x22c55e); self.physics.pause();
          self.label.setText('VOCE VENCEU! Moedas: ' + self.score + ' - recarregue para jogar');
        }
      });
      this.physics.add.collider(this.player, this.spikes, function () {
        if (self.done) return;
        self.done = true; self.player.setTint(CFG.enemyColor); self.physics.pause();
        self.label.setText('FIM! Voce tocou em um perigo - recarregue para tentar');
      });

      this.cursors = this.input.keyboard.createCursorKeys();
      this.keys = this.input.keyboard.addKeys('A,D,W,SPACE');
      this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
      this.refreshLabel();
    },
    extend: {
      refreshLabel: function () {
        this.label.setText('Moedas: ' + this.score + ' / ' + this.total);
      }
    },
    update: function () {
      if (!this.player || this.done) return;
      var onGround = this.player.body.blocked.down || this.player.body.touching.down;
      var left = this.cursors.left.isDown || this.keys.A.isDown;
      var right = this.cursors.right.isDown || this.keys.D.isDown;
      var jump = this.cursors.up.isDown || this.keys.W.isDown || this.keys.SPACE.isDown;
      if (left) this.player.setVelocityX(-CFG.speed);
      else if (right) this.player.setVelocityX(CFG.speed);
      else this.player.setVelocityX(0);
      if (jump && onGround) this.player.setVelocityY(-520);
    }
  };
  new Phaser.Game({
    type: Phaser.AUTO, width: W, height: H, parent: 'game-root', backgroundColor: CFG.background,
    physics: { default: 'arcade', arcade: { gravity: { y: 900 }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene]
  });
})();
`;

const BODY_CORRIDA = `(function () {
  var CFG = GAME_CONFIG;
  var W = 800, H = 600, GROUND_Y = 500;
  var scene = {
    key: 'main',
    create: function () {
      var self = this;
      this.cameras.main.setBackgroundColor(CFG.background);
      function tex(key, color, w, h) {
        var g = self.make.graphics({ add: false });
        g.fillStyle(color, 1); g.fillRect(0, 0, w, h); g.generateTexture(key, w, h); g.destroy();
      }
      tex('player', CFG.playerColor, 30, 40);
      tex('block', CFG.enemyColor, 26, 44);
      tex('ground', 0x1f2a44, W, 100);

      this.ground = this.physics.add.staticImage(W / 2, GROUND_Y + 50, 'ground');
      this.ground.refreshBody();
      this.player = this.physics.add.sprite(120, GROUND_Y - 40, 'player');
      this.player.setCollideWorldBounds(true);
      this.physics.add.collider(this.player, this.ground);

      this.obstacles = this.physics.add.group({ allowGravity: false, immovable: true });
      this.gapMs = Math.max(600, (CFG.difficulty === 'dificil' ? 900 : (CFG.difficulty === 'facil' ? 1500 : 1150)) - CFG.extraEnemies * 70);
      this.speed = CFG.speed;
      this.spawnTimer = 900;
      this.score = 0; this.done = false;

      this.label = this.add.text(12, 12, '', { fontFamily: 'monospace', fontSize: '16px', color: '#e2e8f0' });
      this.hint = this.add.text(12, 34, 'ESPAÇO / seta ↑ para pular', { fontFamily: 'monospace', fontSize: '13px', color: '#94a3b8' });

      this.physics.add.overlap(this.player, this.obstacles, function () {
        if (self.done) return;
        self.done = true; self.player.setTint(CFG.enemyColor); self.physics.pause();
        self.label.setText('FIM! Distancia: ' + Math.floor(self.score) + ' - recarregue para tentar');
      });

      this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.cursors = this.input.keyboard.createCursorKeys();
      this.label.setText('Distancia: 0');
    },
    update: function (time, delta) {
      if (!this.player || this.done) return;
      var onGround = this.player.body.blocked.down || this.player.body.touching.down;
      if ((this.keySpace.isDown || (this.cursors.up && this.cursors.up.isDown)) && onGround) {
        this.player.setVelocityY(-580);
      }
      this.speed = Math.min(CFG.speed * 2.2, this.speed + delta * 0.03);
      this.score += delta * 0.05;

      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.gapMs;
        var ob = this.obstacles.create(W + 40, GROUND_Y - 22, 'block');
        ob.body.allowGravity = false;
        ob.setVelocityX(-this.speed);
      }
      var kids = this.obstacles.getChildren();
      for (var i = 0; i < kids.length; i++) {
        kids[i].setVelocityX(-this.speed);
        if (kids[i].x < -60) kids[i].destroy();
      }
      this.label.setText('Distancia: ' + Math.floor(this.score) + '   Velocidade: ' + Math.floor(this.speed));
    }
  };
  new Phaser.Game({
    type: Phaser.AUTO, width: W, height: H, parent: 'game-root', backgroundColor: CFG.background,
    physics: { default: 'arcade', arcade: { gravity: { y: 1200 }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene]
  });
})();
`;

const BODY_TIRO = `(function () {
  var CFG = GAME_CONFIG;
  var W = 800, H = 600;
  var scene = {
    key: 'main',
    create: function () {
      var self = this;
      this.cameras.main.setBackgroundColor(CFG.background);
      function tex(key, color, w, h) {
        var g = self.make.graphics({ add: false });
        g.fillStyle(color, 1); g.fillRect(0, 0, w, h); g.generateTexture(key, w, h); g.destroy();
      }
      tex('player', CFG.playerColor, 34, 26);
      tex('enemy', CFG.enemyColor, 28, 24);
      tex('bullet', CFG.itemColor, 5, 14);

      this.player = this.physics.add.sprite(W / 2, H - 50, 'player');
      this.player.setCollideWorldBounds(true);
      this.bullets = this.physics.add.group({ allowGravity: false });
      this.enemies = this.physics.add.group({ allowGravity: false });

      this.lives = 3; this.score = 0; this.done = false;
      this.label = this.add.text(12, 12, '', { fontFamily: 'monospace', fontSize: '15px', color: '#e2e8f0' });
      this.hint = this.add.text(12, 32, 'Setas ← → mover  ·  ESPACO atirar', { fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8' });

      var rows = 2 + Math.min(3, Math.floor(CFG.extraEnemies / 2));
      var cols = 5;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var e = this.enemies.create(110 + c * 130, 70 + r * 55, 'enemy');
          e.body.allowGravity = false;
          e.setVelocity((r % 2 === 0 ? 1 : -1) * (40 + CFG.extraEnemies * 8), 16 + CFG.extraEnemies * 3);
        }
      }

      this.physics.add.overlap(this.bullets, this.enemies, function (b, e) {
        b.destroy(); e.destroy(); self.score += 10; self.refresh();
        if (self.enemies.countActive(true) === 0 && !self.done) {
          self.done = true; self.physics.pause();
          self.label.setText('VOCE VENCEU! Pontos: ' + self.score + ' - recarregue para jogar');
        }
      });

      this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.cursors = this.input.keyboard.createCursorKeys();
      this.refresh();
    },
    extend: {
      refresh: function () {
        this.label.setText('Pontos: ' + this.score + '   Vidas: ' + this.lives);
      }
    },
    update: function () {
      if (!this.player || this.done) return;
      var v = CFG.speed * 1.6;
      if (this.cursors.left.isDown) this.player.setVelocityX(-v);
      else if (this.cursors.right.isDown) this.player.setVelocityX(v);
      else this.player.setVelocityX(0);

      if (Phaser.Input.Keyboard.JustDown(this.keySpace)) {
        var b = this.bullets.create(this.player.x, this.player.y - 22, 'bullet');
        b.setVelocityY(-520);
      }
      var bs = this.bullets.getChildren();
      for (var i = 0; i < bs.length; i++) if (bs[i].y < -20) bs[i].destroy();

      var es = this.enemies.getChildren();
      for (var j = 0; j < es.length; j++) {
        var e = es[j];
        if (e.x < 30) e.setVelocityX(Math.abs(e.body.velocity.x));
        if (e.x > W - 30) e.setVelocityX(-Math.abs(e.body.velocity.x));
        if (e.y > H - 90) {
          e.destroy(); this.lives--; this.refresh();
          if (this.lives <= 0 && !this.done) {
            this.done = true; this.physics.pause();
            this.label.setText('FIM! Pontos: ' + this.score + ' - recarregue para tentar');
          }
        }
      }
    }
  };
  new Phaser.Game({
    type: Phaser.AUTO, width: W, height: H, parent: 'game-root', backgroundColor: CFG.background,
    physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene]
  });
})();
`;

const BODY_COLETA = `(function () {
  var CFG = GAME_CONFIG;
  var W = 800, H = 600;
  var scene = {
    key: 'main',
    create: function () {
      var self = this;
      this.cameras.main.setBackgroundColor(CFG.background);
      function tex(key, color, w, h) {
        var g = self.make.graphics({ add: false });
        g.fillStyle(color, 1); g.fillRect(0, 0, w, h); g.generateTexture(key, w, h); g.destroy();
      }
      tex('player', CFG.playerColor, 46, 20);
      tex('good', CFG.itemColor, 20, 20);
      tex('bad', CFG.enemyColor, 22, 22);

      this.player = this.physics.add.sprite(W / 2, H - 40, 'player');
      this.player.setCollideWorldBounds(true);
      this.good = this.physics.add.group({ allowGravity: false });
      this.bad = this.physics.add.group({ allowGravity: false });

      this.score = 0; this.lives = 3; this.done = false;
      this.spawnTimer = 500;
      this.fallSpeed = CFG.speed;
      this.gapMs = Math.max(320, 780 - CFG.extraEnemies * 40);
      this.badChance = CFG.difficulty === 'dificil' ? 0.45 : (CFG.difficulty === 'facil' ? 0.2 : 0.32);

      this.label = this.add.text(12, 12, '', { fontFamily: 'monospace', fontSize: '15px', color: '#e2e8f0' });
      this.hint = this.add.text(12, 32, 'Setas ← → para mover  ·  pegue os itens claros', { fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8' });

      this.physics.add.overlap(this.player, this.good, function (pl, it) {
        it.destroy(); self.score += 10; self.refresh();
      });
      this.physics.add.overlap(this.player, this.bad, function (pl, it) {
        it.destroy(); self.lives--; self.refresh();
        if (self.lives <= 0 && !self.done) {
          self.done = true; self.physics.pause();
          self.label.setText('FIM! Pontos: ' + self.score + ' - recarregue para tentar');
        }
      });

      this.cursors = this.input.keyboard.createCursorKeys();
      this.refresh();
    },
    extend: {
      refresh: function () {
        this.label.setText('Pontos: ' + this.score + '   Vidas: ' + this.lives);
      }
    },
    update: function (time, delta) {
      if (!this.player || this.done) return;
      var v = CFG.speed * 1.6;
      if (this.cursors.left.isDown) this.player.setVelocityX(-v);
      else if (this.cursors.right.isDown) this.player.setVelocityX(v);
      else this.player.setVelocityX(0);

      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.gapMs;
        var isBad = Math.random() < this.badChance;
        var x = 60 + Math.random() * (W - 120);
        var it = isBad ? this.bad.create(x, -20, 'bad') : this.good.create(x, -20, 'good');
        it.body.allowGravity = false;
        it.setVelocityY(this.fallSpeed);
      }
      var groups = [this.good, this.bad];
      for (var g = 0; g < groups.length; g++) {
        var kids = groups[g].getChildren();
        for (var i = 0; i < kids.length; i++) {
          kids[i].setVelocityY(this.fallSpeed);
          if (kids[i].y > H + 30) kids[i].destroy();
        }
      }
    }
  };
  new Phaser.Game({
    type: Phaser.AUTO, width: W, height: H, parent: 'game-root', backgroundColor: CFG.background,
    physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene]
  });
})();
`;

const BODIES = {
  plataforma: BODY_PLATAFORMA,
  corrida: BODY_CORRIDA,
  tiro: BODY_TIRO,
  coleta: BODY_COLETA,
};

export function bodyFor(genre) {
  return BODIES[genre] || BODIES.plataforma;
}

/** game.js completo: cabeçalho + GAME_CONFIG + corpo do gênero. */
export function generateGameJs(genre, cfg, name) {
  const header = '/* Gerado pelo Game Studio (Phaser ' + PHASER_VERSION + '). ' +
    'Edite pelo proprio Game Studio para manter o historico. */\n';
  return header + configBlock(cfg) + '\n' + bodyFor(genre);
}

function htmlDoc(title, genre) {
  const t = String(title || 'Jogo 2D').replace(/[<>&"]/g, '').slice(0, 90);
  return '<!doctype html>\n' +
    '<html lang="pt-BR">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n' +
    '<meta name="generator" content="Tiagente Game Studio" data-game-genre="' + genre + '">\n' +
    '<title>' + t + '</title>\n' +
    '<style>html,body{margin:0;height:100%;background:' + sanitizeColor((genre && 0) || '#0b0f1a') + ';overflow:hidden}' +
    '#game-root{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f1a}</style>\n' +
    '<script src="' + PHASER_CDN + '"></script>\n' +
    '</head>\n' +
    '<body>\n' +
    '<div id="game-root"></div>\n' +
    gameControlBridge(genre, '2d') +
    '<script src="game.js"></script>\n' +
    '</body>\n' +
    '</html>\n';
}

function readmeDoc(name, genre) {
  return '# ' + String(name || 'Jogo 2D') + '\n\n' +
    'Jogo 2D (' + genre + ') gerado pelo **Game Studio** do Tiagente usando Phaser 3.\n\n' +
    '## Como executar\n' +
    '- Abra `index.html` no navegador, ou\n' +
    '- Use o botao **Pre-visualizar** no Game Studio.\n\n' +
    '## Controles\n' +
    '- Setas (ou A/D) para mover; ESPACO (ou seta ↑) para pular/atirar conforme o genero.\n\n' +
    '## Tecnologia\n' +
    '- Phaser ' + PHASER_VERSION + ' (licenca MIT) — https://phaser.io\n' +
    '- Texturas geradas em tempo de execucao: nenhum recurso externo de imagem/som.\n';
}

/** Projeto completo (todos os arquivos) para gravar no workspace. */
export function generateProject(genre, cfg, name) {
  const g = templateByKey(genre) ? templateByKey(genre).genre : 'plataforma';
  const c = normalizeConfig(Object.assign({}, cfg, { title: (cfg && cfg.title) || name || 'Meu jogo 2D' }));
  return {
    genre: g,
    config: c,
    files: {
      'index.html': htmlDoc(c.title, g),
      'game.js': generateGameJs(g, c, name),
      'README.md': readmeDoc(c.title, g),
    },
  };
}

/* =========================================================
 * ETAPA 4 — Game Studio 3D (Three.js)
 * ---------------------------------------------------------
 * Mesmo padrão dos jogos 2D: projeto estático (index.html +
 * game.js + README.md) com um jogo REALMENTE jogável, sem
 * assets externos (geometrias/materiais gerados em tempo de
 * execução). A cena é controlada por GAME_CONFIG com as MESMAS
 * chaves dos jogos 2D, o que permite "editar por comando" e os
 * ajustes rápidos já existentes funcionarem sem alterações.
 * =======================================================*/

export const THREE_VERSION = '0.149.0';
export const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION + '/build/three.min.js';

/* Recursos externos usados no 3D — origem, versão e licença registradas. */
export const GAME_RESOURCES_3D = [
  { name: 'Three.js', version: THREE_VERSION, license: 'MIT', source: 'https://threejs.org', url: THREE_CDN, type: 'engine-3d' },
];

export const TEMPLATES_3D = [
  { key: 'corrida3d', label: 'Corrida 3D', genre: 'corrida3d', engine: '3d', description: 'Conduza pelo cenário 3D, desvie dos obstáculos e colete os itens.' },
  { key: 'plataforma3d', label: 'Plataforma 3D', genre: 'plataforma3d', engine: '3d', description: 'Explore o cenário 3D com WASD, pule (ESPACO) e colete todos os itens.' },
  { key: 'exploracao3d', label: 'Exploração 3D', genre: 'exploracao3d', engine: '3d', description: 'Ande livremente pelo mundo 3D, colete itens e evite os inimigos.' },
];

export function templateByKey3D(key) {
  const k = String(key || '').toLowerCase();
  return TEMPLATES_3D.find(t => t.key === k || t.genre === k) || null;
}

export function defaultConfig3D(genre, name) {
  const cfg = {
    title: String(name || 'Meu jogo 3D').slice(0, 80),
    background: '#0b0f1a',
    playerColor: 0x4f7cff,
    enemyColor: 0xff5a5a,
    itemColor: 0xffd166,
    speed: 260,
    difficulty: 'normal',
    extraEnemies: 0,
  };
  if (genre === 'corrida3d') cfg.speed = 340;
  if (genre === 'exploracao3d') cfg.speed = 300;
  return cfg;
}

/** Normaliza a configuração 3D (mesmas chaves dos jogos 2D). */
export function normalizeConfig3D(input) {
  const c = input && typeof input === 'object' ? input : {};
  return {
    title: String(c.title || 'Meu jogo 3D').replace(/[\r\n]+/g, ' ').slice(0, 80),
    background: sanitizeColor(c.background),
    playerColor: toColor(c.playerColor, 0x4f7cff),
    enemyColor: toColor(c.enemyColor, 0xff5a5a),
    itemColor: toColor(c.itemColor, 0xffd166),
    speed: Math.round(clamp(c.speed, 80, 900, 260)),
    difficulty: normalizeDifficulty(c.difficulty),
    extraEnemies: Math.round(clamp(c.extraEnemies, 0, 12, 0)),
  };
}

function configBlock3D(cfg) {
  const c = normalizeConfig3D(cfg);
  return 'const GAME_CONFIG = ' + JSON.stringify(c) + ';';
}

/* ---------------------------------------------------------
 * Corpo do jogo 3D (Three.js). Sem aspas invertidas, sem ${}
 * e sem escapes: é gravado como arquivo game.js independente.
 * --------------------------------------------------------- */
const BODY_3D = `(function () {
  var CFG = GAME_CONFIG;
  var container = document.getElementById('game-root');
  var scene, camera, renderer, clock;
  var player, items, enemies;
  var keys = {};
  var score = 0, lives = 3, done = false, totalItems = 0;
  var vy = 0, onGround = true, loopId = 0, bound = false;
  var BOUND = 26, GRAVITY = 26, JUMP = 8.6, PLAYER_Y = 0.9;

  function W() { return container.clientWidth || 800; }
  function H() { return container.clientHeight || 600; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist2(a, b) { var dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }

  function hud() {
    var el = document.getElementById('gs3d-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gs3d-hud';
      el.style.cssText = 'position:absolute;left:12px;top:10px;font:13px/1.5 monospace;color:#e2e8f0;text-shadow:0 1px 2px #000;z-index:10;pointer-events:none';
      container.appendChild(el);
    }
    return el;
  }
  function setHud(extra) {
    var el = hud();
    var base = 'Pontos: ' + score + '   Vidas: ' + lives + '   Itens: ' + (totalItems - (items ? items.length : 0)) + '/' + totalItems;
    el.innerHTML = (extra ? ('<b>' + extra + '</b><br>') : '') + base + '<br><span style="color:#94a3b8">WASD/setas mover \u00b7 ESPACO pular</span>';
  }

  function onResize() {
    if (!renderer || !camera) return;
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  }

  function build() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CFG.background);
    scene.fog = new THREE.Fog(CFG.background, 45, 95);

    camera = new THREE.PerspectiveCamera(60, W() / H(), 0.1, 600);
    camera.position.set(0, 9, 15);
    camera.lookAt(0, 1, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W(), H());
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(14, 22, 10);
    scene.add(dir);
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x223044, 0.5));

    var ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshLambertMaterial({ color: 0x1f2a44 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    var grid = new THREE.GridHelper(100, 50, 0x3b4b6b, 0x243247);
    grid.position.y = 0.02;
    scene.add(grid);

    player = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.6), new THREE.MeshLambertMaterial({ color: CFG.playerColor }));
    player.position.set(0, PLAYER_Y, 0);
    scene.add(player);

    items = [];
    enemies = [];
    for (var i = 0; i < 8; i++) {
      var it = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshLambertMaterial({ color: CFG.itemColor }));
      it.position.set(rand(-BOUND, BOUND), 0.6, rand(-BOUND, BOUND));
      scene.add(it); items.push(it);
    }
    totalItems = items.length;

    var d = CFG.difficulty;
    var spd = (d === 'dificil' ? 1.6 : (d === 'facil' ? 0.7 : 1.1)) * (CFG.speed / 220);
    var nEnemies = 4 + CFG.extraEnemies;
    for (var e = 0; e < nEnemies; e++) {
      var en = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshLambertMaterial({ color: CFG.enemyColor }));
      en.position.set(rand(-BOUND, BOUND), 0.7, rand(-BOUND, BOUND));
      en.userData.vx = rand(-1, 1) * spd;
      en.userData.vz = rand(-1, 1) * spd;
      scene.add(en); enemies.push(en);
    }

    if (!bound) {
      bound = true;
      window.addEventListener('keydown', function (ev) {
        keys[ev.code] = true;
        if (ev.code === 'Space' || ev.code === 'ArrowUp' || ev.code === 'ArrowDown') ev.preventDefault();
      });
      window.addEventListener('keyup', function (ev) { keys[ev.code] = false; });
      window.addEventListener('resize', onResize);
      container.addEventListener('click', function () { if (done) restart(); });
    }
    setHud(null);
  }

  function step(dt) {
    if (!player) return;
    var v = (CFG.speed / 220) * 11;
    var mx = 0, mz = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
    if (keys['KeyW'] || keys['ArrowUp']) mz -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) mz += 1;
    player.position.x = Math.max(-BOUND, Math.min(BOUND, player.position.x + mx * v * dt));
    player.position.z = Math.max(-BOUND, Math.min(BOUND, player.position.z + mz * v * dt));

    if (keys['Space'] && onGround) { vy = JUMP; onGround = false; }
    vy -= GRAVITY * dt;
    player.position.y += vy * dt;
    if (player.position.y <= PLAYER_Y) { player.position.y = PLAYER_Y; vy = 0; onGround = true; }
    if (mx !== 0) player.rotation.y += mx * 2.4 * dt;

    for (var i = 0; i < enemies.length; i++) {
      var en = enemies[i];
      en.position.x += en.userData.vx * dt;
      en.position.z += en.userData.vz * dt;
      if (en.position.x > BOUND || en.position.x < -BOUND) en.userData.vx *= -1;
      if (en.position.z > BOUND || en.position.z < -BOUND) en.userData.vz *= -1;
    }

    for (var j = items.length - 1; j >= 0; j--) {
      var it = items[j];
      if (dist2(player.position, it.position) < 1.8) {
        scene.remove(it);
        it.geometry.dispose(); it.material.dispose();
        items.splice(j, 1);
        score += 10;
      }
    }
    if (items.length === 0) { done = true; setHud('VOCE VENCEU! Pontos: ' + score + ' \u2014 clique para jogar de novo'); return; }

    for (var k = 0; k < enemies.length; k++) {
      if (dist2(player.position, enemies[k].position) < 2.4) {
        lives--;
        player.position.set(0, PLAYER_Y, 0); vy = 0;
        if (lives <= 0) { done = true; setHud('FIM! Clique para tentar de novo'); return; }
        break;
      }
    }

    camera.position.set(player.position.x * 0.55, 9, player.position.z + 15);
    camera.lookAt(player.position.x * 0.55, 1, player.position.z);
    setHud(null);
  }

  function loop(myId) {
    if (myId !== loopId) return;
    var dt = Math.min(0.05, clock.getDelta());
    if (!done) step(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(function () { loop(myId); });
  }

  function restart() {
    loopId++;
    try { if (renderer) renderer.dispose(); } catch (e) {}
    container.innerHTML = '';
    keys = {};
    score = 0; lives = 3; done = false; vy = 0; onGround = true;
    build();
    clock = new THREE.Clock();
    loop(loopId);
  }

  build();
  clock = new THREE.Clock();
  loopId++;
  loop(loopId);
})();
`;

export function bodyFor3D(genre) { return BODY_3D; }

/** game.js 3D completo: cabeçalho + GAME_CONFIG + corpo Three.js. */
export function generateGameJs3D(genre, cfg, name) {
  const header = '/* Gerado pelo Game Studio (Three.js ' + THREE_VERSION + '). ' +
    'Edite pelo proprio Game Studio para manter o historico. */\n';
  return header + configBlock3D(cfg) + '\n' + BODY_3D;
}

function htmlDoc3D(title, genre) {
  const t = String(title || 'Jogo 3D').replace(/[<>&"]/g, '').slice(0, 90);
  return '<!doctype html>\n' +
    '<html lang="pt-BR">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n' +
    '<meta name="generator" content="Tiagente Game Studio" data-game-genre="' + genre + '" data-game-engine="threejs">\n' +
    '<title>' + t + '</title>\n' +
    '<style>html,body{margin:0;height:100%;background:#0b0f1a;overflow:hidden}' +
    '#game-root{position:relative;width:100vw;height:100vh;background:#0b0f1a}canvas{display:block}</style>\n' +
    '<script src="' + THREE_CDN + '"></script>\n' +
    '</head>\n' +
    '<body>\n' +
    '<div id="game-root"></div>\n' +
    gameControlBridge(genre, '3d') +
    '<script src="game.js"></script>\n' +
    '</body>\n' +
    '</html>\n';
}

function readmeDoc3D(name, genre) {
  return '# ' + String(name || 'Jogo 3D') + '\n\n' +
    'Jogo 3D (' + genre + ') gerado pelo **Game Studio** do Tiagente usando Three.js.\n\n' +
    '## Como executar\n' +
    '- Abra `index.html` no navegador, ou\n' +
    '- Use o botao **Pre-visualizar** no Game Studio.\n\n' +
    '## Controles\n' +
    '- WASD ou setas para mover; ESPACO para pular. Clique na tela para reiniciar apos o fim.\n\n' +
    '## Tecnologia\n' +
    '- Three.js ' + THREE_VERSION + ' (licenca MIT) — https://threejs.org\n' +
    '- Geometrias/materiais gerados em tempo de execucao: nenhum recurso externo de imagem/som.\n';
}

/** Projeto 3D completo (todos os arquivos) para gravar no workspace. */
export function generateProject3D(genre, cfg, name) {
  const tpl = templateByKey3D(genre);
  const g = tpl ? tpl.genre : 'plataforma3d';
  const c = normalizeConfig3D(Object.assign({}, cfg, { title: (cfg && cfg.title) || name || 'Meu jogo 3D' }));
  return {
    genre: g,
    type: '3d',
    config: c,
    files: {
      'index.html': htmlDoc3D(c.title, g),
      'game.js': generateGameJs3D(g, c, name),
      'README.md': readmeDoc3D(c.title, g),
    },
  };
}
