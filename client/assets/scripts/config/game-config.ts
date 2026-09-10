import { JsonAsset, resources } from 'cc';

import type { RouteId } from '../../../../shared/protocol';

export interface GameplayConfig {
  readonly player: {
    readonly maxHp: number;
    readonly moveSpeed: number;
    readonly crouchSpeed: number;
    readonly aimPitchMinDeg: number;
    readonly aimPitchMaxDeg: number;
    readonly defaultLoadout: {
      readonly primary: string;
      readonly throwable: string;
    };
  };
  readonly server: {
    readonly tickRateHz: number;
    /** 掉线后服务端保留席位的时长，客户端只用来在断网遮罩上显示倒计时。 */
    readonly reconnectGraceSec: number;
  };
  readonly combat: {
    readonly enemyHitboxRadiusM: number;
    readonly enemyHitboxHeightM: number;
    /** 服务端真人眼高 = (torso + head) / 2，客户端落地、观战都用同一算法。 */
    readonly headHitboxStartM: number;
    readonly torsoHitboxStartM: number;
  };
  readonly arena: {
    readonly widthM: number;
    readonly depthM: number;
    readonly itemPickupRangeM: number;
    readonly machineGunMountRangeM: number;
  };
  readonly medkit: {
    readonly carriedHeal: number;
  };
  readonly match: {
    readonly durationSec: number;
    readonly deployPhaseSec: number;
  };
}

/**
 * 真人玩家的眼高。服务端 m2-battle-session 以 (torso + head) / 2 建模真人
 * 位置（position 即眼睛），客户端把眼位落到脚底、或把脚底抬到眼位都走这里，
 * 保证两边口径一致，别再各自写 hitboxHeight / 2 之类的近似。
 */
export function playerEyeHeightM(gameplay: GameplayConfig): number {
  return (
    (gameplay.combat.torsoHitboxStartM + gameplay.combat.headHitboxStartM) / 2
  );
}

export interface WeaponPresentationConfig {
  readonly displayName: string;
  /** 投掷物（手榴弹）没有枪口，第一视角走「握在手里」的构图。 */
  readonly isThrowable?: boolean;
  readonly assets: {
    readonly firstPerson?: string;
    /**
     * 带手臂的第一视角整幅构图（已含倾角与透视）。有它时优先于
     * firstPerson 裸枪；图内枪口位置由 HANDS_COMPOSITIONS 实测给出。
     */
    readonly firstPersonHands?: string;
    /** 与 firstPersonHands 同坐标系的开火帧（自带枪口焰）。 */
    readonly firstPersonHandsFire?: string;
    readonly icon?: string;
  };
}

export interface WeaponsConfig {
  readonly player: Readonly<Record<string, WeaponPresentationConfig>>;
  readonly emplacement: Readonly<
    Record<
      string,
      {
        readonly displayName: string;
        readonly assets: {
          readonly firstPerson?: string;
          /**
           * 射手后视整幅图（枪身在画面下方正中、枪口指向准心）。
           * 有它时优先于 firstPerson 侧视裸枪；坐标由 HANDS_COMPOSITIONS 实测。
           */
          readonly firstPersonHands?: string;
          readonly firstPersonHandsFire?: string;
          readonly icon?: string;
        };
        readonly fireRate: number;
        readonly yawLimitDeg: number;
        readonly pitchMinDeg: number;
        readonly pitchMaxDeg: number;
      }
    >
  >;
}

export interface WavesConfig {
  readonly maxAliveEnemies: number;
  /** 下面四项只用于开场动员文案，数值以服务端为准。 */
  readonly totalEnemies: number;
  readonly matchDurationSec: number;
  readonly intermissionSec: number;
  readonly waves: ReadonlyArray<{ readonly index: number }>;
  readonly routes: Readonly<
    Record<
      RouteId,
      {
        readonly name: string;
        readonly lengthM: number;
      }
    >
  >;
}

export interface AlliesAssetsConfig {
  /** 席位总数（含玩家）。房间 UI 要按它排席位行，不能写死 5。 */
  readonly seatCount: number;
  readonly heroNames: readonly string[];
  readonly bot: {
    readonly assets: {
      readonly sprite: string;
    };
    readonly heroSprites?: Readonly<Record<string, string>>;
  };
}

