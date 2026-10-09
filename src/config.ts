// Unités : 1 = la taille d'un dé. La gravité est forte pour que les dés aient l'air lourds à cette échelle.
export const PHYSICS_DT = 1 / 120;
export const MAX_STEPS_PER_FRAME = 6;
export const GRAVITY = -60;

// Rendu en basse résolution, agrandi en pixelated : premier pas vers le look PS1.
export const RENDER_SCALE = 0.6;

// Table : feutre de 22 × 14, centré sur l'origine, dessus à y = 0.
export const TABLE_HALF_W = 11;
export const TABLE_HALF_D = 7;
export const RAIL_THICKNESS = 0.6;
// Le mur avant est bas pour que les dés lancés depuis le gobelet passent par-dessus.
export const FRONT_WALL_HEIGHT = 1.6;
export const WALL_HEIGHT = 20;

// Rebord côté joueur, derrière le rail avant : gobelet au repos et tapis de garde.
export const LEDGE_Z = 9.3;
export const LEDGE_DEPTH = 3.4;

export const CUP_REST = { x: 6.2, y: 0, z: 9.4 };
export const CUP_INNER_RADIUS = 1.5;
export const CUP_WALL = 0.25;
export const CUP_HEIGHT = 3.4;
export const CUP_BOTTOM = 0.24;

// Le gobelet tenu se déplace dans un plan vertical au-dessus du rebord.
export const HOLD_Z = 9.2;
export const HOLD_MIN = { x: -9, y: 4.5 };
export const HOLD_MAX = { x: 9, y: 9 };
export const HOLD_FOLLOW = 14;
export const HOLD_MAX_SPEED = 32;

// Un lancer est refusé s'il est trop mou.
export const MIN_SHAKE_TIME = 0.5;
export const MIN_SHAKE_DISTANCE = 5;

export const KEEP_SLOT = { x0: -9.1, dx: 1.2, y: 0.5, z: 9.0 };

// Une face est considérée posée à plat si sa normale est à moins de ~15° de la verticale.
export const FLAT_ALIGNMENT = 0.966;

export const HAND_COUNT = 4;
export const REROLL_COUNT = 6;
