/**
 * Dragon's World – Enemies Module
 *
 * Manages all four zones, their enemies, obstacles, eggs, and the central safe zone.
 *
 * Public API (window.Enemies):
 *   init(level)            – reset and populate all zones for the given level
 *   update(dt, player)     – advance simulation one frame (dt = seconds)
 *   draw(ctx, cam)         – render everything in world-space (cam = { x, y })
 *   getState()             – expose internal state for game-layer queries
 */

window.Enemies = (function () {

  // ─── Constants ─────────────────────────────────────────────────────────────

  var MAP_W = 2000, MAP_H = 2000;
  var CENTER_X = 1000, CENTER_Y = 1000;
  var MAX_PER_ZONE = 6;

  // Axis-aligned zones: each occupies one quadrant around the centre.
  var ZONES = {
    volcanic: { x:   50, y:   50, w: 900, h: 900 },  // top-left
    glacial:  { x: 1050, y:   50, w: 900, h: 900 },  // top-right
    canopy:   { x: 1050, y: 1050, w: 900, h: 900 },  // bottom-right
    reef:     { x:   50, y: 1050, w: 900, h: 900 },  // bottom-left
  };

  // ─── Runtime state (rebuilt on every init) ─────────────────────────────────

  var S = {};   // S is the live state object

  function resetState(level) {
    var speedMult = Math.pow(1.25, level - 1); // +25 % per level

    S = {
      level:       level,
      speedMult:   speedMult,
      time:        0,
      playerMoved: false,
      prevPX: null, prevPY: null,
      prevAbilityCooldown: 0,

      // ── Safe zone ──────────────────────────────────────────────────────────
      safeZone: {
        x: CENTER_X, y: CENTER_Y,
        radius:          120,
        uses:            0,
        maxUses:         3,
        active:          true,
        playerWasInside: false,
      },

      // ── Volcanic Wastes ────────────────────────────────────────────────────
      volcanic: {
        enemies:      [],   // Magmawyrms
        lavaTrails:   [],   // { x, y, radius, life, maxLife }
        geysers:      [],   // { x, y, radius, timer, erupting, eruptDur }
        speedTimer:   0,    // counts toward next +15 % speed boost
        visualPhase:  0,    // fast pulse phase (radians)
        egg: { x: 250, y: 250, collected: false },
      },

      // ── Glacial Peaks ──────────────────────────────────────────────────────
      glacial: {
        enemies:       [],  // Frostwyrms
        frozenTiles:   [],  // { x, y, w, h }
        iceBullets:    [],  // { x, y, vx, vy, radius, alive }
        bulletCooldown: 0,
        egg: { x: 1800, y: 250, collected: false, thawTimer: 0, thawRequired: 2 },
      },

      // ── Ancient Canopy ─────────────────────────────────────────────────────
      canopy: {
        enemies:            [],   // Thornwyrms
        obstacles:          [],   // { x, y, r }
        multiplyTimer:      0,
        teleportTimer:      0,
        teleportRange:      150,  // grows +50 every 5 s
        escalateTimer:      0,
        escalateWave:       0,    // how many extras added each interval (1→2→3)
        visualPhase:        0,
        egg: { x: 0, y: 0, collected: false, _visible: false, _host: null },
      },

      // ── Sunken Reef ────────────────────────────────────────────────────────
      reef: {
        enemies:       [],  // Tidewyrms
        obstacles:     [],  // { x, y, vx, vy, r }
        multiplyTimer: 0,
        waveTimer:     0,
        waveComplexity: 0,
        wavePhase:     0,
        visualPhase:   0,
        egg: { x: 0, y: 0, vx: 0, vy: 0, collected: false },
      },
    };
  }

  // ─── Enemy factories ────────────────────────────────────────────────────────

  function makeMagmawyrm(x, y, sizeMult, extraSpeed) {
    sizeMult   = sizeMult   || 1;
    extraSpeed = extraSpeed || 1;
    var base = 60 * S.speedMult * extraSpeed;
    return {
      type: 'magmawyrm', x: x, y: y,
      radius: 20 * sizeMult, sizeMult: sizeMult,
      baseSpeed: base, speed: base, speedBoostMult: 1,
      color: '#ff2200',
      alive: true, frozen: true,
      trailTimer: 0, activeEffects: [],
    };
  }

  function makeFrostwyrm(x, y) {
    return {
      type: 'frostwyrm', x: x, y: y,
      radius: 24, speed: 30 * S.speedMult,
      color: '#ddeeff',
      alive: true, frozen: true,
      expandTimer: 0, expandRadius: 50,
      activeEffects: [],
    };
  }

  function makeThornwyrm(x, y) {
    return {
      type: 'thornwyrm', x: x, y: y,
      radius: 16, speed: 80 * S.speedMult,
      color: '#2d8a00',
      alive: true, frozen: true,
      visible: false, lunging: false,
      lungeVx: 0, lungeVy: 0,
      teleportRange: S.canopy.teleportRange,
      activeEffects: [],
    };
  }

  function makeTidewyrm(x, y, waveOffset) {
    return {
      type: 'tidewyrm', x: x, y: y,
      radius: 14, speed: 70 * S.speedMult,
      color: '#00e5b0',
      alive: true, frozen: true,
      waveOffset: waveOffset || 0,
      activeEffects: [],
    };
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  function init(level) {
    resetState(level);
    _initVolcanic();
    _initGlacial();
    _initCanopy();
    _initReef();
  }

  function _initVolcanic() {
    var z = ZONES.volcanic;
    S.volcanic.enemies.push(makeMagmawyrm(z.x + z.w / 2, z.y + z.h / 2));

    // Five geysers at fixed grid positions
    [[200, 200], [700, 200], [450, 450], [200, 700], [700, 700]].forEach(function (pos) {
      S.volcanic.geysers.push({
        x: z.x + pos[0], y: z.y + pos[1],
        radius: 28,
        timer: Math.random() * 5,   // stagger initial eruptions
        erupting: false,
        eruptDur: 1.5,
      });
    });
  }

  function _initGlacial() {
    var z = ZONES.glacial;
    var fw = makeFrostwyrm(z.x + z.w / 2, z.y + z.h / 2);
    S.glacial.enemies.push(fw);

    // Seed a few initial frozen tiles around the frostwyrm
    for (var i = 0; i < 6; i++) {
      var ang = (i / 6) * Math.PI * 2;
      S.glacial.frozenTiles.push({
        x: fw.x + Math.cos(ang) * 50 - 20,
        y: fw.y + Math.sin(ang) * 50 - 20,
        w: 40, h: 40,
      });
    }
  }

  function _initCanopy() {
    // Start with 2 Thornwyrms
    for (var i = 0; i < 2; i++) { _spawnThornwyrm(); }
    // Initial cluster of obstacles
    _addCanopyObstacles(5);
    _assignCanopyEgg();
  }

  function _spawnThornwyrm() {
    if (_aliveCount('canopy') >= MAX_PER_ZONE) return;
    var z = ZONES.canopy;
    var tw = makeThornwyrm(
      z.x + 120 + Math.random() * (z.w - 240),
      z.y + 120 + Math.random() * (z.h - 240)
    );
    tw.frozen = !S.playerMoved;
    S.canopy.enemies.push(tw);
  }

  function _addCanopyObstacles(count) {
    var z = ZONES.canopy;
    for (var i = 0; i < count; i++) {
      S.canopy.obstacles.push({
        x: z.x + 80 + Math.random() * (z.w - 160),
        y: z.y + 80 + Math.random() * (z.h - 160),
        r: 35 + Math.random() * 25,
      });
    }
  }

  function _assignCanopyEgg() {
    var obs = S.canopy.obstacles;
    if (!obs.length) return;
    var host = obs[Math.floor(Math.random() * obs.length)];
    S.canopy.egg._host = host;
    S.canopy.egg.x = host.x;
    S.canopy.egg.y = host.y;
  }

  function _initReef() {
    var z = ZONES.reef;

    // Three Tidewyrms spread across zone, evenly offset in wave
    for (var i = 0; i < 3; i++) {
      S.reef.enemies.push(makeTidewyrm(
        z.x + 200 + Math.random() * (z.w - 400),
        z.y + 200 + Math.random() * (z.h - 400),
        (i / 3) * Math.PI * 2
      ));
    }

    // Four bouncing obstacles
    for (var j = 0; j < 4; j++) {
      var ang = Math.random() * Math.PI * 2;
      S.reef.obstacles.push({
        x: z.x + 120 + Math.random() * (z.w - 240),
        y: z.y + 120 + Math.random() * (z.h - 240),
        vx: Math.cos(ang) * 80,
        vy: Math.sin(ang) * 80,
        r: 28,
      });
    }

    // Drifting egg
    var ea = Math.random() * Math.PI * 2;
    S.reef.egg = {
      x: z.x + 200 + Math.random() * (z.w - 400),
      y: z.y + 200 + Math.random() * (z.h - 400),
      vx: Math.cos(ea) * 45, vy: Math.sin(ea) * 45,
      collected: false,
    };
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  function update(dt, player) {
    S.time += dt;

    // Detect first player movement; all enemies unfreeze on it
    if (!S.playerMoved) {
      if (S.prevPX !== null &&
          (player.x !== S.prevPX || player.y !== S.prevPY)) {
        S.playerMoved = true;
        _unfreezeAll();
      }
      S.prevPX = player.x;
      S.prevPY = player.y;
    }

    // Detect ability activation (cooldown jumps from 0 → positive)
    var abilityJustUsed = (S.prevAbilityCooldown === 0 && player.abilityCooldown > 0);
    S.prevAbilityCooldown = player.abilityCooldown;

    _updateSafeZone(player);

    if (S.playerMoved) {
      _updateVolcanic(dt, player, abilityJustUsed);
      _updateGlacial(dt, player);
      _updateCanopy(dt, player);
      _updateReef(dt, player);
    }

    // Advance visual phases
    S.volcanic.visualPhase += dt * 8;   // fast rhythm
    S.reef.visualPhase     += dt * 1.5; // slow rhythmic wave
    S.canopy.visualPhase   += dt * 3;
  }

  function _unfreezeAll() {
    ['volcanic', 'glacial', 'canopy', 'reef'].forEach(function (zk) {
      S[zk].enemies.forEach(function (e) { e.frozen = false; });
    });
  }

  // ── Safe zone ───────────────────────────────────────────────────────────────

  function _updateSafeZone(player) {
    var sz = S.safeZone;
    if (!sz.active) return;

    var dx = player.x - sz.x;
    var dy = player.y - sz.y;
    var inside = Math.sqrt(dx * dx + dy * dy) < sz.radius - player.radius;

    // Detect entry transition
    if (inside && !sz.playerWasInside) {
      sz.uses++;
      sz.radius *= 0.80; // shrink 20 %
      if (sz.uses >= sz.maxUses || sz.radius < 18) sz.active = false;
    }
    sz.playerWasInside = inside;
  }

  // ── Volcanic Wastes ─────────────────────────────────────────────────────────

  function _updateVolcanic(dt, player, abilityJustUsed) {
    var v = S.volcanic;

    // Speed boost: +15 % every 5 s
    v.speedTimer += dt;
    if (v.speedTimer >= 5) {
      v.speedTimer -= 5;
      v.enemies.forEach(function (e) {
        e.speedBoostMult *= 1.15;
        e.speed = e.baseSpeed * e.speedBoostMult;
      });
    }

    // Tick and cull lava trails; push player back from them
    v.lavaTrails.forEach(function (t) { t.life -= dt; });
    v.lavaTrails = v.lavaTrails.filter(function (t) { return t.life > 0; });
    v.lavaTrails.forEach(function (t) {
      var dx = player.x - t.x, dy = player.y - t.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < t.radius + player.radius && dist > 0) {
        // Push player out of lava
        player.x += (dx / dist) * (t.radius + player.radius - dist + 1);
        player.y += (dy / dist) * (t.radius + player.radius - dist + 1);
      }
    });

    // Geysers: erupt every 5 s, block movement while active
    v.geysers.forEach(function (g) {
      g.timer += dt;
      if (!g.erupting && g.timer >= 5)  { g.erupting = true;  g.timer = 0; }
      if ( g.erupting && g.timer >= g.eruptDur) { g.erupting = false; g.timer = 0; }

      if (g.erupting) {
        var dx = player.x - g.x, dy = player.y - g.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < g.radius + player.radius && dist > 0) {
          player.x += (dx / dist) * (g.radius + player.radius - dist + 1);
          player.y += (dy / dist) * (g.radius + player.radius - dist + 1);
        }
      }
    });

    var newSplits = [];
    _tickEffects(v.enemies, dt);

    v.enemies.forEach(function (e) {
      if (!e.alive || e.frozen) return;

      _chasePlayer(e, player, dt);

      // Drop lava trail every 0.3 s
      e.trailTimer += dt;
      if (e.trailTimer >= 0.3) {
        e.trailTimer = 0;
        v.lavaTrails.push({ x: e.x, y: e.y, radius: e.radius * 0.9, life: 5, maxLife: 5 });
      }

      // Split when player uses ability within 200 px
      if (abilityJustUsed) {
        var dx = player.x - e.x, dy = player.y - e.y;
        if (Math.sqrt(dx * dx + dy * dy) <= 200 && e.sizeMult > 0.4) {
          e.alive = false;
          if (_aliveCount('volcanic') + 2 <= MAX_PER_ZONE) {
            for (var s = 0; s < 2; s++) {
              var child = makeMagmawyrm(
                e.x + (Math.random() - 0.5) * e.radius * 2,
                e.y + (Math.random() - 0.5) * e.radius * 2,
                e.sizeMult * 0.6, 1.3
              );
              child.frozen = false;
              child.speedBoostMult = e.speedBoostMult;
              child.speed = child.baseSpeed * child.speedBoostMult;
              newSplits.push(child);
            }
          }
        }
      }
    });

    v.enemies = v.enemies.filter(function (e) { return e.alive; }).concat(newSplits);
    _blockFromSafeZone(v.enemies);
  }

  // ── Glacial Peaks ───────────────────────────────────────────────────────────

  function _updateGlacial(dt, player) {
    var g = S.glacial;
    var z = ZONES.glacial;

    _tickEffects(g.enemies, dt);

    g.enemies.forEach(function (e) {
      if (!e.alive || e.frozen) return;

      // Expand frozen territory outward every 1.5 s
      e.expandTimer += dt;
      if (e.expandTimer >= 1.5) {
        e.expandTimer = 0;
        var ang = Math.random() * Math.PI * 2;
        g.frozenTiles.push({
          x: e.x + Math.cos(ang) * e.expandRadius - 20,
          y: e.y + Math.sin(ang) * e.expandRadius - 20,
          w: 40, h: 40,
        });
        e.expandRadius = Math.min(e.expandRadius + 6, 220);
        // Frostwyrm drifts slowly (creeping feel)
        e.x += (Math.random() - 0.5) * 18;
        e.y += (Math.random() - 0.5) * 18;
        e.x = Math.max(z.x + e.radius, Math.min(z.x + z.w - e.radius, e.x));
        e.y = Math.max(z.y + e.radius, Math.min(z.y + z.h - e.radius, e.y));
      }

      // Ice bullet when player within 300 px
      g.bulletCooldown -= dt;
      if (g.bulletCooldown <= 0) {
        var bx = player.x - e.x, by = player.y - e.y;
        var dist = Math.sqrt(bx * bx + by * by);
        if (dist <= 300) {
          var spd = 210;
          g.iceBullets.push({
            x: e.x, y: e.y,
            vx: (bx / dist) * spd,
            vy: (by / dist) * spd,
            radius: 8, alive: true,
          });
          g.bulletCooldown = 2.0;
        } else {
          g.bulletCooldown = 0.5;
        }
      }
    });

    // Move and check ice bullets
    g.iceBullets.forEach(function (b) {
      if (!b.alive) return;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // Instant kill on player contact
      var dx = player.x - b.x, dy = player.y - b.y;
      if (Math.sqrt(dx * dx + dy * dy) <= player.radius + b.radius) {
        b.alive = false;
        player.activeEffects = player.activeEffects || [];
        // Signal instant death to the game layer
        player.activeEffects.push({ type: 'dead', duration: Infinity });
      }
      if (b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H) b.alive = false;
    });
    g.iceBullets = g.iceBullets.filter(function (b) { return b.alive; });

    // Frozen tiles: push player out if they step on one
    g.frozenTiles.forEach(function (t) {
      if (player.x > t.x - player.radius && player.x < t.x + t.w + player.radius &&
          player.y > t.y - player.radius && player.y < t.y + t.h + player.radius) {
        // Find closest escape direction and push
        var cx = player.x - (t.x + t.w / 2);
        var cy = player.y - (t.y + t.h / 2);
        var overlapX = (t.w / 2 + player.radius) - Math.abs(cx);
        var overlapY = (t.h / 2 + player.radius) - Math.abs(cy);
        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) {
            player.x += overlapX * (cx < 0 ? -1 : 1);
          } else {
            player.y += overlapY * (cy < 0 ? -1 : 1);
          }
        }
      }
    });

    // Glacial egg: thaw timer – player must stay within 30 px for 2 s
    var egg = g.egg;
    if (!egg.collected) {
      var ex = player.x - egg.x, ey = player.y - egg.y;
      if (Math.sqrt(ex * ex + ey * ey) <= player.radius + 30) {
        egg.thawTimer += dt;
        if (egg.thawTimer >= egg.thawRequired) egg.collected = true;
      } else {
        egg.thawTimer = Math.max(0, egg.thawTimer - dt * 0.5); // thaw progress fades slowly
      }
    }

    _blockFromSafeZone(g.enemies);
  }

  // ── Ancient Canopy ──────────────────────────────────────────────────────────

  function _updateCanopy(dt, player) {
    var c = S.canopy;
    var playerInCanopy = _inZone(player.x, player.y, ZONES.canopy);

    // Multiply silently every 10 s while player is in a different zone
    c.multiplyTimer += dt;
    if (!playerInCanopy && c.multiplyTimer >= 10) {
      c.multiplyTimer = 0;
      _spawnThornwyrm();
    }

    // Teleport range +50 px every 5 s
    c.teleportTimer += dt;
    if (c.teleportTimer >= 5) {
      c.teleportTimer = 0;
      c.teleportRange += 50;
      c.enemies.forEach(function (e) { e.teleportRange = c.teleportRange; });
    }

    // Obstacle escalation: after every 5 s add 1, then 2, then 3 new obstacles
    c.escalateTimer += dt;
    if (c.escalateTimer >= 5) {
      c.escalateTimer = 0;
      c.escalateWave = Math.min(c.escalateWave + 1, 3);
      _addCanopyObstacles(c.escalateWave);
      if (!c.egg._host) _assignCanopyEgg();
    }

    // Sudden random zone movement: small chance per frame to jolt obstacles
    if (Math.random() < dt * 0.8) {  // ~0.8 jolts per second on average
      c.obstacles.forEach(function (obs) {
        var z = ZONES.canopy;
        obs.x = Math.max(z.x + obs.r, Math.min(z.x + z.w - obs.r, obs.x + (Math.random() - 0.5) * 70));
        obs.y = Math.max(z.y + obs.r, Math.min(z.y + z.h - obs.r, obs.y + (Math.random() - 0.5) * 70));
      });
    }

    _tickEffects(c.enemies, dt);

    c.enemies.forEach(function (e) {
      if (!e.alive || e.frozen) return;

      var dx = player.x - e.x, dy = player.y - e.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // Reveal and lunge when player enters 150 px
      if (!e.visible && dist <= 150) {
        e.visible = true;
        e.lunging  = true;
        var ls = e.speed * 2.5;
        e.lungeVx = (dx / dist) * ls;
        e.lungeVy = (dy / dist) * ls;
      }

      if (e.lunging) {
        e.x += e.lungeVx * dt;
        e.y += e.lungeVy * dt;
        // End lunge when close to player
        var dx2 = player.x - e.x, dy2 = player.y - e.y;
        if (Math.sqrt(dx2 * dx2 + dy2 * dy2) <= e.radius + player.radius + 8) {
          e.lunging = false;
        }
        // Teleport if player escapes beyond teleportRange
        if (Math.sqrt(dx2 * dx2 + dy2 * dy2) > e.teleportRange) {
          var ang = Math.atan2(dy2, dx2);
          e.x = player.x - Math.cos(ang) * (e.teleportRange * 0.75);
          e.y = player.y - Math.sin(ang) * (e.teleportRange * 0.75);
        }
      } else if (e.visible) {
        _chasePlayer(e, player, dt);
      }

      // Keep in zone
      var z = ZONES.canopy;
      e.x = Math.max(z.x + e.radius, Math.min(z.x + z.w - e.radius, e.x));
      e.y = Math.max(z.y + e.radius, Math.min(z.y + z.h - e.radius, e.y));
    });

    // Sync egg to its host obstacle; mark visible only within 100 px
    var egg = c.egg;
    if (!egg.collected && egg._host) {
      egg.x = egg._host.x;
      egg.y = egg._host.y;
      var ex = player.x - egg.x, ey = player.y - egg.y;
      egg._visible = Math.sqrt(ex * ex + ey * ey) <= 100;
      if (egg._visible && Math.sqrt(ex * ex + ey * ey) <= player.radius + 18) {
        egg.collected = true;
      }
    }

    _blockFromSafeZone(c.enemies);
  }

  // ── Sunken Reef ─────────────────────────────────────────────────────────────

  function _updateReef(dt, player) {
    var r = S.reef;
    var z = ZONES.reef;

    // Multiply every 10 s
    r.multiplyTimer += dt;
    if (r.multiplyTimer >= 10) {
      r.multiplyTimer = 0;
      if (_aliveCount('reef') < MAX_PER_ZONE) {
        var tw = makeTidewyrm(
          z.x + 150 + Math.random() * (z.w - 300),
          z.y + 150 + Math.random() * (z.h - 300),
          Math.random() * Math.PI * 2
        );
        tw.frozen = false;
        r.enemies.push(tw);
      }
    }

    // Wave complexity increases every 5 s (up to 4 tiers)
    r.waveTimer += dt;
    if (r.waveTimer >= 5) {
      r.waveTimer = 0;
      r.waveComplexity = Math.min(r.waveComplexity + 1, 4);
    }

    r.wavePhase += dt;
    _tickEffects(r.enemies, dt);

    // Coordinated school wave movement
    var alive = r.enemies.filter(function (e) { return e.alive && !e.frozen; });
    var n = alive.length;
    alive.forEach(function (e, i) {
      var phase = r.wavePhase + e.waveOffset;
      var freq  = 0.8 + r.waveComplexity * 0.15;

      // Primary sweep ellipse across zone
      var tx = z.x + z.w / 2 + Math.cos(phase * freq) * (z.w * 0.36);
      var ty = z.y + z.h / 2 + Math.sin(phase * freq + (i / Math.max(n, 1)) * Math.PI * 2) * (z.h * 0.36);

      // Add harmonic layers for higher wave complexity
      if (r.waveComplexity >= 2) {
        tx += Math.sin(phase * 2.3 + i) * 80;
        ty += Math.cos(phase * 1.7 + i) * 80;
      }
      if (r.waveComplexity >= 3) {
        tx += Math.cos(phase * 3.1) * 45;
        ty += Math.sin(phase * 2.9) * 45;
      }
      if (r.waveComplexity >= 4) {
        tx += Math.sin(phase * 4.2 + i * 0.5) * 30;
        ty += Math.cos(phase * 3.8 - i * 0.5) * 30;
      }

      var dx = tx - e.x, dy = ty - e.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      e.x += (dx / dist) * e.speed * dt;
      e.y += (dy / dist) * e.speed * dt;
      e.x = Math.max(z.x + e.radius, Math.min(z.x + z.w - e.radius, e.x));
      e.y = Math.max(z.y + e.radius, Math.min(z.y + z.h - e.radius, e.y));
    });

    // Bouncing obstacles: move, wall-bounce, knock back player and enemies 40 px
    r.obstacles.forEach(function (obs) {
      obs.x += obs.vx * dt;
      obs.y += obs.vy * dt;

      if (obs.x - obs.r < z.x)       { obs.x = z.x + obs.r;       obs.vx =  Math.abs(obs.vx); }
      if (obs.x + obs.r > z.x + z.w) { obs.x = z.x + z.w - obs.r; obs.vx = -Math.abs(obs.vx); }
      if (obs.y - obs.r < z.y)       { obs.y = z.y + obs.r;       obs.vy =  Math.abs(obs.vy); }
      if (obs.y + obs.r > z.y + z.h) { obs.y = z.y + z.h - obs.r; obs.vy = -Math.abs(obs.vy); }

      _knockBack(player, obs, player.radius, 40);
      r.enemies.forEach(function (e) {
        if (e.alive) _knockBack(e, obs, e.radius, 40);
      });
    });

    // Drifting egg: bounces around, player catches on overlap
    var egg = r.egg;
    if (!egg.collected) {
      egg.x += egg.vx * dt;
      egg.y += egg.vy * dt;
      if (egg.x < z.x + 20)       { egg.x = z.x + 20;       egg.vx =  Math.abs(egg.vx); }
      if (egg.x > z.x + z.w - 20) { egg.x = z.x + z.w - 20; egg.vx = -Math.abs(egg.vx); }
      if (egg.y < z.y + 20)       { egg.y = z.y + 20;       egg.vy =  Math.abs(egg.vy); }
      if (egg.y > z.y + z.h - 20) { egg.y = z.y + z.h - 20; egg.vy = -Math.abs(egg.vy); }

      var ex = player.x - egg.x, ey = player.y - egg.y;
      if (Math.sqrt(ex * ex + ey * ey) <= player.radius + 18) egg.collected = true;
    }

    _blockFromSafeZone(r.enemies);
  }

  // ─── Draw ────────────────────────────────────────────────────────────────────

  function draw(ctx, cam) {
    ctx.save();
    ctx.translate(-cam.x, -cam.y);

    _drawZoneBackgrounds(ctx);
    _drawZoneLabels(ctx);
    _drawSafeZone(ctx);
    _drawVolcanic(ctx);
    _drawGlacial(ctx);
    _drawCanopy(ctx);
    _drawReef(ctx);

    ctx.restore();
  }

  // ── Zone backgrounds ────────────────────────────────────────────────────────

  function _drawZoneBackgrounds(ctx) {
    // Volcanic – fast flickering red pulse
    var vPulse = Math.sin(S.volcanic.visualPhase) * 0.06;
    var vz = ZONES.volcanic;
    ctx.fillStyle = 'rgba(180,28,0,' + (0.20 + vPulse) + ')';
    ctx.fillRect(vz.x, vz.y, vz.w, vz.h);
    // Stroke border with orange flicker
    ctx.strokeStyle = 'rgba(255,120,0,' + (0.40 + vPulse * 2) + ')';
    ctx.lineWidth = 3;
    ctx.strokeRect(vz.x, vz.y, vz.w, vz.h);

    // Glacial – pale cold static tint
    var gz = ZONES.glacial;
    ctx.fillStyle = 'rgba(160,210,255,0.11)';
    ctx.fillRect(gz.x, gz.y, gz.w, gz.h);
    ctx.strokeStyle = 'rgba(180,230,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(gz.x, gz.y, gz.w, gz.h);

    // Canopy – dark green
    var cz = ZONES.canopy;
    ctx.fillStyle = 'rgba(18,72,4,0.22)';
    ctx.fillRect(cz.x, cz.y, cz.w, cz.h);
    ctx.strokeStyle = 'rgba(60,160,0,0.30)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cz.x, cz.y, cz.w, cz.h);

    // Reef – slow bioluminescent pulse
    var reefPulse = (Math.sin(S.reef.visualPhase * Math.PI) + 1) / 2;
    var rz = ZONES.reef;
    ctx.fillStyle = 'rgba(0,100,140,' + (0.14 + reefPulse * 0.07) + ')';
    ctx.fillRect(rz.x, rz.y, rz.w, rz.h);
    ctx.strokeStyle = 'rgba(0,200,200,' + (0.25 + reefPulse * 0.15) + ')';
    ctx.lineWidth = 2;
    ctx.strokeRect(rz.x, rz.y, rz.w, rz.h);
  }

  // ── Zone labels – huge text, 10 % opacity ───────────────────────────────────

  function _drawZoneLabels(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    var labels = [
      { zone: ZONES.volcanic, lines: ['VOLCANIC', 'WASTES'],  color: '#ff4400' },
      { zone: ZONES.glacial,  lines: ['GLACIAL',  'PEAKS'],   color: '#aaddff' },
      { zone: ZONES.canopy,   lines: ['ANCIENT',  'CANOPY'],  color: '#5ddb3a' },
      { zone: ZONES.reef,     lines: ['SUNKEN',   'REEF'],    color: '#00e5c8' },
    ];

    labels.forEach(function (l) {
      ctx.fillStyle = l.color;
      // Font size fills the zone width for the longest line
      var maxChars = Math.max.apply(null, l.lines.map(function (s) { return s.length; }));
      var fontSize = Math.floor(l.zone.w / (maxChars * 0.55));
      ctx.font = 'bold ' + fontSize + 'px sans-serif';

      var lineH = fontSize * 1.05;
      var totalH = l.lines.length * lineH;
      var cx = l.zone.x + l.zone.w / 2;
      var cy = l.zone.y + l.zone.h / 2;

      l.lines.forEach(function (line, i) {
        ctx.fillText(line, cx, cy - totalH / 2 + i * lineH + lineH / 2);
      });
    });

    ctx.restore();
  }

  // ── Safe zone ────────────────────────────────────────────────────────────────

  function _drawSafeZone(ctx) {
    var sz = S.safeZone;
    if (!sz.active) return;

    var pulse = (Math.sin(S.time * 3) + 1) / 2; // 0 → 1

    // Radial glow
    var grad = ctx.createRadialGradient(sz.x, sz.y, sz.radius * 0.4, sz.x, sz.y, sz.radius * 1.4);
    grad.addColorStop(0, 'rgba(255,215,0,' + (0.30 + pulse * 0.25) + ')');
    grad.addColorStop(1, 'rgba(255,215,0,0)');
    ctx.beginPath();
    ctx.arc(sz.x, sz.y, sz.radius * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Inner fill
    ctx.beginPath();
    ctx.arc(sz.x, sz.y, sz.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,215,0,0.10)';
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255,215,0,' + (0.70 + pulse * 0.30) + ')';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Uses-remaining label
    ctx.fillStyle = 'rgba(255,215,0,0.80)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((sz.maxUses - sz.uses) + ' uses left', sz.x, sz.y);
  }

  // ── Volcanic draw ────────────────────────────────────────────────────────────

  function _drawVolcanic(ctx) {
    var v = S.volcanic;
    var flicker = Math.sin(S.volcanic.visualPhase * 1.7) * 0.25 + 0.75;

    // Lava trails
    v.lavaTrails.forEach(function (t) {
      var a = (t.life / t.maxLife) * 0.75;
      var grad = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.radius);
      grad.addColorStop(0, 'rgba(255,140,0,' + a + ')');
      grad.addColorStop(1, 'rgba(200,40,0,' + (a * 0.3) + ')');
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    // Geysers
    v.geysers.forEach(function (g) {
      if (g.erupting) {
        // Ground burst
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,170,0,0.90)';
        ctx.fill();
        // Upward jet
        ctx.save();
        ctx.strokeStyle = 'rgba(255,240,120,0.85)';
        ctx.lineWidth   = g.radius * 0.55;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(g.x, g.y);
        ctx.lineTo(g.x, g.y - 90);
        ctx.stroke();
        ctx.restore();
      } else {
        // Dormant vent
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.radius * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180,60,0,0.45)';
        ctx.fill();
      }
    });

    // Magmawyrms
    v.enemies.forEach(function (e) {
      if (!e.alive) return;
      // Flickering glow
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 1.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,60,0,' + (0.28 * flicker) + ')';
      ctx.fill();
      // Body
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.frozen ? '#777' : '#ff2200';
      ctx.fill();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });

    // Egg – cracked with lava glow
    _drawVolcanicEgg(ctx, v.egg);
  }

  function _drawVolcanicEgg(ctx, egg) {
    if (egg.collected) return;
    var gp = (Math.sin(S.time * 5) + 1) / 2;

    var grad = ctx.createRadialGradient(egg.x, egg.y, 2, egg.x, egg.y, 32);
    grad.addColorStop(0, 'rgba(255,110,0,' + (0.60 + gp * 0.40) + ')');
    grad.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.beginPath();
    ctx.arc(egg.x, egg.y, 32, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Shell
    ctx.beginPath();
    ctx.ellipse(egg.x, egg.y, 15, 20, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1000';
    ctx.fill();

    // Glowing cracks
    ctx.strokeStyle = 'rgba(255,110,0,' + (0.65 + gp * 0.35) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(egg.x - 4, egg.y - 10);
    ctx.lineTo(egg.x + 3, egg.y - 1);
    ctx.lineTo(egg.x - 4, egg.y + 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(egg.x + 5, egg.y - 8);
    ctx.lineTo(egg.x + 1, egg.y + 5);
    ctx.stroke();
  }

  // ── Glacial draw ─────────────────────────────────────────────────────────────

  function _drawGlacial(ctx) {
    var g = S.glacial;

    // Frozen tiles
    g.frozenTiles.forEach(function (t) {
      ctx.fillStyle = 'rgba(180,230,255,0.42)';
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.strokeStyle = 'rgba(140,210,255,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(t.x, t.y, t.w, t.h);
    });

    // Frostwyrms
    g.enemies.forEach(function (e) {
      if (!e.alive) return;
      // Eerie pale glow
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,240,255,0.18)';
      ctx.fill();
      // Body
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.frozen ? '#aaa' : '#ddeeff';
      ctx.fill();
      ctx.strokeStyle = '#aaddff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Ice bullets
    g.iceBullets.forEach(function (b) {
      if (!b.alive) return;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#88ccff';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    _drawGlacialEgg(ctx, g.egg);
  }

  function _drawGlacialEgg(ctx, egg) {
    if (egg.collected) return;

    // Ice encasing
    ctx.beginPath();
    ctx.arc(egg.x, egg.y, 28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(170,225,255,0.48)';
    ctx.fill();
    ctx.strokeStyle = '#aaddff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Egg inside the ice
    ctx.beginPath();
    ctx.ellipse(egg.x, egg.y, 11, 15, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#eaf5ff';
    ctx.fill();

    // Thaw progress arc
    if (egg.thawTimer > 0) {
      var prog = egg.thawTimer / egg.thawRequired;
      ctx.strokeStyle = 'rgba(255,170,50,0.90)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(egg.x, egg.y, 32, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Canopy draw ──────────────────────────────────────────────────────────────

  function _drawCanopy(ctx) {
    var c = S.canopy;

    // Dense foliage obstacles with dappled-light highlight
    c.obstacles.forEach(function (obs) {
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16,64,4,0.78)';
      ctx.fill();
      ctx.strokeStyle = '#2d8a00';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Dappled highlight
      ctx.beginPath();
      ctx.arc(obs.x - obs.r * 0.28, obs.y - obs.r * 0.28, obs.r * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80,200,0,0.18)';
      ctx.fill();
    });

    // Thornwyrms (drawn only when visible)
    c.enemies.forEach(function (e) {
      if (!e.alive || !e.visible) return;
      var alpha = e.lunging ? 1.0 : 0.88;
      // Body
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.frozen ? '#555' : ('rgba(45,138,0,' + alpha + ')');
      ctx.fill();
      ctx.strokeStyle = '#aaff44';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Thorns
      for (var i = 0; i < 6; i++) {
        var ang = (i / 6) * Math.PI * 2 + S.time * 1.5;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(ang) * e.radius, e.y + Math.sin(ang) * e.radius);
        ctx.lineTo(e.x + Math.cos(ang) * (e.radius + 9), e.y + Math.sin(ang) * (e.radius + 9));
        ctx.strokeStyle = '#aaff44';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    // Canopy egg (hidden inside obstacle, only visible within 100 px)
    var egg = c.egg;
    if (!egg.collected && egg._visible) {
      ctx.beginPath();
      ctx.ellipse(egg.x, egg.y, 13, 17, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2d5c00';
      ctx.fill();
      ctx.strokeStyle = '#aaff44';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Leaf vein
      ctx.strokeStyle = 'rgba(90,210,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(egg.x, egg.y - 13);
      ctx.bezierCurveTo(egg.x + 9, egg.y - 4, egg.x + 9, egg.y + 6, egg.x, egg.y + 13);
      ctx.stroke();
    }
  }

  // ── Reef draw ────────────────────────────────────────────────────────────────

  function _drawReef(ctx) {
    var r = S.reef;
    var z = ZONES.reef;
    var bioPulse = (Math.sin(S.reef.visualPhase * Math.PI) + 1) / 2;

    // Bioluminescent slow pulse overlay
    ctx.fillStyle = 'rgba(0,210,180,' + (bioPulse * 0.07) + ')';
    ctx.fillRect(z.x, z.y, z.w, z.h);

    // Bouncing obstacles
    r.obstacles.forEach(function (obs) {
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,110,130,0.72)';
      ctx.fill();
      ctx.strokeStyle = '#00e5c8';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Tidewyrms
    r.enemies.forEach(function (e) {
      if (!e.alive) return;
      // Bioluminescent aura
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,229,176,' + (0.12 + bioPulse * 0.14) + ')';
      ctx.fill();
      // Body
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.frozen ? '#777' : '#00e5b0';
      ctx.fill();
      ctx.strokeStyle = '#7dd6ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Drifting egg
    _drawReefEgg(ctx, r.egg, bioPulse);
  }

  function _drawReefEgg(ctx, egg, pulse) {
    if (egg.collected) return;
    // Pulsing glow
    ctx.beginPath();
    ctx.arc(egg.x, egg.y, 28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,229,200,' + (0.10 + pulse * 0.18) + ')';
    ctx.fill();
    // Shell
    ctx.beginPath();
    ctx.ellipse(egg.x, egg.y, 13, 17, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#a0eedc';
    ctx.fill();
    ctx.strokeStyle = '#00e5c8';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Drift arrow hint
    ctx.strokeStyle = 'rgba(0,229,200,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(egg.x, egg.y - 22);
    ctx.lineTo(egg.x, egg.y - 28);
    ctx.stroke();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Move enemy toward player, respecting freeze/stun/slow effects. */
  function _chasePlayer(enemy, player, dt) {
    if (enemy.frozen) return;
    var effs = enemy.activeEffects;
    for (var i = 0; effs && i < effs.length; i++) {
      if (effs[i].type === 'freeze' || effs[i].type === 'stun') return;
    }
    var speedMult = 1;
    for (var j = 0; effs && j < effs.length; j++) {
      if (effs[j].type === 'slow' || effs[j].type === 'permanentSlow') {
        speedMult *= effs[j].multiplier;
      }
    }
    var dx = player.x - enemy.x, dy = player.y - enemy.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    enemy.x += (dx / dist) * enemy.speed * speedMult * dt;
    enemy.y += (dy / dist) * enemy.speed * speedMult * dt;
  }

  /** Prevent enemies from entering the safe zone. */
  function _blockFromSafeZone(enemies) {
    var sz = S.safeZone;
    if (!sz.active) return;
    enemies.forEach(function (e) {
      if (!e.alive) return;
      var dx = e.x - sz.x, dy = e.y - sz.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var minD = sz.radius + e.radius;
      if (dist < minD) {
        e.x = sz.x + (dx / dist) * minD;
        e.y = sz.y + (dy / dist) * minD;
      }
    });
  }

  /** Knock an entity back 'distance' px away from a circular obstacle. */
  function _knockBack(entity, obs, entityRadius, distance) {
    var dx = entity.x - obs.x, dy = entity.y - obs.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dist < entityRadius + obs.r) {
      entity.x += (dx / dist) * distance;
      entity.y += (dy / dist) * distance;
    }
  }

  /** Tick down and prune finite active effects on a list of enemies. */
  function _tickEffects(enemies, dt) {
    enemies.forEach(function (e) {
      if (!e.activeEffects) return;
      for (var i = e.activeEffects.length - 1; i >= 0; i--) {
        var eff = e.activeEffects[i];
        if (eff.duration !== Infinity) {
          eff.duration -= dt;
          if (eff.duration <= 0) e.activeEffects.splice(i, 1);
        }
      }
    });
  }

  /** Returns true if (x, y) falls inside the given zone rectangle. */
  function _inZone(x, y, zone) {
    return x >= zone.x && x <= zone.x + zone.w &&
           y >= zone.y && y <= zone.y + zone.h;
  }

  /** Count living enemies in a named zone. */
  function _aliveCount(zoneName) {
    return S[zoneName].enemies.filter(function (e) { return e.alive; }).length;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {
    init:     init,
    update:   update,
    draw:     draw,
    /** Expose live state for game-layer queries (collision detection, win/loss, etc.) */
    getState: function () { return S; },
  };

}());
