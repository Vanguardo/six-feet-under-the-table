// Dés et faces : chaque dé a six faces, chacune avec une valeur et, parfois, une gravure.

export type DieTypeId = 'os' | 'ecrase' | 'noirci' | 'ivoire' | 'pipe' | 'verre' | 'plomb' | 'dent' | 'maudit';
export type FaceModId = 'doree' | 'sanglante' | 'vide' | 'clou' | 'crane' | 'flamme';

export interface DieType {
  id: DieTypeId;
  name: string;
  /** Valeur de chaque face, dans l'ordre des faces physiques du cube. */
  faces: number[];
  price: number;
  description: string;
  /** Teintes de l'os et des marques, pour le rendu. */
  look: { bone: string; ink: string; numerals?: boolean };
}

export const DIE_TYPES: Record<DieTypeId, DieType> = {
  os: { id: 'os', name: 'Dé en os', faces: [1, 2, 3, 4, 5, 6], price: 0, description: 'Le dé de départ.', look: { bone: '#d6ccae', ink: '#22150f' } },
  ecrase: {
    id: 'ecrase',
    name: 'Dé écrasé',
    faces: [1, 1, 2, 2, 3, 4],
    price: 4,
    description: 'Faces 1 à 4, doublons fréquents. +2 mult s’il marque.',
    look: { bone: '#b8ac90', ink: '#2a1a10' },
  },
  noirci: {
    id: 'noirci',
    name: 'Dé noirci',
    faces: [3, 4, 5, 6, 7, 8],
    price: 5,
    description: 'Faces 3 à 8 : plus de valeur, suites plus rares.',
    look: { bone: '#3a3430', ink: '#e8d8b0', numerals: true },
  },
  ivoire: {
    id: 'ivoire',
    name: 'Dé en ivoire',
    faces: [2, 4, 6, 8, 10, 12],
    price: 7,
    description: 'Faces paires jusqu’à 12 : grosses valeurs, presque jamais de suite.',
    look: { bone: '#f0e8d0', ink: '#3a2a1a', numerals: true },
  },
  pipe: {
    id: 'pipe',
    name: 'Dé pipé',
    faces: [1, 2, 3, 4, 5, 6],
    price: 8,
    description: 'Lesté : tombe souvent sur 6.',
    look: { bone: '#c8b890', ink: '#5a0a0a' },
  },
  verre: {
    id: 'verre',
    name: 'Dé en verre',
    faces: [1, 2, 3, 4, 5, 6],
    price: 6,
    description: '×2 mult s’il marque. Se brise après 3 mains où il marque.',
    look: { bone: '#a8c8c8', ink: '#0a2a2a' },
  },
  plomb: {
    id: 'plomb',
    name: 'Dé en plomb',
    faces: [1, 2, 3, 4, 5, 6],
    price: 6,
    description: 'Lourd, rebondit à peine. Insensible aux boss qui touchent aux dés.',
    look: { bone: '#6a6e72', ink: '#e8e8e0' },
  },
  dent: {
    id: 'dent',
    name: 'Dé dent',
    faces: [1, 2, 3, 4, 5, 6],
    price: 0,
    description: 'Taillé dans ta propre dent. +1 pièce chaque fois qu’il marque.',
    look: { bone: '#e8e0c0', ink: '#6a1010' },
  },
  maudit: {
    id: 'maudit',
    name: 'Dé maudit',
    faces: [0, 1, 2, 3, 4, 5],
    price: 3,
    description: 'Une face 0. Chaque 0 obtenu donne ×1,5 mult à la main suivante.',
    look: { bone: '#2a0e0e', ink: '#ff3040', numerals: true },
  },
};

export interface FaceMod {
  id: FaceModId;
  name: string;
  price: number;
  description: string;
  /** Couleur de la gravure sur la face. */
  color: string;
}

export const FACE_MODS: Record<FaceModId, FaceMod> = {
  doree: { id: 'doree', name: 'Face dorée', price: 3, description: '+3 pièces quand elle marque.', color: '#e8b830' },
  sanglante: {
    id: 'sanglante',
    name: 'Face sanglante',
    price: 4,
    description: '×1,5 mult quand elle marque ; la dette de l’échéance augmente de 2 %.',
    color: '#a01010',
  },
  vide: { id: 'vide', name: 'Face vide', price: 3, description: 'Vaut 0, +15 mult. Ne compte jamais dans une suite.', color: '#101010' },
  clou: { id: 'clou', name: 'Face clou', price: 3, description: '+25 jetons ; le dé ne peut plus être relancé pendant la main.', color: '#8a8a90' },
  crane: { id: 'crane', name: 'Face crâne', price: 6, description: 'Joker : prend la valeur qui rapporte le plus. Le dé se brise au 3e usage.', color: '#e0dcd0' },
  flamme: { id: 'flamme', name: 'Face flamme', price: 4, description: '+4 mult par relance déjà utilisée pendant la main.', color: '#ff6a10' },
};

/** Un dé possédé : son type, ses faces gravées, son usure. */
export interface OwnedDie {
  uid: number;
  type: DieTypeId;
  mods: (FaceModId | null)[];
  /** Nombre de mains où il a marqué (verre) ou de fois où son crâne a servi. */
  wear: number;
}

let nextUid = 1;
export function newDie(type: DieTypeId = 'os'): OwnedDie {
  return { uid: nextUid++, type, mods: [null, null, null, null, null, null], wear: 0 };
}

/** Ce qu'un dé montre une fois posé : valeur, gravure éventuelle. */
export interface Face {
  value: number;
  mod: FaceModId | null;
  type: DieTypeId;
  /** Index du dé dans la main du joueur. */
  die: number;
}

export function faceOf(die: OwnedDie, faceIndex: number, dieIndex: number): Face {
  const mod = die.mods[faceIndex];
  const value = mod === 'vide' ? 0 : DIE_TYPES[die.type].faces[faceIndex];
  return { value, mod, type: die.type, die: dieIndex };
}

/** Le dé pipé est lesté à l'opposé de cette face, qui sort donc plus souvent. */
export const PIPE_FAVORITE_FACE = 5;
