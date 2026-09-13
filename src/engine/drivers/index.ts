import { DRIVERS } from '../frames';
import { askCardsDriver, discardFromPlayerDriver, discardPhaseDriver } from './ask';
import { cardUseDriver } from './cardUse';
import { duelDriver, nullifyDriver, respondDriver } from './combat';
import { chainPropagateDriver, damageDriver, deathDriver, dyingDriver, judgeDriver } from './life';
import {
  loseHpDriver,
  skillChoukaDriver,
  skillHuobaDriver,
  skillLambdaDriver,
  skillQitiDriver,
} from './skills';
import { phaseDriver, turnDriver } from './turn';

let registered = false;

/** 注册全部结算帧驱动。engine 模块加载时调用一次。 */
export function registerDrivers(): void {
  if (registered) return;
  registered = true;
  DRIVERS.turn = turnDriver;
  DRIVERS.phase = phaseDriver;
  DRIVERS.cardUse = cardUseDriver;
  DRIVERS.nullify = nullifyDriver;
  DRIVERS.respond = respondDriver;
  DRIVERS.duel = duelDriver;
  DRIVERS.judge = judgeDriver;
  DRIVERS.damage = damageDriver;
  DRIVERS.dying = dyingDriver;
  DRIVERS.death = deathDriver;
  DRIVERS.chainPropagate = chainPropagateDriver;
  DRIVERS.askCards = askCardsDriver;
  DRIVERS.discardFromPlayer = discardFromPlayerDriver;
  DRIVERS.discardPhase = discardPhaseDriver;
  DRIVERS.skillLambda = skillLambdaDriver;
  DRIVERS.skillQiti = skillQitiDriver;
  DRIVERS.skillHuoba = skillHuobaDriver;
  DRIVERS.skillChouka = skillChoukaDriver;
  DRIVERS.loseHp = loseHpDriver;
}
