#!/usr/bin/env node
/**
 * 配置真源校验脚本
 *
 * 用途：校验 shared/config/*.json 的合法性与自洽性。
 *      服务端启动时也应调用同等校验逻辑（校验不过拒绝启动）。
 *
 * 用法：
 *   node tools/verify-config.js
 *
 * 退出码：0 = 全部通过，1 = 存在错误
 *
 * ⚠️ 本脚本只做校验，不修改任何文件。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.resolve(__dirname, '..', 'shared', 'config');

const errors = [];
const warnings = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function load(name) {
  const p = path.join(CONFIG_DIR, name);
  if (!fs.existsSync(p)) {
    err(`缺少配置文件：shared/config/${name}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    err(`shared/config/${name} JSON 解析失败：${e.message}`);
    return null;
  }
}

const waves = load('waves.json');
const weapons = load('weapons.json');
const enemies = load('enemies.json');
const allies = load('allies.json');
const gameplay = load('gameplay.json');

// ---------- waves.json ----------
if (waves) {
  // 铁律：四波总和必须恰好 200
  const sum = (waves.waves || []).reduce((a, w) => a + (w.enemyCount || 0), 0);
  if (sum !== 200) {
    err(`波次敌人总和 = ${sum}，必须恰好等于 200（PRD 2.3）`);
  }
  if (waves.totalEnemies !== 200) {
    err(`waves.totalEnemies = ${waves.totalEnemies}，必须为 200`);
  }
  if (sum !== waves.totalEnemies) {
    err(`各波之和(${sum}) 与 totalEnemies(${waves.totalEnemies}) 不一致`);
  }
  if ((waves.waves || []).length !== 4) {
    err(`波次数量 = ${(waves.waves || []).length}，必须为 4 波（30/50/60/60）`);
  }
  const expected = [30, 50, 60, 60];
  (waves.waves || []).forEach((w, i) => {
    if (w.enemyCount !== expected[i]) {
      err(`第 ${i + 1} 波 enemyCount = ${w.enemyCount}，PRD 规定为 ${expected[i]}`);
    }
    // 兵种占比之和应为 1
    const c = w.composition || {};
    const cSum = Object.values(c).reduce((a, b) => a + b, 0);
    if (Math.abs(cSum - 1) > 1e-6) {
      err(`第 ${i + 1} 波 composition 占比之和 = ${cSum.toFixed(3)}，必须为 1`);
    }
    // 兵种名必须在 enemies.units 中存在
    if (enemies) {
      Object.keys(c).forEach((k) => {
        if (!enemies.units || !enemies.units[k]) {
          err(`第 ${i + 1} 波引用了未定义兵种 "${k}"（enemies.json 中不存在）`);
        }
      });
    }
    // 命中率应递增
    if (i > 0) {
      const prev = waves.waves[i - 1].accuracy;
      if (w.accuracy < prev) {
        warn(`第 ${i + 1} 波 accuracy(${w.accuracy}) 低于上一波(${prev})，难度未递增`);
      }
    }
    // 波次起始时间不应超过总时长
    if (w.startSec >= waves.matchDurationSec) {
      err(`第 ${i + 1} 波 startSec=${w.startSec} >= 总时长 ${waves.matchDurationSec}，该波永远不会投放`);
    }
  });

  // 波次时间顺序
  for (let i = 1; i < (waves.waves || []).length; i++) {
    if (waves.waves[i].startSec <= waves.waves[i - 1].startSec) {
      err(`第 ${i + 1} 波 startSec 未晚于上一波`);
    }
  }

  if (waves.matchDurationSec !== 300) {
    err(`matchDurationSec = ${waves.matchDurationSec}，PRD 规定 5 分钟 = 300 秒`);
  }
  if (waves.maxAliveEnemies > 40) {
    err(`maxAliveEnemies = ${waves.maxAliveEnemies}，性能红线为 40`);
  }

  // 路线占比之和应为 1
  const rSum = Object.values(waves.routes || {}).reduce((a, r) => a + (r.enemyRatio || 0), 0);
  if (Math.abs(rSum - 1) > 1e-6) {
    err(`routes 的 enemyRatio 之和 = ${rSum.toFixed(3)}，必须为 1`);
  }

  // 最后一波能否投完（粗估）
  const last = (waves.waves || [])[(waves.waves || []).length - 1];
  if (last) {
    const squads = Math.ceil(last.enemyCount / last.squadSize);
    const need = (squads - 1) * last.squadIntervalSec;
    const left = waves.matchDurationSec - last.startSec;
    if (need > left) {
      err(`第 4 波投完需 ${need}s，但只剩 ${left}s，会有敌人投不出来`);
    }
  }
}

// ---------- weapons.json ----------
if (weapons) {
  const p = weapons.player || {};
  const defaults = Object.entries(p).filter(([, v]) => v.isDefault);
  if (defaults.length !== 1) {
    err(`玩家武器中标记 isDefault 的数量 = ${defaults.length}，必须恰好 1 把`);
  }
  Object.entries(p).forEach(([k, v]) => {
    if (v.camp !== 'cn' ) err(`玩家武器 ${k} 的 camp 应为 "cn"`);
    if (!v.isThrowable && !v.magazine) err(`玩家武器 ${k} 缺少 magazine`);
  });
  Object.entries(weapons.enemy || {}).forEach(([k, v]) => {
    if (v.camp !== 'jp') err(`日军武器 ${k} 的 camp 应为 "jp"`);
  });
  const hmg = (weapons.emplacement || {})['type92-hmg'];
  if (hmg) {
    if (hmg.allyBotCanUse !== false) {
      err('重机枪 allyBotCanUse 必须为 false（AI 队友不可使用，PRD 2.5）');
    }
    if (hmg.nestCount !== 2) {
      warn(`重机枪机位数 = ${hmg.nestCount}，PRD 规定 2 处`);
    }
  } else {
    err('缺少 emplacement.type92-hmg 定义');
  }
  const hp = weapons.hitPartMultiplier || {};
  ['head', 'torso', 'limb'].forEach((k) => {
    if (typeof hp[k] !== 'number') err(`hitPartMultiplier 缺少 ${k}`);
  });
}

// ---------- enemies.json ----------
if (enemies) {
  const r = enemies.sharedRules || {};
  if (r.hasMedkit !== false) err('日军 hasMedkit 必须为 false（敌方无血包，PRD 2.2）');
  if (r.canHeal !== false) err('日军 canHeal 必须为 false');
  if (r.canRespawn !== false) err('日军 canRespawn 必须为 false（被消灭即消失）');
  Object.entries(enemies.units || {}).forEach(([k, v]) => {
    if (!v.weapon) err(`敌方兵种 ${k} 缺少 weapon`);
    else if (weapons && !(weapons.enemy || {})[v.weapon]) {
      err(`敌方兵种 ${k} 引用了未定义武器 "${v.weapon}"`);
    }
  });
  const g = (enemies.performance || {}).aiUpdateGroups;
  if (!g || g < 2) warn(`aiUpdateGroups = ${g}，建议 ≥ 4 以分摊 AI 决策开销`);
}

// ---------- allies.json ----------
if (allies) {
  if (allies.seatCount !== 5) err(`seatCount = ${allies.seatCount}，必须为 5（五壮士）`);
  if ((allies.heroNames || []).length !== 5) {
    err(`heroNames 数量 = ${(allies.heroNames || []).length}，必须为 5`);
  }
  const b = allies.bot || {};
  if (b.canUseHMG !== false) err('AI 队友 canUseHMG 必须为 false（重机枪留给真人）');
  if (b.canPickupSupply !== false) err('AI 队友 canPickupSupply 必须为 false（不抢空投）');
  if (b.eligibleForMVP !== false) err('AI 队友 eligibleForMVP 必须为 false（MVP 只评真人）');
  if (b.canRespawn !== false) err('AI 队友 canRespawn 必须为 false');
  if (b.weapon && weapons && !(weapons.player || {})[b.weapon]) {
    err(`AI 队友引用了未定义武器 "${b.weapon}"`);
  }
  // 队友不能比玩家还猛
  if (weapons && b.weapon) {
    const w = (weapons.player || {})[b.weapon];
    if (w && b.fireRate > w.fireRate) {
      err(`AI 队友射速(${b.fireRate}) 高于武器本身(${w.fireRate})，会抢戏`);
    }
  }
  if (b.accuracy > 0.6) {
    warn(`AI 队友命中率 ${b.accuracy} 偏高，可能抢戏（M2 需实测歼敌占比 ≤ 50%）`);
  }
  // 布防分配总数应等于 队友数 = seatCount - 1
  const d = (allies.deployment || {}).defaultAssignment || {};
  const dSum = Object.values(d).reduce((a, n) => a + n, 0);
  if (dSum !== allies.seatCount - 1) {
    err(`布防分配总人数 = ${dSum}，应等于队友数 ${allies.seatCount - 1}`);
  }
  if (waves) {
    Object.keys(d).forEach((k) => {
      if (!(waves.routes || {})[k]) err(`布防引用了未定义路线 "${k}"`);
    });
  }
  const cal = allies.calibration || {};
  if (cal.maxKillRatio > 0.5) {
    err(`calibration.maxKillRatio = ${cal.maxKillRatio}，PRD 上限为 0.5`);
  }
}

// ---------- gameplay.json ----------
if (gameplay) {
  const p = gameplay.player || {};
  if (p.medkitCount !== 2) err(`玩家初始血包 = ${p.medkitCount}，PRD 规定 2 个`);
  if (p.canRespawn !== false) err('玩家 canRespawn 必须为 false（阵亡不复活，转观战）');
  if (p.naturalRegen !== 0) err('玩家 naturalRegen 必须为 0（只能靠血包）');
  if (p.aimPitchMinDeg !== -60 || p.aimPitchMaxDeg !== 60) {
    err(`玩家俯仰范围应为 -60°~60°，当前为 ${p.aimPitchMinDeg}°~${p.aimPitchMaxDeg}°`);
  }
  if (weapons && p.defaultLoadout) {
    const { primary, throwable } = p.defaultLoadout;
    if (primary && !(weapons.player || {})[primary]) {
      err(`默认主武器 "${primary}" 在 weapons.json 中不存在`);
    }
    if (throwable && !(weapons.player || {})[throwable]) {
      err(`默认投掷物 "${throwable}" 在 weapons.json 中不存在`);
    }
    if (weapons.player && weapons.player[primary] && !weapons.player[primary].isDefault) {
      err(`默认主武器 "${primary}" 在 weapons.json 中未标记 isDefault`);
    }
  }

  const server = gameplay.server || {};
  if (server.tickRateHz !== 20) {
    err(`server.tickRateHz = ${server.tickRateHz}，PRD 规定为 20Hz`);
  }
  if (
    !(server.maxSingleMatchCpuPercent > 0) ||
    server.maxSingleMatchCpuPercent > 100
  ) {
    err('server.maxSingleMatchCpuPercent 必须大于 0 且不超过 100');
  }

  const combat = gameplay.combat || {};
  if (!(combat.fireOriginToleranceM > 0)) {
    err('combat.fireOriginToleranceM 必须为正数');
  }
  if (
    !(combat.directionMagnitudeTolerance > 0) ||
    combat.directionMagnitudeTolerance >= 1
  ) {
    err('combat.directionMagnitudeTolerance 必须大于 0 且小于 1');
  }
  if (!(combat.enemyHitboxRadiusM > 0)) {
    err('combat.enemyHitboxRadiusM 必须为正数');
  }
  if (!(combat.enemyHitboxHeightM > 0)) {
    err('combat.enemyHitboxHeightM 必须为正数');
  }
  if (
    !(combat.defenderCoverExposureMultiplier > 0) ||
    combat.defenderCoverExposureMultiplier > 1
  ) {
    err('combat.defenderCoverExposureMultiplier 必须大于 0 且不超过 1');
  }
  if (
    !(combat.torsoHitboxStartM >= 0) ||
    !(combat.headHitboxStartM > combat.torsoHitboxStartM) ||
    !(combat.headHitboxStartM < combat.enemyHitboxHeightM)
  ) {
    err('combat 命中部位高度必须满足 0 ≤ torso < head < hitboxHeight');
  }

  const m = gameplay.match || {};
  if (m.durationSec !== 300) err(`match.durationSec = ${m.durationSec}，必须为 300`);
  if (waves && m.durationSec !== waves.matchDurationSec) {
    err(`gameplay.match.durationSec(${m.durationSec}) 与 waves.matchDurationSec(${waves.matchDurationSec}) 不一致`);
  }
  if (waves && m.deployPhaseSec !== waves.deployPhaseSec) {
    err(`部署阶段时长在 gameplay(${m.deployPhaseSec}) 与 waves(${waves.deployPhaseSec}) 中不一致`);
  }

  const md = gameplay.medkit || {};
  if (md.carriedUseSec !== 0) {
    err(`medkit.carriedUseSec = ${md.carriedUseSec}，立即生效规则要求为 0`);
  }
  if (md.carriedBlocksFire !== false) {
    err('medkit.carriedBlocksFire 必须为 false（使用血包不阻止开火）');
  }
  if (md.airdropOnlyForHumanPlayer !== true) {
    err('medkit.airdropOnlyForHumanPlayer 必须为 true（AI 队友不抢空投）');
  }

  const s = gameplay.score || {};
  if (s.mvpHumanOnly !== true) err('score.mvpHumanOnly 必须为 true');
  if (s.mvpRequiresAlive !== true) err('score.mvpRequiresAlive 必须为 true（阵亡不参评 MVP）');
  const wantTiebreak = ['kills', 'mgKills', 'survivalSec', 'accuracy'];
  if (JSON.stringify(s.tiebreakOrder) !== JSON.stringify(wantTiebreak)) {
    err(`MVP 平局判据顺序应为 ${wantTiebreak.join(' → ')}`);
  }

  const c = gameplay.compliance || {};
  const redlines = {
    noBlood: true, noGore: true, noHateSymbols: true,
    campSelectable: false, noPurchase: true, noExternalLinks: true,
  };
  Object.entries(redlines).forEach(([k, v]) => {
    if (c[k] !== v) err(`适龄合规红线 compliance.${k} 必须为 ${v}（PRD 设计红线）`);
  });
  if (c.forcedCamp !== 'cn') err('compliance.forcedCamp 必须为 "cn"（玩家只能加入中国军队）');
  if (c.enemyLabel !== '日军') err('compliance.enemyLabel 必须为「日军」（统一称谓）');

  const a = gameplay.arena || {};
  if (a.playerCanLeaveHill !== false) err('arena.playerCanLeaveHill 必须为 false（玩家不能下山）');
  if (!(a.itemPickupRangeM > 0)) {
    err('arena.itemPickupRangeM 必须为正数');
  }
  if (!(a.machineGunMountRangeM > 0)) {
    err('arena.machineGunMountRangeM 必须为正数');
  }
  const el = a.elements || {};
  if (allies && el.spawnPoints !== allies.seatCount) {
    err(`出生点数量(${el.spawnPoints}) 应等于席位数(${allies.seatCount})`);
  }
  if (weapons) {
    const nest = ((weapons.emplacement || {})['type92-hmg'] || {}).nestCount;
    if (nest !== undefined && el.mgNests !== nest) {
      err(`重机枪位数在 gameplay(${el.mgNests}) 与 weapons(${nest}) 中不一致`);
    }
  }
  if (waves && el.enemySpawnPoints !== Object.keys(waves.routes || {}).length) {
    err(`敌军刷新点数(${el.enemySpawnPoints}) 应等于路线数(${Object.keys(waves.routes || {}).length})`);
  }
  const ad = gameplay.airdrop || {};
  if (ad.pointCount !== el.supplyPoints) {
    err(`空投点数在 airdrop(${ad.pointCount}) 与 arena.elements(${el.supplyPoints}) 中不一致`);
  }
}

// ---------- 输出 ----------
console.log('');
if (warnings.length) {
  console.log(`⚠️  ${warnings.length} 条警告：`);
  warnings.forEach((m) => console.log(`   - ${m}`));
  console.log('');
}
if (errors.length) {
  console.log(`❌ ${errors.length} 条错误：`);
  errors.forEach((m) => console.log(`   - ${m}`));
  console.log('');
  console.log('配置校验未通过，服务端应拒绝启动。');
  process.exit(1);
}
console.log('✅ 配置校验全部通过');
console.log('   波次总和 200 ✓  五席位 ✓  队友约束 ✓  武器引用完整 ✓  合规红线 ✓');
process.exit(0);
