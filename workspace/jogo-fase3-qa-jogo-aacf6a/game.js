/* Gerado pelo Game Studio (Phaser 3.80.1). Edite pelo proprio Game Studio para manter o historico. */
const GAME_CONFIG = {"title":"Fase3 QA Jogo","background":"#0b0f1a","playerColor":5209343,"enemyColor":16734810,"itemColor":16765286,"speed":220,"difficulty":"normal","extraEnemies":0};
(function () {
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
