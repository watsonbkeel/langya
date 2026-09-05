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
  };
  readonly combat: {
    readonly enemyHitboxRadiusM: number;
    readonly enemyHitboxHeightM: number;
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

export interface WeaponPresentationConfig {
  readonly displayName: string;
  readonly assets: {
    readonly firstPerson?: string;
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
  readonly routes: Readonly<
    Record<
      RouteId,
      {
        readonly name: string;
      }
    >
  >;
}

export interface AlliesAssetsConfig {
  readonly bot: {
    readonly assets: {
      readonly sprite: string;
    };
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

export interface PresentationConfig {
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
    isFiniteNumber(combat.enemyHitboxRadiusM) &&
    isFiniteNumber(combat.enemyHitboxHeightM) &&
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
    !isRecord(value.routes)
  ) {
    return false;
  }
  const routes = value.routes;
  const routeIds: readonly RouteId[] = ['A', 'B', 'C'];
  return routeIds.every((routeId) => {
    const route = routes[routeId];
    return isRecord(route) && typeof route.name === 'string';
  });
}

function isAlliesAssetsConfig(value: unknown): value is AlliesAssetsConfig {
  if (!isRecord(value) || !isRecord(value.bot) || !isRecord(value.bot.assets)) {
    return false;
  }
  return typeof value.bot.assets.sprite === 'string';
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

function isPresentationConfig(value: unknown): value is PresentationConfig {
  if (!isRecord(value)) {
    return false;
  }

  const hasNumbers = PRESENTATION_NUMBER_KEYS.every((key) =>
    isFiniteNumber(value[key]),
  );
  return (
    hasNumbers &&
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