export interface EnemiesAssetsConfig {
  readonly units: {
    readonly rifleman: {
      readonly assets: {
        readonly sprite: string;
      };
    };
    readonly machineGunner: {
      readonly assets: {
        readonly sprite: string;
      };
    };
    readonly assault: {
      readonly assets: {
        readonly sprite: string;
      };
    };
  };
}

/**
 * 环境层（M7 美术打磨）：天空穹顶、方向光、环境光、雾、远山视差与场景小件散布。
 * 史实设定：1941-09-25 清晨接火，主光是低角度晨光，山地薄雾。
 */
export interface EnvironmentConfig {
  /** 天空全景贴图（resources 相对路径，等距柱状投影）。 */
  readonly skyPanorama: string;
  /** 天空穹顶半径（米），必须小于 cameraFarM。 */
  readonly skyDomeRadiusM: number;
  /** 穹顶绕 Y 轴的旋转（度），用来把日出方向转到合适的方位。 */
  readonly skyDomeYawDeg: number;
  /** 天空穹顶垂直偏移（米）：负值把地平线压到山顶以下。 */
  readonly skyDomeOffsetYM: number;
  /** 太阳方位角与仰角（度）。仰角越小影子越长。 */
  readonly sunYawDeg: number;
  readonly sunPitchDeg: number;
  readonly sunColor: string;
  /** 方向光照度（lux），Cocos 默认 65000；清晨取低。 */
  readonly sunIlluminance: number;
  readonly ambientSkyColor: string;
  readonly ambientGroundColor: string;
  /** 环境光照度（lux）。 */
  readonly ambientSkyIllum: number;
  readonly fogColor: string;
  readonly fogStartM: number;
  readonly fogEndM: number;
  /** 平面阴影颜色（含 alpha）。 */
  readonly shadowColor: string;
  /** 远山层：由近到远。 */
  readonly mountainLayers: readonly MountainLayerConfig[];
  /** 场景小件散布。 */
  readonly props: PropScatterConfig;
}

export interface MountainLayerConfig {
  readonly texture: string;
  /** 距离山顶的纵深（米，正值，实际放在 -z）。 */
  readonly distanceM: number;
  readonly widthM: number;
  readonly heightM: number;
  /** 底边相对地平线的下沉（米），避免底边露出硬线。 */
  readonly sinkM: number;
  /** 左右各复制一份形成环绕（0 = 不复制）。 */
  readonly wrapCopies: number;
}

export interface PropScatterConfig {
  /** 确定性随机种子，保证多端看到同一布局。 */
  readonly seed: number;
  /** 路线中心线两侧不摆小件的半宽（米），避免挡住敌人冲锋路径。 */
  readonly laneClearHalfWidthM: number;
  /** 山顶阵地内不摆小件的纵深（米）。 */
  readonly summitClearDepthM: number;
  readonly items: readonly PropItemConfig[];
  /** 阵地前沿工事线。 */
  readonly fortification: FortificationConfig;
}

export interface PropItemConfig {
  readonly texture: string;
  readonly count: number;
  readonly widthM: number;
  readonly heightM: number;
  /** 尺寸随机抖动比例（0.2 = ±20%）。 */
  readonly scaleJitter: number;
  /** 底边埋入地面的深度（米），避免悬空。 */
  readonly sinkM: number;
}

export interface FortificationConfig {
  readonly straightTexture: string;
  readonly cornerTexture: string;
  /** 工事线距山顶的纵深（米）。 */
  readonly lineZM: number;
  readonly segmentWidthM: number;
  readonly heightM: number;
  /** 工事段之间的缺口宽度（米），留给玩家和路线穿过。 */
  readonly gapM: number;
}

