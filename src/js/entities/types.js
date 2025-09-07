/**
 * @typedef {Object} Keyword
 * @property {string} name
 * @property {string=} description
 *
 * @typedef {Object} Ability
 * @property {string} id
 * @property {string} name
 * @property {string} text
 * @property {number=} cost
 * @property {Keyword[]=} keywords
 *
 * @typedef {Object} Equipment
 * @property {string} id
 * @property {string} name
 * @property {number=} attack
 * @property {number=} armor
 * @property {number=} durability
 * @property {Keyword[]=} keywords
 *
 * @typedef {Object} Ally
 * @property {string} id
 * @property {string} name
 * @property {number} attack
 * @property {number} health
 * @property {Keyword[]=} keywords
 *
 * @typedef {Object} Consumable
 * @property {string} id
 * @property {string} name
 * @property {string} effect
 *
 * @typedef {Object} Quest
 * @property {string} id
 * @property {string} name
 * @property {string} goal
 * @property {string} reward
 *
 * @typedef {Object} Hero
 * @property {string} id
 * @property {string} name
 * @property {number} health
 * @property {number=} armor
 * @property {Keyword[]=} keywords
 *
 * @typedef {'ally'|'spell'|'equipment'|'quest'|'consumable'} CardType
 *
 * @typedef {Object} Card
 * @property {string} id
 * @property {CardType} type
 * @property {string} name
 * @property {number=} cost
 * @property {Keyword[]=} keywords
 * @property {Record<string, any>=} data
 */

export {}; // purely for typedefs

