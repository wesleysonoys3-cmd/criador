/* Gerado pelo Game Studio (Three.js 0.149.0). Edite pelo proprio Game Studio para manter o historico. */
const GAME_CONFIG = {"title":"f10-qa Three","background":"#0b0f1a","playerColor":5209343,"enemyColor":16734810,"itemColor":16765286,"speed":340,"difficulty":"normal","extraEnemies":0};
(function () {
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
    el.innerHTML = (extra ? ('<b>' + extra + '</b><br>') : '') + base + '<br><span style="color:#94a3b8">WASD/setas mover · ESPACO pular</span>';
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
    if (items.length === 0) { done = true; setHud('VOCE VENCEU! Pontos: ' + score + ' — clique para jogar de novo'); return; }

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