export interface PresentationConfig {
  readonly environment: EnvironmentConfig;
  readonly designWidth: number;
  readonly designHeight: number;
  readonly cameraFovDeg: number;
  readonly cameraNearM: number;
  readonly cameraFarM: number;
  readonly cameraPositionSmoothing: number;
  readonly mouseSensitivityDeg: number;
  readonly pointerLockSettleSec: number;
  readonly groundThicknessM: number;
  readonly groundColor: string;
  readonly allyColor: string;
  readonly allyEngageColor: string;
  readonly enemyColor: string;
  readonly enemyEngageColor: string;
  readonly enemyHitColor: string;
  readonly fireWarningColor: string;
  readonly skyColor: string;
  readonly entityPositionSmoothing: number;
  readonly engageHeightScale: number;
  readonly fireWarningSizeM: number;
  readonly crosshairSizePx: number;
  readonly crosshairGapPx: number;
  readonly crosshairLineWidthPx: number;
  readonly crosshairOutlineWidthPx: number;
  readonly crosshairOutlineColor: string;
  readonly hudFontSizePx: number;
  readonly titleFontSizePx: number;
  readonly helpFontSizePx: number;
  readonly damageFontSizePx: number;
  readonly statusOffsetYPx: number;
  readonly helpOffsetYPx: number;
  readonly healthOffsetXPx: number;
  readonly healthOffsetYPx: number;
  readonly ammoOffsetXPx: number;
  readonly ammoOffsetYPx: number;
  readonly messageOffsetYPx: number;
  readonly focusOffsetYPx: number;
  readonly lowHealthOffsetYPx: number;
  readonly spectatorOffsetYPx: number;
  readonly allyPanelOffsetXPx: number;
  readonly allyPanelOffsetYPx: number;
  readonly allyPanelLineGapPx: number;
  readonly routeIndicatorOffsetYPx: number;
  readonly routeThreatMaxDots: number;
  readonly routeFlashSec: number;
  readonly calloutOffsetYPx: number;
  readonly calloutFontSizePx: number;
  readonly calloutDurationSec: number;
  readonly calloutSoundFrequencyHz: number;
  readonly calloutSoundDurationSec: number;
  readonly helpVisibleSec: number;
  readonly matchHudOffsetYPx: number;
  readonly waveBannerOffsetYPx: number;
  readonly interactionOffsetYPx: number;
  readonly inventoryOffsetYPx: number;
  readonly machineGunOffsetYPx: number;
  readonly medkitGlowColor: string;
  readonly medkitFlashOpacity: number;
  readonly medkitFlashSec: number;
  readonly lowHealthVignetteOpacity: number;
  readonly lowHealthPulseOpacity: number;
  readonly lowHealthPulseSec: number;
  readonly supplyColor: string;
  readonly weaponRackColor: string;
  readonly machineGunColor: string;
  readonly machineGunHotColor: string;
  readonly worldItemSizeM: number;
  readonly machineGunWidthM: number;
  readonly machineGunHeightM: number;
  readonly machineGunLengthM: number;
  readonly grenadeThrowForce: number;
  readonly waveBannerSec: number;
  readonly supplyBannerSec: number;
  readonly reportTitleFontSizePx: number;
  readonly reportLineFontSizePx: number;
  readonly reportLineGapPx: number;
  readonly reportFirstLineOffsetYPx: number;
  /** 战斗中断网遮罩：半透明底的不透明度（0-255）与标题纵向位置。 */
  readonly disconnectOverlayOpacity: number;
  readonly disconnectBannerOffsetYPx: number;
  readonly weaponOffsetXPx: number;
  readonly weaponOffsetYPx: number;
  readonly weaponLengthPx: number;
  readonly weaponHeightPx: number;
  readonly weaponBarrelLengthPx: number;
  readonly weaponRecoilPx: number;
  readonly weaponRecoilSec: number;
  readonly boltTravelPx: number;
  readonly boltCycleSec: number;
  readonly muzzleFlashRadiusPx: number;
  readonly muzzleFlashSec: number;
  readonly hitFeedbackSec: number;
  readonly killFeedbackSec: number;
  readonly damageVignetteSec: number;
  readonly placeholderShotFrequencyHz: number;
  readonly placeholderShotDurationSec: number;
}

export interface M1GameConfig {
  readonly gameplay: GameplayConfig;
  readonly weapons: WeaponsConfig;
  readonly waves: WavesConfig;
  readonly allies: AlliesAssetsConfig;
  readonly enemies: EnemiesAssetsConfig;
  readonly presentation: PresentationConfig;
}

