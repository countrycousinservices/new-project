/**
 * Dragon's World - Player Module
 * Defines the window.Player object managing player state, dragon selection, and abilities.
 */

window.Player = {
  // --- Core state ---
  x: 1000,
  y: 1000,
  radius: 12,
  speed: 3.5,
  facing: 0,          // angle in radians; 0 = right
  abilityCooldown: 0, // seconds remaining until ability can be used again
  activeEffects: [],  // array of { type, duration, ... } objects currently applied to the player

  // --- Dragon roster ---
  dragons: [
    {
      id: 1,
      name: 'Tidesong',
      color: '#00e5c8',
    },
    {
      id: 2,
      name: 'Verdenwing',
      color: '#5ddb3a',
    },
    {
      id: 3,
      name: 'Stormtalon',
      color: '#ffe033',
    },
    {
      id: 4,
      name: 'Shadowmend',
      color: '#c87aff',
    },
    {
      id: 5,
      name: 'Emberclaw',
      color: '#ff4400',
    },
    {
      id: 6,
      name: 'Frostfang',
      color: '#7dd6ff',
    },
  ],

  // Currently active dragon (set at level start; defaults to level 1 dragon)
  currentDragonId: 1,

  // --- Ability cooldown constant (seconds) ---
  ABILITY_COOLDOWN_DURATION: 10,

  // ---------------------------------------------------------------------------
  // Ability definitions (keyed by dragon id)
  // Each ability() receives the game state object so it can modify enemies, etc.
  // ---------------------------------------------------------------------------
  abilities: {
    /**
     * Tidesong – Slow Bubble
     * Slows all nearby enemies by 50% for 3 seconds.
     */
    1: function (game) {
      var SLOW_RADIUS = 200;
      var SLOW_AMOUNT = 0.5;
      var SLOW_DURATION = 3;

      game.enemies.forEach(function (enemy) {
        var dx = enemy.x - game.player.x;
        var dy = enemy.y - game.player.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= SLOW_RADIUS) {
          enemy.activeEffects = enemy.activeEffects || [];
          enemy.activeEffects.push({
            type: 'slow',
            multiplier: SLOW_AMOUNT,
            duration: SLOW_DURATION,
          });
        }
      });

      game.spawnVisualEffect({
        type: 'slowBubble',
        x: game.player.x,
        y: game.player.y,
        radius: SLOW_RADIUS,
        duration: 0.4,
        color: '#00e5c8',
      });
    },

    /**
     * Verdenwing – Invisibility + Decoy Clone
     * Makes the player invisible and spawns a decoy clone that attracts enemies for 4 seconds.
     */
    2: function (game) {
      var EFFECT_DURATION = 4;

      // Make player invisible for the ability duration
      game.player.activeEffects.push({
        type: 'invisible',
        duration: EFFECT_DURATION,
      });

      // Spawn a decoy that enemies will target
      game.spawnDecoy({
        x: game.player.x,
        y: game.player.y,
        duration: EFFECT_DURATION,
        color: '#5ddb3a',
        attractsEnemies: true,
      });
    },

    /**
     * Stormtalon – Lightning Dash
     * Dashes 300 px in the player's facing direction, leaving a lightning trail
     * that stuns any enemy it touches for 2 seconds.
     */
    3: function (game) {
      var DASH_DISTANCE = 300;
      var STUN_DURATION = 2;
      var TRAIL_WIDTH = 24;

      var startX = game.player.x;
      var startY = game.player.y;
      var endX = startX + Math.cos(game.player.facing) * DASH_DISTANCE;
      var endY = startY + Math.sin(game.player.facing) * DASH_DISTANCE;

      // Teleport player to dash destination
      game.player.x = endX;
      game.player.y = endY;

      // Stun enemies whose centres lie within the trail rectangle
      game.enemies.forEach(function (enemy) {
        if (isNearLineSegment(enemy.x, enemy.y, startX, startY, endX, endY, TRAIL_WIDTH)) {
          enemy.activeEffects = enemy.activeEffects || [];
          enemy.activeEffects.push({
            type: 'stun',
            duration: STUN_DURATION,
          });
        }
      });

      // Spawn lightning trail visual
      game.spawnVisualEffect({
        type: 'lightningTrail',
        x1: startX,
        y1: startY,
        x2: endX,
        y2: endY,
        width: TRAIL_WIDTH,
        duration: 0.6,
        color: '#ffe033',
      });
    },

    /**
     * Shadowmend – Gravity Pull + Freeze
     * Pulls all enemies to the player's position then freezes them for 5 seconds.
     */
    4: function (game) {
      var FREEZE_DURATION = 5;

      game.enemies.forEach(function (enemy) {
        // Snap enemy to player's centre
        enemy.x = game.player.x;
        enemy.y = game.player.y;

        enemy.activeEffects = enemy.activeEffects || [];
        enemy.activeEffects.push({
          type: 'freeze',
          duration: FREEZE_DURATION,
        });
      });

      game.spawnVisualEffect({
        type: 'gravityPull',
        x: game.player.x,
        y: game.player.y,
        duration: 0.8,
        color: '#c87aff',
      });
    },

    /**
     * Emberclaw – Fire Ring Knockback + Ground Fire
     * Knocks all enemies back 80 px from the player and leaves ground fire lasting 4 seconds.
     */
    5: function (game) {
      var KNOCKBACK_DISTANCE = 80;
      var FIRE_DURATION = 4;
      var RING_RADIUS = 160;

      game.enemies.forEach(function (enemy) {
        var dx = enemy.x - game.player.x;
        var dy = enemy.y - game.player.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var nx = dx / dist;
        var ny = dy / dist;
        enemy.x += nx * KNOCKBACK_DISTANCE;
        enemy.y += ny * KNOCKBACK_DISTANCE;
      });

      // Spawn persistent ground fire zone around the player's position
      game.spawnZone({
        type: 'groundFire',
        x: game.player.x,
        y: game.player.y,
        radius: RING_RADIUS,
        duration: FIRE_DURATION,
        color: '#ff4400',
        damagesEnemies: true,
      });

      game.spawnVisualEffect({
        type: 'fireRing',
        x: game.player.x,
        y: game.player.y,
        radius: RING_RADIUS,
        duration: 0.5,
        color: '#ff4400',
      });
    },

    /**
     * Frostfang – Mass Freeze + Permanent Slow
     * Freezes ALL enemies for 4 seconds and applies a permanent 30% slow for the rest of the level.
     */
    6: function (game) {
      var FREEZE_DURATION = 4;
      var PERMANENT_SLOW = 0.3; // 30 % speed reduction

      game.enemies.forEach(function (enemy) {
        enemy.activeEffects = enemy.activeEffects || [];

        // Freeze
        enemy.activeEffects.push({
          type: 'freeze',
          duration: FREEZE_DURATION,
        });

        // Permanent slow (duration of Infinity means "for the rest of the level")
        var alreadySlowed = enemy.activeEffects.some(function (e) {
          return e.type === 'permanentSlow';
        });
        if (!alreadySlowed) {
          enemy.activeEffects.push({
            type: 'permanentSlow',
            multiplier: 1 - PERMANENT_SLOW,
            duration: Infinity,
          });
        }
      });

      game.spawnVisualEffect({
        type: 'blizzard',
        x: game.player.x,
        y: game.player.y,
        duration: 1.0,
        color: '#7dd6ff',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns the dragon object for the currently active dragon.
   */
  getCurrentDragon: function () {
    var id = this.currentDragonId;
    return this.dragons.find(function (d) { return d.id === id; });
  },

  /**
   * Activates the current dragon's ability (call on SPACE key press).
   * @param {object} game - The game state / context object.
   */
  useAbility: function (game) {
    if (this.abilityCooldown > 0) return; // ability not ready

    var abilityFn = this.abilities[this.currentDragonId];
    if (!abilityFn) return;

    abilityFn(game);
    this.abilityCooldown = this.ABILITY_COOLDOWN_DURATION;
  },

  /**
   * Advances player state by one frame.
   * @param {number} dt - Delta time in seconds.
   */
  update: function (dt) {
    if (this.abilityCooldown > 0) {
      this.abilityCooldown = Math.max(0, this.abilityCooldown - dt);
    }

    // Tick down active effects on the player
    for (var i = this.activeEffects.length - 1; i >= 0; i--) {
      this.activeEffects[i].duration -= dt;
      if (this.activeEffects[i].duration <= 0) {
        this.activeEffects.splice(i, 1);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Module-level helper (not exposed on window)
// ---------------------------------------------------------------------------

/**
 * Returns true if point (px, py) is within `halfWidth` distance of the line
 * segment from (x1, y1) to (x2, y2).  Used by the Stormtalon dash trail.
 */
function isNearLineSegment(px, py, x1, y1, x2, y2, halfWidth) {
  var dx = x2 - x1;
  var dy = y2 - y1;
  var lenSq = dx * dx + dy * dy;

  var t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  var closestX = x1 + t * dx;
  var closestY = y1 + t * dy;

  var distX = px - closestX;
  var distY = py - closestY;
  return (distX * distX + distY * distY) <= (halfWidth * halfWidth);
}
