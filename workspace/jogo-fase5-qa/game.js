/* Gerado pelo Game Studio (Phaser 3.80.1). Edite pelo proprio Game Studio para manter o historico. */
const GAME_CONFIG = {"title":"Fase5 QA","background":"#0b0f1a","playerColor":5209343,"enemyColor":16734810,"itemColor":16765286,"speed":220,"difficulty":"normal","extraEnemies":0};
(function () {
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