const PRESENTATION_NUMBER_KEYS = [
  'designWidth',
  'designHeight',
  'cameraFovDeg',
  'cameraNearM',
  'cameraFarM',
  'cameraPositionSmoothing',
  'mouseSensitivityDeg',
  'pointerLockSettleSec',
  'groundThicknessM',
  'entityPositionSmoothing',
  'engageHeightScale',
  'fireWarningSizeM',
  'crosshairSizePx',
  'crosshairGapPx',
  'crosshairLineWidthPx',
  'crosshairOutlineWidthPx',
  'hudFontSizePx',
  'titleFontSizePx',
  'helpFontSizePx',
  'damageFontSizePx',
  'statusOffsetYPx',
  'helpOffsetYPx',
  'healthOffsetXPx',
  'healthOffsetYPx',
  'ammoOffsetXPx',
  'ammoOffsetYPx',
  'messageOffsetYPx',
  'focusOffsetYPx',
  'lowHealthOffsetYPx',
  'spectatorOffsetYPx',
  'allyPanelOffsetXPx',
  'allyPanelOffsetYPx',
  'allyPanelLineGapPx',
  'routeIndicatorOffsetYPx',
  'routeThreatMaxDots',
  'routeFlashSec',
  'calloutOffsetYPx',
  'calloutFontSizePx',
  'calloutDurationSec',
  'calloutSoundFrequencyHz',
  'calloutSoundDurationSec',
  'helpVisibleSec',
  'matchHudOffsetYPx',
  'waveBannerOffsetYPx',
  'interactionOffsetYPx',
  'inventoryOffsetYPx',
  'machineGunOffsetYPx',
  'medkitFlashOpacity',
  'medkitFlashSec',
  'lowHealthVignetteOpacity',
  'lowHealthPulseOpacity',
  'lowHealthPulseSec',
  'worldItemSizeM',
  'machineGunWidthM',
  'machineGunHeightM',
  'machineGunLengthM',
  'grenadeThrowForce',
  'waveBannerSec',
  'supplyBannerSec',
  'reportTitleFontSizePx',
  'reportLineFontSizePx',
  'reportLineGapPx',
  'reportFirstLineOffsetYPx',
  'disconnectOverlayOpacity',
  'disconnectBannerOffsetYPx',
  'weaponOffsetXPx',
  'weaponOffsetYPx',
  'weaponLengthPx',
  'weaponHeightPx',
  'weaponBarrelLengthPx',
  'weaponRecoilPx',
  'weaponRecoilSec',
  'boltTravelPx',
  'boltCycleSec',
  'muzzleFlashRadiusPx',
  'muzzleFlashSec',
  'hitFeedbackSec',
  'killFeedbackSec',
  'damageVignetteSec',
  'placeholderShotFrequencyHz',
  'placeholderShotDurationSec',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isGameplayConfig(value: unknown): value is GameplayConfig {
  if (!isRecord(value)) {
    return false;
  }
  const { player, server, combat, arena, medkit, match } = value;
  if (
    !isRecord(player) ||
    !isRecord(player.defaultLoadout) ||
    !isRecord(server) ||
    !isRecord(combat) ||
    !isRecord(arena) ||
    !isRecord(medkit) ||
    !isRecord(match)
  ) {
    return false;
  }

  return (
    isFiniteNumber(player.maxHp) &&
    isFiniteNumber(player.moveSpeed) &&
    isFiniteNumber(player.crouchSpeed) &&
    isFiniteNumber(player.aimPitchMinDeg) &&
    isFiniteNumber(player.aimPitchMaxDeg) &&
    typeof player.defaultLoadout.primary === 'string' &&
    typeof player.defaultLoadout.throwable === 'string' &&
    isFiniteNumber(server.tickRateHz) &&
    isFiniteNumber(server.reconnectGraceSec) &&
    isFiniteNumber(combat.enemyHitboxRadiusM) &&
    isFiniteNumber(combat.enemyHitboxHeightM) &&
    isFiniteNumber(combat.headHitboxStartM) &&
    isFiniteNumber(combat.torsoHitboxStartM) &&
    isFiniteNumber(arena.widthM) &&
    isFiniteNumber(arena.depthM) &&
    isFiniteNumber(arena.itemPickupRangeM) &&
    isFiniteNumber(arena.machineGunMountRangeM) &&
    isFiniteNumber(medkit.carriedHeal) &&
    isFiniteNumber(match.durationSec) &&
    isFiniteNumber(match.deployPhaseSec)
  );
}

function isWeaponsConfig(value: unknown): value is WeaponsConfig {
  if (
    !isRecord(value) ||
    !isRecord(value.player) ||
    !isRecord(value.emplacement)
  ) {
    return false;
  }

  for (const weaponId in value.player) {
    const weapon = value.player[weaponId];
    if (
      !isRecord(weapon) ||
      typeof weapon.displayName !== 'string' ||
      !isRecord(weapon.assets)
    ) {
      return false;
    }
  }
  for (const weaponId in value.emplacement) {
    const weapon = value.emplacement[weaponId];
    if (
      !isRecord(weapon) ||
      typeof weapon.displayName !== 'string' ||
      !isRecord(weapon.assets) ||
      !isFiniteNumber(weapon.fireRate) ||
      !isFiniteNumber(weapon.yawLimitDeg) ||
      !isFiniteNumber(weapon.pitchMinDeg) ||
      !isFiniteNumber(weapon.pitchMaxDeg)
    ) {
      return false;
    }
  }
  return true;
}

function isWavesConfig(value: unknown): value is WavesConfig {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.maxAliveEnemies) ||
    !isFiniteNumber(value.totalEnemies) ||
    !isFiniteNumber(value.matchDurationSec) ||
    !isFiniteNumber(value.intermissionSec) ||
    !Array.isArray(value.waves) ||
    !isRecord(value.routes)
  ) {
    return false;
  }
  const routes = value.routes;
  const routeIds: readonly RouteId[] = ['A', 'B', 'C'];
  return routeIds.every((routeId) => {
    const route = routes[routeId];
    return (
      isRecord(route) &&
      typeof route.name === 'string' &&
      isFiniteNumber(route.lengthM)
    );
  });
}

