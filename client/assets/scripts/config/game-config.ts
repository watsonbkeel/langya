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
  };
}

export interface WeaponPresentationConfig {
  readonly displayName: string;
}

export interface WeaponsConfig {
  readonly player: Readonly<Record<string, WeaponPresentationConfig>>;
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
  readonly hudFontSizePx: number;
  readonly titleFontSizePx: number;
  readonly damageFontSizePx: number;
  readonly statusOffsetYPx: number;
  readonly helpOffsetYPx: number;
  readonly healthOffsetXPx: number;
  readonly healthOffsetYPx: number;
  readonly ammoOffsetXPx: number;
  readonly ammoOffsetYPx: number;
  readonly messageOffsetYPx: number;
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
  'hudFontSizePx',
  'titleFontSizePx',
  'damageFontSizePx',
  'statusOffsetYPx',
  'helpOffsetYPx',
  'healthOffsetXPx',
  'healthOffsetYPx',
  'ammoOffsetXPx',
  'ammoOffsetYPx',
  'messageOffsetYPx',
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
  const { player, server, combat, arena } = value;
  if (
    !isRecord(player) ||
    !isRecord(player.defaultLoadout) ||
    !isRecord(server) ||
    !isRecord(combat) ||
    !isRecord(arena)
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
    isFiniteNumber(server.tickRateHz) &&
    isFiniteNumber(combat.enemyHitboxRadiusM) &&
    isFiniteNumber(combat.enemyHitboxHeightM) &&
    isFiniteNumber(arena.widthM) &&
    isFiniteNumber(arena.depthM)
  );
}

function isWeaponsConfig(value: unknown): value is WeaponsConfig {
  if (!isRecord(value) || !isRecord(value.player)) {
    return false;
  }

  for (const weaponId in value.player) {
    const weapon = value.player[weaponId];
    if (
      !isRecord(weapon) ||
      typeof weapon.displayName !== 'string'
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
    typeof value.skyColor === 'string'
  );
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
  const [gameplay, weapons, waves, presentation] = await Promise.all([
    loadJson('config/gameplay'),
    loadJson('config/weapons'),
    loadJson('config/waves'),
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
  if (!isPresentationConfig(presentation)) {
    throw new Error('presentation.json 格式无效');
  }

  return { gameplay, weapons, waves, presentation };
}
