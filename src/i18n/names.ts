import type { BodyPartId } from '../rules/body';
import { BODY_PARTS } from '../rules/body';
import type { Boss } from '../rules/bosses';
import { COMBOS, type ComboId } from '../rules/combos';
import { DIE_TYPES, FACE_MODS, type DieTypeId, type FaceModId } from '../rules/dice';
import { RARITY_LABEL, type Rarity, type RelicDef } from '../rules/relics';
import { t } from './index';

// Noms traduits des données du jeu ; le français des fichiers de règles sert de repli.

export const relicName = (d: RelicDef) => t(`relic.${d.id}.name`, undefined, d.name);
export const relicDesc = (d: RelicDef) => t(`relic.${d.id}.desc`, undefined, d.description);
export const dieName = (id: DieTypeId) => t(`die.${id}.name`, undefined, DIE_TYPES[id].name);
export const dieDesc = (id: DieTypeId) => t(`die.${id}.desc`, undefined, DIE_TYPES[id].description);
export const modName = (id: FaceModId) => t(`mod.${id}.name`, undefined, FACE_MODS[id].name);
export const modDesc = (id: FaceModId) => t(`mod.${id}.desc`, undefined, FACE_MODS[id].description);
export const bossName = (b: Boss) => t(`boss.${b.id}.name`, undefined, b.name);
export const bossRule = (b: Boss) => t(`boss.${b.id}.rule`, undefined, b.rule);
export const partName = (id: BodyPartId) => t(`part.${id}.name`, undefined, BODY_PARTS[id].name);
export const partEffect = (id: BodyPartId) => t(`part.${id}.effect`, undefined, BODY_PARTS[id].effect);
export const comboName = (id: ComboId) => t(`combo.${id}`, undefined, COMBOS[id].name);
export const rarityName = (r: Rarity) => t(`rarity.${r}`, undefined, RARITY_LABEL[r]);