function isAlliesAssetsConfig(value: unknown): value is AlliesAssetsConfig {
  if (!isRecord(value) || !isRecord(value.bot) || !isRecord(value.bot.assets)) {
    return false;
  }
  return (
    typeof value.bot.assets.sprite === 'string' &&
    Number.isSafeInteger(value.seatCount) &&
    Array.isArray(value.heroNames) &&
    value.heroNames.every((name) => typeof name === 'string')
  );
}

function isEnemiesAssetsConfig(value: unknown): value is EnemiesAssetsConfig {
  if (!isRecord(value) || !isRecord(value.units)) {
    return false;
  }
  const units = value.units;
  return ['rifleman', 'machineGunner', 'assault'].every((unitId) => {
    const unit = units[unitId];
    return isRecord(unit) && isRecord(unit.assets) &&
      typeof unit.assets.sprite === 'string';
  });
}

function isMountainLayerConfig(value: unknown): value is MountainLayerConfig {
  return (
    isRecord(value) &&
    typeof value.texture === 'string' &&
    isFiniteNumber(value.distanceM) &&
    isFiniteNumber(value.widthM) &&
    isFiniteNumber(value.heightM) &&
    isFiniteNumber(value.sinkM) &&
    isFiniteNumber(value.wrapCopies)
  );
}

function isPropItemConfig(value: unknown): value is PropItemConfig {
  return (
    isRecord(value) &&
    typeof value.texture === 'string' &&
    isFiniteNumber(value.count) &&
    isFiniteNumber(value.widthM) &&
    isFiniteNumber(value.heightM) &&
    isFiniteNumber(value.scaleJitter) &&
    isFiniteNumber(value.sinkM)
  );
}

function isFortificationConfig(value: unknown): value is FortificationConfig {
  return (
    isRecord(value) &&
    typeof value.straightTexture === 'string' &&
    typeof value.cornerTexture === 'string' &&
    isFiniteNumber(value.lineZM) &&
    isFiniteNumber(value.segmentWidthM) &&
    isFiniteNumber(value.heightM) &&
    isFiniteNumber(value.gapM)
  );
}

function isEnvironmentConfig(value: unknown): value is EnvironmentConfig {
  if (!isRecord(value) || !isRecord(value.props)) {
    return false;
  }
  const props = value.props;
  return (
    typeof value.skyPanorama === 'string' &&
    isFiniteNumber(value.skyDomeRadiusM) &&
    isFiniteNumber(value.skyDomeYawDeg) &&
    isFiniteNumber(value.skyDomeOffsetYM) &&
    isFiniteNumber(value.sunYawDeg) &&
    isFiniteNumber(value.sunPitchDeg) &&
    typeof value.sunColor === 'string' &&
    isFiniteNumber(value.sunIlluminance) &&
    typeof value.ambientSkyColor === 'string' &&
    typeof value.ambientGroundColor === 'string' &&
    isFiniteNumber(value.ambientSkyIllum) &&
    typeof value.fogColor === 'string' &&
    isFiniteNumber(value.fogStartM) &&
    isFiniteNumber(value.fogEndM) &&
    typeof value.shadowColor === 'string' &&
    Array.isArray(value.mountainLayers) &&
    value.mountainLayers.every(isMountainLayerConfig) &&
    isFiniteNumber(props.seed) &&
    isFiniteNumber(props.laneClearHalfWidthM) &&
    isFiniteNumber(props.summitClearDepthM) &&
    Array.isArray(props.items) &&
    props.items.every(isPropItemConfig) &&
    isFortificationConfig(props.fortification)
  );
}

function isPresentationConfig(value: unknown): value is PresentationConfig {
  if (!isRecord(value)) {
    return false;
  }

  const hasNumbers = PRESENTATION_NUMBER_KEYS.every((key) =>
    isFiniteNumber(value[key]),
  );
  return (
    hasNumbers &&
    isEnvironmentConfig(value.environment) &&
    typeof value.groundColor === 'string' &&
    typeof value.allyColor === 'string' &&
    typeof value.allyEngageColor === 'string' &&
    typeof value.enemyColor === 'string' &&
    typeof value.enemyEngageColor === 'string' &&
    typeof value.enemyHitColor === 'string' &&
    typeof value.fireWarningColor === 'string' &&
    typeof value.crosshairOutlineColor === 'string' &&
    typeof value.medkitGlowColor === 'string' &&
    typeof value.supplyColor === 'string' &&
    typeof value.weaponRackColor === 'string' &&
    typeof value.machineGunColor === 'string' &&
    typeof value.machineGunHotColor === 'string' &&
    typeof value.skyColor === 'string'
  );
}

function normalizePresentationConfig(value: unknown): PresentationConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  // 旧缓存的 presentation 资产没有帮助文字字号；沿用 HUD 字号即可安全兼容，
  // 避免入口脚本与资源缓存短暂错位时整页黑屏。新资源仍优先使用自己的值。
  const normalized: Record<string, unknown> = { ...value };
  if (!isFiniteNumber(normalized.helpFontSizePx)) {
    normalized.helpFontSizePx = normalized.hudFontSizePx;
  }

  return isPresentationConfig(normalized) ? normalized : null;
}

function loadJson(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    resources.load(path, JsonAsset, (error, asset) => {
      if (error) {
        reject(new Error(`配置 ${path} 加载失败：${error.message}`));
        return;
      }
      resolve(asset.json);
    });
  });
}

export async function loadM1GameConfig(): Promise<M1GameConfig> {
  const [gameplay, weapons, waves, allies, enemies, presentation] = await Promise.all([
    loadJson('config/gameplay'),
    loadJson('config/weapons'),
    loadJson('config/waves'),
    loadJson('config/allies'),
    loadJson('config/enemies'),
    loadJson('config/presentation'),
  ]);

  if (!isGameplayConfig(gameplay)) {
    throw new Error('gameplay.json 缺少 M1 客户端字段');
  }
  if (!isWeaponsConfig(weapons)) {
    throw new Error('weapons.json 缺少 M1 客户端字段');
  }
  if (!isWavesConfig(waves)) {
    throw new Error('waves.json 缺少同屏敌人上限');
  }
  if (!isAlliesAssetsConfig(allies)) {
    throw new Error('allies.json 缺少角色素材路径');
  }
  if (!isEnemiesAssetsConfig(enemies)) {
    throw new Error('enemies.json 缺少角色素材路径');
  }
  const normalizedPresentation = normalizePresentationConfig(presentation);
  if (!normalizedPresentation) {
    throw new Error('presentation.json 格式无效');
  }

  return {
    gameplay,
    weapons,
    waves,
    allies,
    enemies,
    presentation: normalizedPresentation,
  };
}
