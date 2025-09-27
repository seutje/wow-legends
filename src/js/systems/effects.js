import Card from '../entities/card.js';
import Equipment from '../entities/equipment.js';
import { rememberSecretToken, enrichSecretToken } from '../utils/savegame.js';
import { logSecretTriggered } from '../utils/combatLog.js';
import { freezeTarget, getSpellDamageBonus, computeSpellDamage, isTargetable } from './keywords.js';
import { selectTargets } from './targeting.js';
import { getCardInstanceId, matchesCardIdentifier } from '../utils/card.js';
import { addHandHookDescriptor, registerPostAddHookHandler } from './post-add-hooks.js';

function slugifyTokenName(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveSummonedCardId(unit, sourceCard) {
  const raw = unit?.id;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) return trimmed;
  }

  const parentId = typeof sourceCard?.summonedBy?.id === 'string'
    ? sourceCard.summonedBy.id.trim()
    : '';
  const slug = slugifyTokenName(unit?.name);

  if (parentId) {
    if (slug) return `${parentId}__${slug}`;
    return `${parentId}__token`;
  }

  if (slug) return `token-${slug}`;

  return null;
}

function normalizeCardText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

const HAND_HOOK_TYPE_KEYWORD_COST_REDUCTION = 'keywordCostReduction';

function cardHasNormalizedKeyword(cardEntity, normalizedKeyword) {
  if (!cardEntity || typeof normalizedKeyword !== 'string' || !normalizedKeyword) return false;
  const list = cardEntity.keywords;
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.some((kw) => typeof kw === 'string' && kw.toLowerCase() === normalizedKeyword);
}

function applyKeywordCostReductionDescriptorToCard(cardEntity, descriptor) {
  if (!cardEntity || !descriptor || typeof descriptor !== 'object') return;
  const { modKey, normalizedKeyword, amount, minimumCost } = descriptor;
  if (!modKey || typeof normalizedKeyword !== 'string') return;

  if (!cardEntity.data) cardEntity.data = {};
  const mods = cardEntity.data.keywordCostReductions ||= {};
  const previous = typeof mods[modKey] === 'number' ? mods[modKey] : 0;
  if (previous > 0) {
    const priorCost = Number(cardEntity.cost ?? 0);
    const restored = Number.isFinite(priorCost) ? priorCost + previous : previous;
    cardEntity.cost = restored;
    delete mods[modKey];
  }

  if (!cardHasNormalizedKeyword(cardEntity, normalizedKeyword)) return;

  let currentCost = Number(cardEntity.cost ?? 0);
  if (!Number.isFinite(currentCost)) currentCost = 0;
  if (currentCost <= minimumCost) return;

  let reduction = amount;
  if (!Number.isFinite(reduction)) return;
  if (currentCost - reduction < minimumCost) {
    reduction = currentCost - minimumCost;
  }
  if (reduction <= 0) return;

  cardEntity.cost = currentCost - reduction;
  mods[modKey] = reduction;
}

registerPostAddHookHandler(HAND_HOOK_TYPE_KEYWORD_COST_REDUCTION, (hand, cardEntity, descriptor) => {
  applyKeywordCostReductionDescriptorToCard(cardEntity, descriptor);
});

export class EffectSystem {
  constructor(game) {
    this.game = game;
    this.effectRegistry = new Map();
    this.temporaryEffects = [];
    this.cleanupFns = new Set();
    this.registerDefaults();

    this.game.turns.bus.on('phase:end', ({ phase }) => {
      if (phase === 'End') {
        this.cleanupTemporaryEffects();
      }
    });
  }

  _recordTarget(context, target) {
    if (!target) return;
    const record = context?.recordLogTarget;
    if (typeof record === 'function') {
      try {
        record(target);
        return;
      } catch {}
    }
    const game = context?.game;
    if (game && typeof game.recordActionTarget === 'function') {
      game.recordActionTarget(target);
    }
  }

  _trackCleanup(off) {
    if (typeof off !== 'function') return off;
    let active = true;
    const wrapped = () => {
      if (!active) return;
      active = false;
      try { off(); } catch {}
      finally {
        this.cleanupFns.delete(wrapped);
      }
    };
    this.cleanupFns.add(wrapped);
    return wrapped;
  }

  _formatDurationSuffix(duration) {
    if (!duration) return '';
    if (duration === 'thisTurn') return ' (this turn)';
    if (duration === 'untilYourNextTurn') return ' (until your next turn)';
    return '';
  }

  _formatStatAdjustment(property, amount, duration) {
    if (!Number.isFinite(amount) || amount === 0) return null;
    const labels = {
      attack: 'Attack',
      health: 'Health',
      armor: 'Armor',
      spellDamage: 'Spell Damage',
    };
    const label = labels[property] || property;
    const sign = amount > 0 ? '+' : '-';
    const suffix = this._formatDurationSuffix(duration);
    return `${sign}${Math.abs(amount)} ${label}${suffix}`;
  }

  _describeBuffEffects(effects) {
    if (!Array.isArray(effects)) return null;
    const adjustments = [];
    for (const eff of effects) {
      const text = this._formatStatAdjustment(eff?.property, Number(eff?.amount ?? 0), eff?.duration);
      if (text) adjustments.push(text);
    }
    if (!adjustments.length) return null;
    if (adjustments.length === 1) return `Apply ${adjustments[0]}`;
    return `Apply ${adjustments.join(', ')}`;
  }

  _describeBuffEffect(effect) {
    return this._describeBuffEffects([effect]);
  }

  _describeKeywordGrant(keyword, duration) {
    if (!keyword) return null;
    const suffix = this._formatDurationSuffix(duration);
    return `Grant ${keyword}${suffix}`;
  }

  _describeKeywordList(keywords, duration) {
    if (!Array.isArray(keywords) || !keywords.length) return [];
    return keywords
      .map((kw) => this._describeKeywordGrant(kw, duration))
      .filter(Boolean);
  }

  _computeDamageAmount(effect, context) {
    if (!effect) return 0;
    const { amount = 0, comboAmount, beastBonus, usesSpellDamage, target } = effect;
    const { player, comboActive, card, spellPowerApplies } = context || {};
    let dmgAmount = Number(amount) || 0;
    if (comboActive && Number.isFinite(comboAmount)) {
      dmgAmount = comboAmount;
    }
    if (Number.isFinite(beastBonus) && beastBonus !== 0) {
      const beasts = Array.isArray(player?.battlefield?.cards) ? player.battlefield.cards : [];
      const hasBeast = beasts.some((c) => c?.keywords?.includes?.('Beast'));
      if (hasBeast) {
        dmgAmount += beastBonus;
      }
    }
    const effectTargetsSelfHero = target === 'selfHero';
    const shouldApplySpellDamage = (card?.type === 'spell')
      || usesSpellDamage
      || (spellPowerApplies && !effectTargetsSelfHero);
    if (shouldApplySpellDamage && player) {
      const bonus = getSpellDamageBonus(player);
      dmgAmount = computeSpellDamage(dmgAmount, bonus);
    }
    return dmgAmount;
  }

  _describeFreeze(freeze) {
    if (!freeze) return null;
    if (Number.isFinite(freeze)) {
      if (freeze === 1) return 'Freeze';
      return `Freeze (${freeze} turns)`;
    }
    return 'Freeze';
  }

  _describeDamagePrompt(effect, context) {
    if (!effect) return null;
    const amount = this._computeDamageAmount(effect, context);
    const parts = [];
    if (Number.isFinite(amount) && amount !== 0) {
      parts.push(`Deal ${amount} damage`);
    } else {
      parts.push('Deal damage');
    }
    const freezeText = this._describeFreeze(effect.freeze);
    if (freezeText) parts.push(freezeText);
    if (effect.friendlyDamageBuff?.attack) {
      const buffAmount = Number(effect.friendlyDamageBuff.attack);
      if (Number.isFinite(buffAmount) && buffAmount !== 0) {
        const buffText = this._formatStatAdjustment('attack', buffAmount, effect.friendlyDamageBuff.duration);
        if (buffText) parts.push(`Survivors gain ${buffText}`);
      }
    }
    return parts.join(' + ');
  }

  _describeHealPrompt(effect) {
    if (!effect) return null;
    const amount = Number(effect.amount ?? 0);
    if (Number.isFinite(amount) && amount > 0) {
      return `Heal ${amount} HP`;
    }
    return 'Heal target';
  }

  _describeDestroyPrompt(effect) {
    if (!effect) return null;
    let base = 'Destroy target minion';
    switch (effect.target) {
      case 'ally':
      case 'friendlyAlly':
      case 'friendlyMinion':
        base = 'Destroy friendly minion';
        break;
      case 'anyAlly':
      case 'anyMinion':
        base = 'Destroy a minion';
        break;
      default:
        base = 'Destroy enemy minion';
        break;
    }
    if (effect.condition?.type === 'attackLessThan') {
      const amount = Number(effect.condition.amount ?? 0);
      if (Number.isFinite(amount)) {
        base += ` (attack ≤ ${amount})`;
      }
    }
    return base;
  }

  _describeReturnPrompt(effect) {
    if (!effect) return null;
    let base = 'Return enemy ally to hand';
    switch (effect.target) {
      case 'ally':
        base = 'Return friendly ally to hand';
        break;
      case 'anyAlly':
        base = 'Return an ally to hand';
        break;
      default:
        base = 'Return enemy ally to hand';
        break;
    }
    const increase = Number(effect.costIncrease ?? 0);
    if (Number.isFinite(increase) && increase > 0) {
      base += ` (+${increase} cost)`;
    }
    return base;
  }

  _describeBuffBeastPrompt(effect) {
    if (!effect) return null;
    const parts = [];
    const attackText = this._formatStatAdjustment('attack', Number(effect.attack ?? 0), effect.duration);
    if (attackText) parts.push(attackText);
    const healthText = this._formatStatAdjustment('health', Number(effect.health ?? 0), effect.duration);
    if (healthText) parts.push(healthText);
    const keywordTexts = this._describeKeywordList(effect.keywords, effect.duration);
    parts.push(...keywordTexts);
    if (!parts.length) return 'Buff Beast';
    return `Buff Beast: ${parts.join(', ')}`;
  }

  _describeGrantKeywordPrompt(effect) {
    if (!effect) return null;
    const keywordText = this._describeKeywordGrant(effect.keyword, effect.duration);
    if (!keywordText) return null;
    switch (effect.target) {
      case 'enemyCharacter':
        return `Afflict enemy with ${keywordText.slice('Grant '.length)}`;
      case 'character':
      case 'hero':
      case 'allies':
      default:
        return keywordText;
    }
  }

  reset() {
    const pending = Array.from(this.cleanupFns);
    this.cleanupFns.clear();
    for (const off of pending) {
      try { off(); } catch {}
    }
    this.cleanupTemporaryEffects();
  }

  async execute(cardEffects, context) {
    for (let i = 0; i < cardEffects.length; i++) {
      const effect = cardEffects[i];

      if (effect.type === 'buff' && effect.target === 'character') {
        const grouped = [effect];
        let j = i + 1;
        while (
          j < cardEffects.length &&
          cardEffects[j].type === 'buff' &&
          cardEffects[j].target === 'character'
        ) {
          grouped.push(cardEffects[j]);
          j++;
        }

        const { player, game } = context;
        const opponent = player === game.player ? game.opponent : game.player;
        // If any grouped buff has a negative amount, treat it as a debuff and allow enemy targets
        const isDebuff = grouped.some(g => typeof g.amount === 'number' && g.amount < 0);
        const allowHeroTargets = grouped.every(g => g.allowHero !== false);

        const friendlyAllies = player.battlefield.cards.filter(c => c.type !== 'quest');
        let candidates = [
          ...(allowHeroTargets ? [player.hero] : []),
          ...friendlyAllies
        ].filter((target) => isTargetable(target, { requester: player }));

        if (isDebuff) {
          const enemy = selectTargets([
            ...(allowHeroTargets ? [opponent.hero] : []),
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
          ]);
          candidates = [...candidates, ...enemy];
        }
        const promptOptions = {
          preferredSide: isDebuff ? 'enemy' : 'friendly',
          actingPlayer: player,
        };
        const promptTitle = this._describeBuffEffects(grouped);
        if (promptTitle) promptOptions.title = promptTitle;
        const chosen = await game.promptTarget(candidates, promptOptions);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) {
          for (const g of grouped) {
            await this.applyBuff(g, context, chosen);
          }
        }
        i = j - 1;
        continue;
      }

      switch (effect.type) {
        case 'damage':
          await this.dealDamage(effect, context);
          break;
        case 'buffAtEndOfTurn':
          this.buffAtEndOfTurn(effect, context);
          break;
        case 'summon':
          await this.summonUnit(effect, context);
          break;
        case 'summonBuff':
          this.registerSummonBuff(effect, context);
          break;
        case 'equipmentKeywordAura':
          this.registerEquipmentKeywordAura(effect, context);
          break;
        case 'friendlyAuraBuff':
          this.registerFriendlyAuraBuff(effect, context);
          break;
        case 'buff':
          await this.applyBuff(effect, context);
          break;
        case 'buffBeast':
          await this.buffBeast(effect, context);
          break;
        case 'buffTribe':
          await this.buffTribe(effect, context);
          break;
        case 'buffOnArmorGain':
          this.buffOnArmorGain(effect, context);
          break;
        case 'heroAttackOnArmorGain':
          this.heroAttackOnArmorGain(effect, context);
          break;
        case 'overload':
          this.applyOverload(effect, context);
          break;
        case 'restore':
          this.restoreResources(effect, context);
          break;
        case 'rawText':
          console.log(`Raw text effect (not implemented): ${effect.text}`);
          break;
        case 'heal':
          await this.healCharacter(effect, context);
          break;
        case 'draw':
          this.drawCard(effect, context);
          break;
        case 'drawOnHeal':
          this.drawOnHeal(effect, context);
          break;
        case 'drawOnFullHeal':
          this.drawOnFullHeal(effect, context);
          break;
        case 'healAtEndOfTurn':
          this.healAtEndOfTurn(effect, context);
          break;
        case 'gainArmorAtEndOfTurn':
          this.gainArmorAtEndOfTurn(effect, context);
          break;
        case 'playRandomConsumableFromLibrary':
          await this.playRandomConsumableFromLibrary(effect, context);
          break;
        case 'destroy':
          await this.destroyMinion(effect, context);
          break;
        case 'returnToHand':
          await this.returnToHand(effect, context);
          break;
        case 'transform':
          this.transformCharacter(effect, context);
          break;
        case 'equip':
          this.equipItem(effect, context);
          break;
        case 'spellDamageNextSpell':
          this.spellDamageNextSpell(effect, context);
          break;
        case 'spellDamageWhileControl':
          this.spellDamageWhileControl(effect, context);
          break;
        case 'damageArmor':
          await this.dealDamage({ target: effect.target, amount: context.player.hero.data.armor }, context);
          break;
        case 'buffOnSurviveDamage':
          this.buffOnSurviveDamage(effect, context);
          break;
        case 'gainStatsPerTribe':
          await this.gainStatsPerTribe(effect, context);
          break;
        case 'explosiveTrap':
          this.explosiveTrap(effect, context);
          break;
        case 'freezingTrap':
          this.freezingTrap(effect, context);
          break;
        case 'snakeTrap':
          this.snakeTrap(effect, context);
          break;
        case 'counterShot':
          this.counterShot(effect, context);
          break;
        case 'retaliationRunes':
          this.retaliationRunes(effect, context);
          break;
        case 'vengefulSpirit':
          this.vengefulSpirit(effect, context);
          break;
        case 'grantKeyword':
          await this.grantKeyword(effect, context);
          break;
        case 'keywordCostReduction':
          this.keywordCostReduction(effect, context);
          break;
        case 'firstKeywordCostReduction':
          this.firstKeywordCostReduction(effect, context);
          break;
        case 'firstHealCostReduction':
          this.firstHealCostReduction(effect, context);
          break;
        case 'summonOnManaSpent':
          this.summonOnManaSpent(effect, context);
          break;
        case 'chooseBothOnManaSpent':
          this.chooseBothOnManaSpent(effect, context);
          break;
        case 'chooseOne':
          await this.handleChooseOne(effect, context);
          break;
        default:
          console.log(`Unknown effect type: ${effect.type}`);
      }
    }
  }

  async dealDamage(effect, context) {
    const { target, freeze, friendlyDamageBuff } = effect;
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;
    const dmgAmount = this._computeDamageAmount(effect, context);
    const promptTitle = this._describeDamagePrompt(effect, context);
    let actualTargets = [];

    switch (target) {
      case 'any': {
        const enemy = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
        ]);
        const friendly = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter((target) => isTargetable(target, { requester: player }));
        const candidates = [...enemy, ...friendly];
        const promptOptions = {
          preferredSide: 'enemy',
          actingPlayer: player,
        };
        if (promptTitle) promptOptions.title = promptTitle;
        const chosen = await game.promptTarget(candidates, promptOptions);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'character': {
        const friendly = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter((target) => isTargetable(target, { requester: player }));
        const enemy = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
        ]);
        const candidates = [...friendly, ...enemy];
        const promptOptions = {
          preferredSide: 'enemy',
          actingPlayer: player,
        };
        if (promptTitle) promptOptions.title = promptTitle;
        const chosen = await game.promptTarget(candidates, promptOptions);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'upToThreeTargets': {
        const enemy = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
        ]);
        const friendly = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter((target) => isTargetable(target, { requester: player }));
        const candidates = [...enemy, ...friendly];
        const chosen = new Set();
        for (let i = 0; i < 3; i++) {
          const pickOptions = {
            allowNoMore: chosen.size > 0,
            preferredSide: 'enemy',
            actingPlayer: player,
          };
          if (promptTitle) pickOptions.title = promptTitle;
          const pick = await game.promptTarget(
            candidates.filter(c => !chosen.has(c)),
            pickOptions
          );
          if (pick === game.CANCEL) throw game.CANCEL;
          if (!pick) break;
          chosen.add(pick);
        }
        actualTargets.push(...chosen);
        break;
      }
      case 'allCharacters':
        actualTargets.push(player.hero);
        actualTargets.push(opponent.hero);
        actualTargets.push(...player.battlefield.cards.filter(c => c.type !== 'quest'));
        actualTargets.push(...opponent.battlefield.cards.filter(c => c.type !== 'quest'));
        break;
      case 'allOtherCharacters': {
        // Same as allCharacters, but exclude the source card if present
        const source = context?.card || null;
        actualTargets.push(player.hero);
        actualTargets.push(opponent.hero);
        actualTargets.push(...player.battlefield.cards.filter(c => c.type !== 'quest'));
        actualTargets.push(...opponent.battlefield.cards.filter(c => c.type !== 'quest'));
        if (source) {
          actualTargets = actualTargets.filter(t => t !== source);
        }
        break;
      }
      case 'allEnemies':
        actualTargets.push(opponent.hero);
        actualTargets.push(...opponent.battlefield.cards.filter(c => c.type !== 'quest'));
        break;
      case 'minion': {
        const enemy = selectTargets(
          opponent.battlefield.cards.filter(c => c.type !== 'quest')
        );
        const friendly = player.battlefield.cards
          .filter(c => c.type !== 'quest')
          .filter((target) => isTargetable(target, { requester: player }));
        const candidates = [...enemy, ...friendly];
        const promptOptions = {
          preferredSide: 'enemy',
          actingPlayer: player,
        };
        if (promptTitle) promptOptions.title = promptTitle;
        const chosen = await game.promptTarget(candidates, promptOptions);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'enemyHeroOrMinionWithoutTaunt': {
        const candidates = [
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => !c.keywords?.includes('Taunt') && c.type !== 'quest'),
        ].filter(isTargetable);
        const promptOptions = {
          preferredSide: 'enemy',
          actingPlayer: player,
        };
        if (promptTitle) promptOptions.title = promptTitle;
        const chosen = await game.promptTarget(candidates, promptOptions);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'selfHero':
        actualTargets.push(player.hero);
        break;
      default:
        console.warn(`Unknown damage target: ${target}`);
        return;
    }

    for (const t of actualTargets) {
      this._recordTarget(context, t);
      // Divine Shield absorbs one instance of damage (for shielded minions)
      if (t?.data?.divineShield) {
        t.data.divineShield = false;
        if (t?.keywords?.includes?.('Divine Shield')) {
          t.keywords = t.keywords.filter(k => k !== 'Divine Shield');
        }
        // Emit zero-damage event for consistency with combat events
        game.bus.emit('damageDealt', { player, source: card, amount: 0, target: t });
        continue;
      }
      let remaining = dmgAmount;
      if (t.data && typeof t.data.armor === 'number') {
        const current = t.data.armor;
        const a = Math.max(0, current);
        const use = Math.min(a, remaining);
        t.data.armor = a - use; // never negative
        remaining -= use;
      }
      if (remaining <= 0) {
        if (freeze && dmgAmount > 0) {
          const healthValue = typeof t?.data?.health === 'number'
            ? t.data.health
            : typeof t?.health === 'number'
              ? t.health
              : null;
          if (healthValue == null || healthValue > 0) {
            freezeTarget(t, freeze);
          }
        }
        continue;
      }
      const damageApplied = remaining;
      if (t.data && t.data.health != null) {
        t.data.health -= remaining;
        console.log(
          `${t.name} took ${remaining} damage from ${card?.name ?? 'an unknown source'}. Remaining health: ${t.data.health}`
        );
        if (t.data.health > 0 && freeze) freezeTarget(t, freeze);
        if (t.data.health <= 0) t.data.dead = true;
      } else if (t.health != null) {
        t.health -= remaining;
        console.log(
          `${t.name} took ${remaining} damage from ${card?.name ?? 'an unknown source'}. Remaining health: ${t.health}`
        );
        if (t.health > 0 && freeze) freezeTarget(t, freeze);
      }
      if (friendlyDamageBuff && damageApplied > 0) {
        const friendlyCards = Array.isArray(player?.battlefield?.cards) ? player.battlefield.cards : [];
        const isFriendlyAlly = t?.type === 'ally' && friendlyCards.includes(t);
        const survived = (t?.data?.health ?? t?.health ?? 0) > 0;
        if (isFriendlyAlly && survived) {
          const { attack: bonusAttack = 0 } = friendlyDamageBuff;
          if (typeof bonusAttack === 'number' && bonusAttack !== 0) {
            if (!t.data) t.data = {};
            const currentAttack = typeof t.data.attack === 'number' ? t.data.attack : 0;
            t.data.attack = currentAttack + bonusAttack;
            console.log(`${t.name} enraged from ${card?.name ?? 'damage effect'} gaining +${bonusAttack} ATK.`);
          }
        }
      }
      if (t.keywords?.includes?.('Stealth')) {
        t.keywords = t.keywords.filter(k => k !== 'Stealth');
      }
      game.bus.emit('damageDealt', { player, source: card, amount: remaining, target: t });
    }
    // Let UI reflect HP changes before removals
    if (game._uiRerender) {
      try { game._uiRerender(); } catch {}
    }
    await game.cleanupDeaths(player, player);
    await game.cleanupDeaths(opponent, player);
    game.checkForGameOver?.();
  }

  async summonUnit(effect, context) {
    const { unit, count } = effect;
    const { player, card, game } = context;

    for (let i = 0; i < count; i++) {
      const cardProps = {
        name: unit.name,
        type: 'ally', // Summoned units are typically allies
        data: { attack: unit.attack, health: unit.health },
        keywords: Array.isArray(unit.keywords) ? unit.keywords.slice() : unit.keywords,
        summonedBy: card,
        text: normalizeCardText(unit.text),
        tokenSource: unit.tokenSource || null,
      };
      const canonicalId = deriveSummonedCardId(unit, card);
      if (canonicalId) cardProps.id = canonicalId;
      if (Number.isFinite(unit.cost)) cardProps.cost = unit.cost;

      const newUnit = new Card(cardProps);
      if (newUnit.keywords?.includes('Divine Shield')) {
        newUnit.data.divineShield = true;
      }
      // Track entry turn for Rush/Charge logic, ensuring units created during an
      // opponent turn count as entering on the previous turn so they are ready
      // when their controller's next turn begins.
      const turnSystem = this.game?.turns;
      const currentTurn = (turnSystem && typeof turnSystem.turn === 'number') ? turnSystem.turn : 0;
      const activePlayer = turnSystem?.activePlayer;
      const isOwnersTurn = activePlayer == null || activePlayer === player;
      const enteredTurn = isOwnersTurn ? currentTurn : Math.max(0, currentTurn - 1);
      newUnit.data.enteredTurn = enteredTurn;
      // Summoning sickness applies unless the unit has Rush or Charge
      if (!(newUnit.keywords?.includes('Rush') || newUnit.keywords?.includes('Charge'))) {
        newUnit.data.attacked = true;
        newUnit.data.summoningSick = true;
      }
      player.battlefield.add(newUnit);
      if (game?.enforceBattlefieldAllyLimit) {
        const allyCount = player.battlefield.cards.filter(c => c?.type === 'ally').length;
        if (allyCount > 5) {
          await game.enforceBattlefieldAllyLimit(player, { source: newUnit });
        }
      }
      console.log(`Summoned ${newUnit.name} to battlefield.`);
      game?.bus.emit('unitSummoned', { player, card: newUnit });

      // Execute any on-summon effects with the summoned unit as the source
      if (Array.isArray(effect.onSummoned) && effect.onSummoned.length > 0) {
        await this.execute(effect.onSummoned, { game, player, card: newUnit });
      }
    }
  }

  registerSummonBuff(effect, context) {
    const { keyword, attack = 0, health = 0 } = effect;
    const { game, player, card } = context;

    if (!game || !player || !player.hero) return;
    if (typeof keyword !== 'string' || keyword.trim() === '') return;

    if (card && typeof card === 'object' && card.data == null) card.data = {};
    const hostData = card?.data;
    if (hostData) {
      const keyBase = `summonBuff:${card?.id || card?.name || 'unknown'}:${keyword}:${attack}:${health}`;
      const registeredKey = `${keyBase}:registered`;
      if (hostData[registeredKey]) return;
      hostData[registeredKey] = true;
    }

    const isEquipmentCard = card instanceof Equipment || card?.type === 'equipment';
    const requiresEquipped = effect.requireEquipped !== false && isEquipmentCard;

    const matchesEquipment = (eq) => {
      if (!eq) return false;
      if (eq === card) return true;
      if (matchesCardIdentifier(eq, card)) return true;
      if (eq?.name && card?.name && eq.name === card.name) return true;
      return false;
    };

    const hasRequiredSource = () => {
      if (!requiresEquipped) return true;
      const eqList = Array.isArray(player.hero?.equipment) ? player.hero.equipment : [];
      return eqList.some(matchesEquipment);
    };

    const applyBuff = (unit) => {
      if (!unit?.keywords?.includes?.(keyword)) return;
      if (!hasRequiredSource()) return;
      unit.data = unit.data || {};
      unit.data.attack = (unit.data.attack || 0) + attack;
      unit.data.health = (unit.data.health || 0) + health;
      if (typeof health === 'number' && health !== 0) {
        const prior = (unit.data.health || 0) - health;
        const baseMax = (typeof unit.data.maxHealth === 'number') ? unit.data.maxHealth : prior;
        unit.data.maxHealth = baseMax + health;
        // Clamp current health to new max if health buff was negative
        if (health < 0) unit.data.health = Math.max(0, Math.min(unit.data.health, unit.data.maxHealth));
      }
    };

    const onPlay = ({ player: evtPlayer, card: played }) => {
      if (evtPlayer !== player) return;
      if (played === card) return;
      if (played?.type !== 'ally') return;
      applyBuff(played);
    };

    const onSummon = ({ player: evtPlayer, card: summoned }) => {
      if (evtPlayer !== player) return;
      applyBuff(summoned);
    };

    this._trackCleanup(game.bus.on('cardPlayed', onPlay));
    this._trackCleanup(game.bus.on('unitSummoned', onSummon));
  }

  registerEquipmentKeywordAura(effect, context) {
    const { keyword, attack = 0, health = 0 } = effect;
    const { game, player, card } = context;

    if (!keyword || !game || !player || !card) return;

    const keyBase = `equipmentAura:${card.id || card.name || 'unknown'}:${keyword}`;
    const attackKey = `${keyBase}:attack`;
    const healthKey = `${keyBase}:health`;

      const matchesEquipment = (eq) => {
        if (!eq) return false;
        if (eq === card) return true;
        if (matchesCardIdentifier(eq, card)) return true;
        if (card.name && eq.name === card.name) return true;
        return false;
      };

    const isEquipped = () => {
      const eqList = Array.isArray(player?.hero?.equipment) ? player.hero.equipment : [];
      return eqList.some(matchesEquipment);
    };

    const offFns = [];
    let disposed = false;
    let wasActive = false;

    const track = (off) => {
      if (typeof off === 'function') {
        const wrapped = this._trackCleanup(off);
        offFns.push(wrapped);
        return wrapped;
      }
      return off;
    };

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      while (offFns.length) {
        const off = offFns.pop();
        try { off(); } catch {}
      }
    };

    const ensureData = (unit) => {
      if (!unit.data) unit.data = {};
      return unit.data;
    };

    const setAttackBonus = (unit, amount) => {
      const data = ensureData(unit);
      const current = typeof data[attackKey] === 'number' ? data[attackKey] : 0;
      if (current === amount) return;
      const base = typeof data.attack === 'number' ? data.attack : 0;
      const next = base + (amount - current);
      data.attack = next;
      if (amount === 0) delete data[attackKey];
      else data[attackKey] = amount;
    };

    const setHealthBonus = (unit, amount) => {
      const data = ensureData(unit);
      const current = typeof data[healthKey] === 'number' ? data[healthKey] : 0;
      if (current === amount) return;
      const diff = amount - current;
      const baseHealth = typeof data.health === 'number' ? data.health : 0;
      const baseMax = typeof data.maxHealth === 'number' ? data.maxHealth : baseHealth;
      data.health = baseHealth + diff;
      data.maxHealth = baseMax + diff;
      if (diff < 0) {
        data.maxHealth = Math.max(0, data.maxHealth);
        data.health = Math.max(0, Math.min(data.health, data.maxHealth));
      }
      if (amount === 0) delete data[healthKey];
      else data[healthKey] = amount;
    };

    const clearAura = () => {
      if (!player?.battlefield?.cards) return;
      for (const ally of player.battlefield.cards) {
        if (!ally || ally.type !== 'ally') continue;
        setAttackBonus(ally, 0);
        if (health !== 0 || (ally?.data && typeof ally.data[healthKey] === 'number')) {
          setHealthBonus(ally, 0);
        }
      }
    };

    const updateAllies = () => {
      if (disposed) return;
      if (!player?.battlefield?.cards) return;

      const active = isEquipped();
      if (!active) {
        if (!wasActive) return;
        clearAura();
        cleanup();
        return;
      }

      wasActive = true;
      for (const ally of player.battlefield.cards) {
        if (!ally || ally.type !== 'ally') continue;
        const hasKeyword = Array.isArray(ally.keywords) && ally.keywords.includes(keyword);
        const targetAttack = hasKeyword ? attack : 0;
        const targetHealth = hasKeyword ? health : 0;
        setAttackBonus(ally, targetAttack);
        if (health !== 0 || (ally?.data && typeof ally.data[healthKey] === 'number')) {
          setHealthBonus(ally, targetHealth);
        }
      }
    };

    track(game.bus.on('cardPlayed', ({ player: evtPlayer }) => {
      if (evtPlayer !== player) return;
      updateAllies();
    }));

    track(game.bus.on('unitSummoned', ({ player: evtPlayer }) => {
      if (evtPlayer !== player) return;
      updateAllies();
    }));

    track(game.bus.on('damageDealt', ({ player: srcPlayer, source, target }) => {
      if (srcPlayer === player || source === player.hero || target === player.hero) {
        updateAllies();
      }
    }));

      track(game.bus.on('cardReturned', ({ card: returned }) => {
        if (disposed) return;
        if (matchesCardIdentifier(returned, card)) {
          if (wasActive) clearAura();
          cleanup();
        }
      }));

    track(game.turns.bus.on('turn:start', ({ player: turnPlayer }) => {
      if (turnPlayer !== player) return;
      updateAllies();
    }));

    // Ensure existing allies are buffed once equipped (cardPlayed event will trigger post-equip).
  }

  registerFriendlyAuraBuff(effect, context) {
    const { game, player, card } = context;
    if (!game || !player || !card) return;

    const amount = Number(effect?.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) return;

    const propertyRaw = typeof effect?.property === 'string' ? effect.property.trim() : '';
    const property = propertyRaw || 'attack';

    const identifierList = [];
    const appendIdentifiers = (list) => {
      if (!Array.isArray(list)) return;
      for (const value of list) {
        if (value == null) continue;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) identifierList.push(trimmed);
        } else {
          identifierList.push(value);
        }
      }
    };

    appendIdentifiers(effect?.targetIdentifiers);
    appendIdentifiers(effect?.targetCardIds);
    appendIdentifiers(effect?.targetCards);

    const targetNameSet = new Set(
      (Array.isArray(effect?.targetNames) ? effect.targetNames : [])
        .filter((name) => typeof name === 'string' && name.trim().length)
        .map((name) => name.trim().toLowerCase())
    );

    const targetKeywordSet = new Set(
      (Array.isArray(effect?.targetKeywords) ? effect.targetKeywords : [])
        .filter((kw) => typeof kw === 'string' && kw.trim().length)
        .map((kw) => kw.trim().toLowerCase())
    );

    const includeSelf = effect?.includeSelf === true;

    const auraId = getCardInstanceId(card) || card.id || card.name || 'unknown';
    const keyBase = `friendlyAuraBuff:${auraId}:${property}`;
    const valueKey = `${keyBase}:value`;

    const ensureData = (unit) => {
      if (!unit.data) unit.data = {};
      return unit.data;
    };

    const applyBonus = (unit, value) => {
      const data = ensureData(unit);
      const current = Number.isFinite(data[valueKey]) ? data[valueKey] : 0;
      if (current === value) return;
      const delta = value - current;

      if (property === 'attack') {
        const base = Number.isFinite(data.attack)
          ? data.attack
          : Number.isFinite(unit.attack)
            ? unit.attack
            : 0;
        const next = base + delta;
        data.attack = next;
      } else if (property === 'health') {
        const baseHealth = Number.isFinite(data.health)
          ? data.health
          : Number.isFinite(unit.health)
            ? unit.health
            : 0;
        const baseMax = Number.isFinite(data.maxHealth)
          ? data.maxHealth
          : baseHealth;
        let nextHealth = baseHealth + delta;
        let nextMax = baseMax + delta;
        if (delta < 0) {
          nextMax = Math.max(0, nextMax);
          nextHealth = Math.max(0, Math.min(nextHealth, nextMax));
        }
        data.health = nextHealth;
        data.maxHealth = nextMax;
      } else {
        const baseValue = Number.isFinite(data[property])
          ? data[property]
          : Number.isFinite(unit[property])
            ? unit[property]
            : 0;
        data[property] = baseValue + delta;
      }

      if (value === 0) delete data[valueKey];
      else data[valueKey] = value;
    };

    const matchesTarget = (unit) => {
      if (!unit || unit.type !== 'ally') return false;
      if (!includeSelf && matchesCardIdentifier(unit, card)) return false;

      if (identifierList.length > 0) {
        for (const identifier of identifierList) {
          if (matchesCardIdentifier(unit, identifier)) return true;
        }
      }

      if (targetNameSet.size > 0 && typeof unit.name === 'string') {
        const normalized = unit.name.trim().toLowerCase();
        if (targetNameSet.has(normalized)) return true;
      }

      if (targetKeywordSet.size > 0 && Array.isArray(unit.keywords)) {
        for (const kw of unit.keywords) {
          if (typeof kw === 'string' && targetKeywordSet.has(kw.trim().toLowerCase())) return true;
        }
      }

      if (identifierList.length === 0 && targetNameSet.size === 0 && targetKeywordSet.size === 0) {
        return true;
      }

      return false;
    };

    const applyToAllies = (value) => {
      if (!player?.battlefield?.cards) return;
      for (const ally of player.battlefield.cards) {
        if (!ally || ally.type !== 'ally') continue;
        if (matchesTarget(ally)) {
          applyBonus(ally, value);
        } else if (ally?.data && typeof ally.data[valueKey] === 'number') {
          applyBonus(ally, 0);
        }
      }
    };

    let active = true;

    const offFns = [];
    const track = (off) => {
      if (typeof off === 'function') {
        const wrapped = this._trackCleanup(off);
        offFns.push(wrapped);
        return wrapped;
      }
      return off;
    };

    const dispose = () => {
      if (!active) return;
      active = false;
      applyToAllies(0);
      while (offFns.length) {
        const off = offFns.pop();
        try { off(); } catch {}
      }
    };

    const update = () => {
      applyToAllies(active ? amount : 0);
    };

    update();

    const handleFriendlyChange = ({ player: evtPlayer }) => {
      if (!active) return;
      if (evtPlayer !== player) return;
      update();
    };

    track(game.bus.on('cardPlayed', handleFriendlyChange));
    track(game.bus.on('unitSummoned', handleFriendlyChange));

    track(game.bus.on('allyDefeated', ({ player: evtPlayer, card: defeated }) => {
      if (!active) return;
      if (matchesCardIdentifier(defeated, card)) {
        dispose();
        return;
      }
      if (evtPlayer === player) update();
    }));

    track(game.bus.on('cardReturned', ({ player: evtPlayer, card: returned }) => {
      if (!active) return;
      if (matchesCardIdentifier(returned, card)) {
        dispose();
        return;
      }
      if (evtPlayer === player) update();
    }));

    track(game.turns.bus.on('turn:start', ({ player: turnPlayer }) => {
      if (!active) return;
      if (turnPlayer === player) update();
    }));
  }

  spellDamageWhileControl(effect, context) {
    const { game, player, card } = context;
    if (!game || !player || !player.hero) return;

    const hero = player.hero;
    const heroData = hero.data || (hero.data = {});
    const baseAmount = Number.isFinite(effect?.amount) ? effect.amount : 0;
    if (baseAmount === 0) return;

    const idList = [];
    if (Array.isArray(effect?.cardIds)) idList.push(...effect.cardIds);
    if (Array.isArray(effect?.cards)) idList.push(...effect.cards);
    if (Array.isArray(effect?.identifiers)) idList.push(...effect.identifiers);

    const nameList = Array.isArray(effect?.names) ? effect.names : [];
    const nameSet = new Set(
      nameList
        .filter((n) => typeof n === 'string' && n.trim().length)
        .map((n) => n.trim().toLowerCase())
    );

    if (idList.length === 0 && nameSet.size === 0) return;

    const keyBase = `spellDamageWhileControl:${card?.id || card?.name || 'unknown'}`;
    const valueKey = `${keyBase}:value`;
    const registeredKey = `${keyBase}:registered`;

    const matchesTarget = (unit) => {
      if (!unit || unit.type !== 'ally') return false;
      for (const identifier of idList) {
        if (matchesCardIdentifier(unit, identifier)) return true;
      }
      if (nameSet.size > 0 && typeof unit?.name === 'string') {
        const normalized = unit.name.trim().toLowerCase();
        if (nameSet.has(normalized)) return true;
      }
      return false;
    };

    const applyAmount = (active) => {
      const next = active ? baseAmount : 0;
      const prev = typeof heroData[valueKey] === 'number' ? heroData[valueKey] : 0;
      if (prev === next) return;
      const current = typeof heroData.spellDamage === 'number' ? heroData.spellDamage : 0;
      let updated = current + (next - prev);
      if (!Number.isFinite(updated)) updated = 0;
      if (updated < 0) updated = 0;
      heroData.spellDamage = updated;
      if (next === 0) delete heroData[valueKey];
      else heroData[valueKey] = next;
    };

    const update = () => {
      const allies = Array.isArray(player?.battlefield?.cards) ? player.battlefield.cards : [];
      const active = allies.some(matchesTarget);
      applyAmount(active);
    };

    update();

    if (heroData[registeredKey]) return;
    heroData[registeredKey] = true;

    const track = (off) => this._trackCleanup(off);

    track(game.bus.on('cardPlayed', ({ player: evtPlayer }) => {
      if (evtPlayer === player) update();
    }));

    track(game.bus.on('unitSummoned', ({ player: evtPlayer }) => {
      if (evtPlayer === player) update();
    }));

    track(game.bus.on('allyDefeated', ({ card: dead }) => {
      if (matchesTarget(dead)) update();
    }));

    track(game.bus.on('cardReturned', ({ card: returned }) => {
      if (matchesTarget(returned)) update();
    }));

    track(game.turns.bus.on('turn:start', ({ player: turnPlayer }) => {
      if (turnPlayer === player) update();
    }));
  }

  summonOnManaSpent(effect, context) {
    const { game, player, card } = context;
    if (!game || !player || !card) return;
    const bus = game.bus;
    if (!bus || typeof bus.on !== 'function') return;

    const hero = player.hero;
    if (!hero || hero !== card) return;

    const thresholdRaw = effect?.threshold ?? effect?.every ?? effect?.amount;
    const parsedThreshold = Number(thresholdRaw);
    if (!Number.isFinite(parsedThreshold)) return;
    const threshold = Math.max(1, Math.floor(parsedThreshold));

    const heroData = hero.data || (hero.data = {});
    const keyBase = `summonOnManaSpent:${card?.id || card?.name || 'unknown'}`;
    const registeredKey = `${keyBase}:registered`;
    if (heroData[registeredKey]) return;
    heroData[registeredKey] = true;

    const remainderKey = `${keyBase}:remainder`;
    const queueKey = `${keyBase}:pending`;
    const unitKey = `${keyBase}:unitTemplate`;
    if (!Number.isFinite(heroData[remainderKey])) heroData[remainderKey] = 0;
    if (!Array.isArray(heroData[queueKey])) heroData[queueKey] = [];

    const ensureKeywords = (list) => Array.isArray(list)
      ? list.filter((kw) => typeof kw === 'string')
      : [];

    const resolveUnitTemplate = () => {
      if (heroData[unitKey]) return heroData[unitKey];
      let template = null;
      const cardId = typeof effect?.cardId === 'string' ? effect.cardId.trim() : '';
      if (cardId) {
        const sourceCard = Array.isArray(game?.allCards)
          ? game.allCards.find((c) => c?.id === cardId)
          : null;
        if (sourceCard) {
          const atk = Number(sourceCard?.data?.attack);
          const hp = Number(sourceCard?.data?.health);
          const cost = Number(sourceCard?.cost);
          template = {
            id: sourceCard.id,
            name: sourceCard.name,
            attack: Number.isFinite(atk) ? atk : 0,
            health: Number.isFinite(hp) ? hp : 0,
            keywords: ensureKeywords(sourceCard.keywords),
            text: normalizeCardText(sourceCard.text),
            cost: Number.isFinite(cost) ? cost : null,
            tokenSource: sourceCard,
          };
        }
      }

      if (!template && effect?.unit && typeof effect.unit === 'object') {
        const atk = Number(effect.unit.attack ?? effect.unit.data?.attack);
        const hp = Number(effect.unit.health ?? effect.unit.data?.health);
        const cost = Number(effect.unit.cost ?? effect.unit.data?.cost);
        template = {
          id: typeof effect.unit.id === 'string' ? effect.unit.id : null,
          name: effect.unit.name ?? null,
          attack: Number.isFinite(atk) ? atk : 0,
          health: Number.isFinite(hp) ? hp : 0,
          keywords: ensureKeywords(effect.unit.keywords),
          text: normalizeCardText(effect.unit.text),
          cost: Number.isFinite(cost) ? cost : null,
          tokenSource: effect.unit.tokenSource || null,
        };
      }

      if (!template) return null;
      heroData[unitKey] = template;
      return template;
    };

    const commitPending = async (fallbackAmount = null) => {
      const queue = heroData[queueKey];
      let amount = 0;
      while (queue.length > 0) {
        const candidate = queue.shift();
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed > 0) {
          amount += parsed;
        }
      }

      if (amount <= 0 && Number.isFinite(fallbackAmount) && fallbackAmount > 0) {
        amount = fallbackAmount;
      }

      if (!Number.isFinite(amount) || amount <= 0) return;

      let remainder = Number(heroData[remainderKey]) || 0;
      remainder += amount;
      const triggers = Math.floor(remainder / threshold);
      remainder = remainder % threshold;
      heroData[remainderKey] = remainder;

      if (triggers <= 0) return;
      const unit = resolveUnitTemplate();
      if (!unit) return;

      const summonEffect = { type: 'summon', unit, count: triggers };
      await this.summonUnit(summonEffect, { game, player, card: hero });
    };

    const queueSpend = ({ player: evtPlayer, amount }) => {
      if (evtPlayer !== player) return;
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      heroData[queueKey].push(parsed);
    };

    const undoSpend = ({ player: evtPlayer, amount }) => {
      if (evtPlayer !== player) return;
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      const queue = heroData[queueKey];
      if (queue.length > 0) {
        const idx = queue.lastIndexOf(parsed);
        if (idx >= 0) {
          queue.splice(idx, 1);
          return;
        }
      }
      let remainder = Number(heroData[remainderKey]) || 0;
      remainder -= parsed;
      if (remainder < 0) remainder = 0;
      heroData[remainderKey] = remainder;
    };

    const finalizeCard = (payload) => {
      if (payload?.player !== player) return;
      commitPending().catch(() => {});
    };

    const finalizeHeroPower = (payload) => {
      if (payload?.player !== player) return;
      const parsed = Number(payload?.cost);
      commitPending(Number.isFinite(parsed) && parsed > 0 ? parsed : null).catch(() => {});
    };

    const track = (off) => this._trackCleanup(off);
    track(bus.on('resources:spent', queueSpend));
    track(bus.on('resources:refunded', undoSpend));
    track(bus.on('cardPlayed', finalizeCard));
    track(bus.on('heroPowerUsed', finalizeHeroPower));
  }

  chooseBothOnManaSpent(effect, context) {
    const { game, player, card } = context || {};
    if (!game || !player || !card) return;

    const hero = player.hero;
    if (!hero || hero !== card) return;

    const bus = game.bus;
    const turnBus = game.turns?.bus;
    if (!bus?.on || !turnBus?.on) return;

    const thresholdRaw = effect?.threshold ?? effect?.amount ?? effect?.every ?? effect?.requiresSpent;
    const parsedThreshold = Number(thresholdRaw);
    const threshold = Number.isFinite(parsedThreshold) ? Math.max(0, parsedThreshold) : 3;

    const heroData = hero.data || (hero.data = {});
    const state = heroData.chooseBothOnManaSpentState ||= { threshold, spentThisTurn: 0 };
    state.threshold = threshold;
    state.spentThisTurn = 0;

    const keyBase = `chooseBothOnManaSpent:${hero.id || hero.name || 'hero'}`;
    const registeredKey = `${keyBase}:registered`;
    if (heroData[registeredKey]) return;
    heroData[registeredKey] = true;

    const track = (off) => this._trackCleanup(off);

    track(turnBus.on('turn:start', ({ player: turnPlayer }) => {
      if (turnPlayer !== player) return;
      state.spentThisTurn = 0;
    }));

    track(bus.on('resources:spent', ({ player: evtPlayer, amount }) => {
      if (evtPlayer !== player) return;
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      state.spentThisTurn += parsed;
    }));

    track(bus.on('resources:refunded', ({ player: evtPlayer, amount }) => {
      if (evtPlayer !== player) return;
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      state.spentThisTurn -= parsed;
      if (state.spentThisTurn < 0) state.spentThisTurn = 0;
    }));
  }

  firstKeywordCostReduction(effect, context) {
    const { player, game } = context || {};
    const hero = player?.hero;
    if (!hero) return;

    const keywordRaw = effect?.keyword;
    if (typeof keywordRaw !== 'string') return;

    const normalizedKeyword = keywordRaw.trim().toLowerCase();
    if (!normalizedKeyword) return;

    const amountRaw = Number(effect?.amount ?? 0);
    const minimumRaw = Number(effect?.minimum ?? 0);
    const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 0;
    const minimum = Number.isFinite(minimumRaw) && minimumRaw > 0 ? minimumRaw : 0;

    const heroData = hero.data || (hero.data = {});
    const state = heroData.firstKeywordCostReduction ||= {};
    const entry = state[normalizedKeyword] ||= {};

    entry.amount = amount;
    entry.minimum = minimum;
    entry.turnPrepared = game?.turns?.turn ?? null;
    entry.ready = true;
    entry.usedTurn = null;
    entry.lastCardInstanceId = null;
    entry.lastReduction = 0;
  }

  firstHealCostReduction(effect, context) {
    const { player, game } = context || {};
    const hero = player?.hero;
    if (!hero) return;

    const amountRaw = Number(effect?.amount ?? 0);
    const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 0;

    const heroData = hero.data || (hero.data = {});
    const state = heroData.firstHealCostReduction ||= {};

    const currentTurn = game?.turns?.turn ?? null;
    const previousPreparedTurn = state.turnPrepared ?? null;

    if (previousPreparedTurn !== currentTurn) {
      state.ready = amount > 0;
      state.usedTurn = null;
      state.lastToken = null;
      state.lastReduction = 0;
    }

    state.turnPrepared = currentTurn;
    state.amount = amount;
    if (amount <= 0) {
      state.ready = false;
    }
  }

  keywordCostReduction(effect, context) {
    const { player } = context;
    if (!player || !player.hand) return;

    const keywordRaw = effect?.keyword ?? effect?.tribe ?? null;
    if (!keywordRaw) return;

    const normalizedKeyword = String(keywordRaw).trim().toLowerCase();
    if (!normalizedKeyword) return;

    const amount = Number(effect?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const minimum = Number(effect?.minimum ?? 0);
    const minimumCost = Number.isFinite(minimum) ? Math.max(0, minimum) : 0;

    const hand = player.hand;
    const hero = player.hero;
    if (!hero || !hand) return;

    if (Object.prototype.hasOwnProperty.call(hand, 'add')) {
      delete hand.add;
    }
    if (Object.prototype.hasOwnProperty.call(hand, '__postAddHooks')) {
      delete hand.__postAddHooks;
    }
    if (Object.prototype.hasOwnProperty.call(hand, '__postAddHooked')) {
      delete hand.__postAddHooked;
    }

    const heroData = hero.data || (hero.data = {});
    const state = heroData.keywordCostReductionState ||= {};
    const keyBase = `keywordCostReduction:${hero.id || hero.name || 'hero'}:${normalizedKeyword}`;
    const modKey = `${keyBase}:${amount}:${minimumCost}`;
    const descriptor = {
      id: `${modKey}:hook`,
      type: HAND_HOOK_TYPE_KEYWORD_COST_REDUCTION,
      modKey,
      normalizedKeyword,
      amount,
      minimumCost,
    };

    const cards = Array.isArray(hand?.cards) ? hand.cards : [];
    for (const handCard of cards) {
      applyKeywordCostReductionDescriptorToCard(handCard, descriptor);
    }

    const hookKey = descriptor.id;
    addHandHookDescriptor(hand, descriptor);
    state[hookKey] = true;
  }

  async healCharacter(effect, context) {
    const { target, amount } = effect;
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;
    const promptTitle = this._describeHealPrompt(effect);

    let actualTargets = [];

    switch (target) {
      case 'character': {
        const friendly = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter((target) => isTargetable(target, { requester: player }));

        // If it's the AI's turn, default to healing its own hero
        if (game.turns.activePlayer && game.turns.activePlayer !== game.player) {
          actualTargets.push(player.hero);
          break;
        }

        const enemy = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest')
        ]);
        const candidates = [...friendly, ...enemy];
        const promptOptions = {
          preferredSide: 'friendly',
          actingPlayer: player,
        };
        if (promptTitle) promptOptions.title = promptTitle;
        const chosen = await game.promptTarget(candidates, promptOptions);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'selfHero':
      default:
        actualTargets.push(player.hero);
        break;
    }

    for (const t of actualTargets) {
      this._recordTarget(context, t);
      // Determine max health with sensible fallbacks (heroes default to 30)
      const curRaw = t?.data?.health ?? t?.health;
      const maxRaw = t?.data?.maxHealth ?? t?.maxHealth ?? (t?.type === 'hero' ? 30 : curRaw);
      const healAmountRaw = Number(amount ?? 0);
      const healAmount = Number.isFinite(healAmountRaw) ? healAmountRaw : 0;
      let current = Number(curRaw);
      if (!Number.isFinite(current)) current = 0;
      let max = Number(maxRaw);
      if (!Number.isFinite(max)) max = current;
      const nextHealth = Math.min(current + healAmount, max);
      const actualAmount = Math.max(0, nextHealth - current);
      if (t?.data && t.data.health != null) {
        t.data.health = nextHealth;
        console.log(`${t.name} healed for ${healAmount}. Current health: ${t.data.health}`);
      } else if (t?.health != null) {
        t.health = nextHealth;
        console.log(`${t.name} healed for ${healAmount}. Current health: ${t.health}`);
      }
      const becameFull = Number.isFinite(max) ? current < max && nextHealth >= max : false;
      const wasFullBefore = Number.isFinite(max) ? current >= max : false;
      game.bus.emit('characterHealed', {
        player,
        target: t,
        amount: healAmount,
        actualAmount,
        previousHealth: current,
        newHealth: nextHealth,
        maxHealth: max,
        source: card,
        becameFull,
        wasFullBefore,
      });
    }
  }

  drawCard(effect, context) {
    const { count } = effect;
    const { game, player } = context;
    game.draw(player, count);
    console.log(`${player.name} drew ${count} card(s).`);
  }

  explosiveTrap(effect, context, opts = {}) {
    const { amount = 2 } = effect;
    const { game, player, card } = context;
    const { restoreToken = null, skipEmit = false } = opts;

    // Track an active secret on the owner's hero for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = restoreToken
      ? enrichSecretToken(restoreToken)
      : rememberSecretToken(effect, context, { type: 'explosiveTrap' });
    if (!restoreToken) {
      secrets.push(token);
      if (!skipEmit) {
        try { game.bus.emit('secret:added', { player, card }); } catch {}
        try { game._uiRerender?.(); } catch {}
      }
    }

    const handler = async ({ target }) => {
      if (target !== player.hero) return;
      off();
      logSecretTriggered(game, player, { card, token });
      // Remove the secret indicator when it triggers
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}
      await game.effects.dealDamage(
        { target: 'allCharacters', amount },
        { game, player, card }
      );
    };

    const off = this._trackCleanup(game.bus.on('damageDealt', handler));
    return token;
  }

  freezingTrap(effect, context, opts = {}) {
    const { game, player, card } = context;
    const { restoreToken = null, skipEmit = false } = opts;
    const opponent = player === game.player ? game.opponent : game.player;

    // Track an active secret on the owner's hero for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = restoreToken
      ? enrichSecretToken(restoreToken)
      : rememberSecretToken(effect, context, { type: 'freezingTrap' });
    if (!restoreToken) {
      secrets.push(token);
      if (!skipEmit) {
        try { game.bus.emit('secret:added', { player, card }); } catch {}
        try { game._uiRerender?.(); } catch {}
      }
    }

    const handler = ({ attacker }) => {
      // Trigger only when an enemy ally (not hero/equipment) declares an attack
      if (!attacker || attacker.type !== 'ally') return;
      // Ensure the attacker belongs to the opponent side at the moment of attack
      const isEnemy = opponent.battlefield.cards.includes(attacker);
      if (!isEnemy) return;

      // Cancel the attack via flag recognized by CombatSystem
      attacker.data = attacker.data || {};
      attacker.data.attackCancelled = true;

      // Return to owner's hand and increase cost by 2
      opponent.battlefield.moveTo(opponent.hand, attacker);
      attacker.cost = (attacker.cost || 0) + 2;
      game.bus.emit('cardReturned', { player, card: attacker });

      // Secret triggers once
      off();
      logSecretTriggered(game, player, { card, token });
      // Remove the secret indicator when it triggers
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}
    };

    const off = this._trackCleanup(game.bus.on('attackDeclared', handler));
    return token;
  }

  snakeTrap(effect, context, opts = {}) {
    const { game, player, card } = context;
    const { restoreToken = null, skipEmit = false } = opts;
    // Track an active secret on the owner's hero for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = restoreToken
      ? enrichSecretToken(restoreToken)
      : rememberSecretToken(effect, context, { type: 'snakeTrap' });
    if (!restoreToken) {
      secrets.push(token);
      if (!skipEmit) {
        try { game.bus.emit('secret:added', { player, card }); } catch {}
        try { game._uiRerender?.(); } catch {}
      }
    }

    const opponent = player === game.player ? game.opponent : game.player;

    const handler = async ({ attacker, defender: target }) => {
      // Trigger only when an enemy attacks one of the player's allies
      if (!attacker) return;
      const isEnemy = opponent.battlefield.cards.includes(attacker) || attacker === opponent.hero;
      if (!isEnemy) return;
      const isFriendlyAllyTarget =
        target && target !== player.hero && target.type === 'ally' && player.battlefield.cards.includes(target);
      if (!isFriendlyAllyTarget) return;
      off();
      logSecretTriggered(game, player, { card, token });
      // Remove the secret indicator when it triggers
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}

      // Summon three 1/1 Snakes with Rush
      const summon = {
        type: 'summon',
        unit: { name: 'Snake', attack: 1, health: 1, keywords: ['Rush'] },
        count: 3,
      };
      await game.effects.summonUnit(summon, { game, player, card });
    };

    const off = this._trackCleanup(game.bus.on('attackDeclared', handler));
    return token;
  }

  counterShot(effect, context) {
    // Marker-only; actual counter resolution happens in Game.playFromHand
    const { game, player, card } = context;
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    secrets.push(rememberSecretToken(effect, context, { type: 'counterShot' }));
    try { game.bus.emit('secret:added', { player, card }); } catch {}
    try { game._uiRerender?.(); } catch {}
  }

  retaliationRunes(effect, context, opts = {}) {
    const { game, player, card } = context;
    const { restoreToken = null, skipEmit = false } = opts;
    const amount = typeof effect.amount === 'number' ? effect.amount : 2;
    // Track secret for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = restoreToken
      ? enrichSecretToken(restoreToken)
      : rememberSecretToken(effect, context, { type: 'retaliationRunes' });
    if (!restoreToken) {
      secrets.push(token);
      if (!skipEmit) {
        try { game.bus.emit('secret:added', { player, card }); } catch {}
        try { game._uiRerender?.(); } catch {}
      }
    }

    const opponent = player === game.player ? game.opponent : game.player;

    const handler = async ({ player: srcOwner, source, target }) => {
      // Trigger only when a friendly character (hero or ally) takes damage from the opponent
      const isFriendlyTarget = (target === player.hero) || player.battlefield.cards.includes(target);
      const fromOpponent = srcOwner === opponent;
      if (!isFriendlyTarget || !fromOpponent) return;

      off();
      logSecretTriggered(game, player, { card, token });
      // Remove secret indicator
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}

      // Only reflect if the source is a character on the battlefield
      if (source && (source === opponent.hero || opponent.battlefield.cards.includes(source))) {
        const prev = game.promptTarget;
        try {
          game.promptTarget = async () => source;
          await game.effects.dealDamage(
            { target: 'character', amount, usesSpellDamage: false },
            { game, player, card }
          );
        } finally {
          game.promptTarget = prev;
        }
      }
    };

    const off = this._trackCleanup(game.bus.on('damageDealt', handler));
    return token;
  }

  vengefulSpirit(effect, context, opts = {}) {
    const { game, player, card } = context;
    const { restoreToken = null, skipEmit = false } = opts;
    const amount = typeof effect.amount === 'number' ? effect.amount : 3;
    // Track secret for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = restoreToken
      ? enrichSecretToken(restoreToken)
      : rememberSecretToken(effect, context, { type: 'vengefulSpirit' });
    if (!restoreToken) {
      secrets.push(token);
      if (!skipEmit) {
        try { game.bus.emit('secret:added', { player, card }); } catch {}
        try { game._uiRerender?.(); } catch {}
      }
    }

    const opponent = player === game.player ? game.opponent : game.player;

    const handler = async ({ player: killer, card: dead }) => {
      // Our ally died when the killer is the opponent side
      if (killer !== opponent) return;

      off();
      logSecretTriggered(game, player, { card, token });
      // Remove secret indicator
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}

      // Deal damage to a random enemy character (hero or ally)
      const enemies = [opponent.hero, ...opponent.battlefield.cards.filter(c => c.type !== 'quest')];
      const candidates = enemies.filter(Boolean);
      if (!candidates.length) return;
      const chosen = game.rng.pick(candidates);
      const prev = game.promptTarget;
      try {
        game.promptTarget = async () => chosen;
        await game.effects.dealDamage(
          { target: 'character', amount, usesSpellDamage: false },
          { game, player, card }
        );
      } finally {
        game.promptTarget = prev;
      }
    };

    const off = this._trackCleanup(game.bus.on('allyDefeated', handler));
    return token;
  }

  drawOnHeal(effect, context) {
    const { count = 1, threshold = 0 } = effect;
    const { game, player, card } = context;

    const handler = ({ player: healedPlayer, amount, actualAmount }) => {
      if (healedPlayer !== player) return;
      card.data = card.data || {};
      const healedValueRaw = typeof actualAmount === 'number' ? actualAmount : amount;
      const healedValue = Number.isFinite(healedValueRaw) ? healedValueRaw : 0;
      card.data.healedThisTurn = (card.data.healedThisTurn || 0) + healedValue;
      if (card.data.drawnThisTurn) return;
      if (card.data.healedThisTurn >= threshold) {
        game.draw(player, count);
        card.data.drawnThisTurn = true;
      }
    };

    const reset = ({ player: turnPlayer }) => {
      if (turnPlayer === player && card.data) {
        card.data.drawnThisTurn = false;
        card.data.healedThisTurn = 0;
      }
    };

    const offHeal = this._trackCleanup(game.bus.on('characterHealed', handler));
    const offTurn = this._trackCleanup(game.turns.bus.on('turn:start', reset));

    const remove = () => {
      offHeal();
      offTurn();
      offDeath();
      offReturn();
    };

    const offDeath = this._trackCleanup(game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    }));

    const offReturn = this._trackCleanup(game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    }));
  }

  drawOnFullHeal(effect, context) {
    const { count = 1 } = effect || {};
    const { game, player, card } = context || {};
    if (!game || !player || !card) return;

    card.data = card.data || {};
    const state = card.data.drawOnFullHealState ||= {};
    const sanitizedCountRaw = Number(count ?? 1);
    const sanitizedCount = Number.isFinite(sanitizedCountRaw)
      ? Math.max(1, Math.floor(sanitizedCountRaw))
      : 1;
    state.count = sanitizedCount;

    if (state.initialized) return;

    state.initialized = true;
    state.drawnThisTurn = false;

    const toFinite = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const isFriendlyTarget = (target) => {
      if (!target) return false;
      if (target === player.hero) return true;
      const battlefieldCards = player?.battlefield?.cards;
      return Array.isArray(battlefieldCards) && battlefieldCards.includes(target);
    };

    const didReachFullHealth = (payload = {}) => {
      if (payload.becameFull != null) return Boolean(payload.becameFull);
      const previous = toFinite(payload.previousHealth);
      const next = toFinite(payload.newHealth);
      const max = toFinite(payload.maxHealth);
      if (previous != null && next != null && max != null) {
        return previous < max && next >= max;
      }
      return false;
    };

    const handler = (payload = {}) => {
      const { player: healedPlayer, target } = payload;
      if (healedPlayer !== player) return;
      if (!isFriendlyTarget(target)) return;
      if (!didReachFullHealth(payload)) return;
      if (state.drawnThisTurn) return;
      game.draw(player, state.count || 1);
      state.drawnThisTurn = true;
    };

    const reset = ({ player: turnPlayer } = {}) => {
      if (turnPlayer === player) state.drawnThisTurn = false;
    };

    const cleanupFns = [];
    const offHeal = this._trackCleanup(game.bus.on('characterHealed', handler));
    if (offHeal) cleanupFns.push(offHeal);
    const offTurn = this._trackCleanup(game.turns.bus.on('turn:start', reset));
    if (offTurn) cleanupFns.push(offTurn);

    const remove = () => {
      while (cleanupFns.length) {
        const off = cleanupFns.pop();
        try { off?.(); } catch {}
      }
      state.initialized = false;
      state.drawnThisTurn = false;
    };

    const offDeath = this._trackCleanup(game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    }));
    if (offDeath) cleanupFns.push(offDeath);

    const offReturn = this._trackCleanup(game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    }));
    if (offReturn) cleanupFns.push(offReturn);
  }

  healAtEndOfTurn(effect, context) {
    const { amount, target = 'randomCharacter' } = effect;
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    const handler = ({ player: turnPlayer }) => {
      if (turnPlayer === player) return;

      let candidates = [];
      switch (target) {
        case 'randomFriendlyCharacter':
          candidates = [
            player.hero,
            ...player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomEnemyCharacter':
          candidates = [
            opponent.hero,
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomCharacter':
        default:
          candidates = [
            player.hero,
            ...player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
            opponent.hero,
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
      }
      candidates = candidates
        .filter(t => (t.data && t.data.health != null) || t.health != null)
        .filter((entity) => isTargetable(entity, { requester: player }));

      if (!candidates.length) return;
      const targetChar = game.rng.pick(candidates);

      // Determine max health with sensible fallbacks (heroes default to 30)
      const curRaw = targetChar?.data?.health ?? targetChar?.health;
      const maxRaw = targetChar?.data?.maxHealth ?? targetChar?.maxHealth ?? (targetChar?.type === 'hero' ? 30 : curRaw);
      const healAmountRaw = Number(amount ?? 0);
      const healAmount = Number.isFinite(healAmountRaw) ? healAmountRaw : 0;
      let current = Number(curRaw);
      if (!Number.isFinite(current)) current = 0;
      let max = Number(maxRaw);
      if (!Number.isFinite(max)) max = current;
      const nextHealth = Math.min(current + healAmount, max);
      const actualAmount = Math.max(0, nextHealth - current);
      if (targetChar?.data && targetChar.data.health != null) {
        targetChar.data.health = nextHealth;
        console.log(`${targetChar.name} healed for ${healAmount}. Current health: ${targetChar.data.health}`);
      } else if (targetChar?.health != null) {
        targetChar.health = nextHealth;
        console.log(`${targetChar.name} healed for ${healAmount}. Current health: ${targetChar.health}`);
      }

      const becameFull = Number.isFinite(max) ? current < max && nextHealth >= max : false;
      const wasFullBefore = Number.isFinite(max) ? current >= max : false;
      const healedPlayer =
        targetChar === player.hero || player.battlefield.cards.includes(targetChar) ? player : opponent;
      game.bus.emit('characterHealed', {
        player: healedPlayer,
        target: targetChar,
        amount: healAmount,
        actualAmount,
        previousHealth: current,
        newHealth: nextHealth,
        maxHealth: max,
        source: card,
        becameFull,
        wasFullBefore,
      });
    };

    const offTurn = this._trackCleanup(game.turns.bus.on('turn:start', handler));

    const remove = () => {
      offTurn();
      offDeath();
      offReturn();
    };

    const offDeath = this._trackCleanup(game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    }));

    const offReturn = this._trackCleanup(game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    }));
  }

  gainArmorAtEndOfTurn(effect, context) {
    const { game, player, card } = context || {};
    if (!game || !player || !card) return;

    const hero = player.hero;
    if (!hero || hero !== card) return;

    const amountRaw = Number(effect?.amount ?? 0);
    const amount = Number.isFinite(amountRaw) ? Math.max(0, Math.floor(amountRaw)) : 0;
    if (amount <= 0) return;

    const heroData = hero.data || (hero.data = {});
    const keyBase = `gainArmorAtEndOfTurn:${hero.id || hero.name || 'hero'}`;
    const registeredKey = `${keyBase}:registered`;
    if (heroData[registeredKey]) return;
    heroData[registeredKey] = true;

    const handler = async ({ player: turnPlayer }) => {
      if (turnPlayer === player) return;
      await this.applyBuff(
        { type: 'buff', target: 'hero', property: 'armor', amount },
        context
      );
    };

    this._trackCleanup(game.turns.bus.on('turn:start', handler));
    this._trackCleanup(() => {
      delete heroData[registeredKey];
    });
  }

  buffAtEndOfTurn(effect, context) {
    const { property = 'attack', amount = 1, target = 'randomFriendlyAlly' } = effect;
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    const handler = async ({ player: turnPlayer }) => {
      // Trigger at the start of the opponent's turn (end of controller's turn)
      if (turnPlayer === player) return;

      let candidates = [];
      switch (target) {
        case 'randomFriendlyAlly':
        case 'randomAlly':
        default:
          candidates = [
            ...player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomFriendlyCharacter':
          candidates = [
            player.hero,
            ...player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomEnemyCharacter':
          candidates = [
            opponent.hero,
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomEnemyAlly':
          candidates = [
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
      }

      candidates = candidates.filter((entity) => isTargetable(entity, { requester: player }));
      if (!candidates.length) return;

      const targetChar = game.rng.pick(candidates);
      await this.applyBuff(
        { type: 'buff', target: 'character', property, amount },
        { game, player, card },
        targetChar
      );
    };

    const offTurn = this._trackCleanup(game.turns.bus.on('turn:start', handler));

    const remove = () => {
      offTurn();
      offDeath();
      offReturn();
    };

    const offDeath = this._trackCleanup(game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    }));

    const offReturn = this._trackCleanup(game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    }));
  }

  async destroyMinion(effect, context) {
    const { target = 'enemyAlly', condition } = effect;
    const { game, player } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    const collectAllies = (owner) => owner.battlefield.cards.filter(c => c.type === 'ally');

    let candidates;
    switch (target) {
      case 'ally':
      case 'friendlyAlly':
      case 'friendlyMinion':
        candidates = collectAllies(player);
        break;
      case 'anyAlly':
      case 'anyMinion':
        candidates = [...collectAllies(player), ...collectAllies(opponent)];
        break;
      case 'minion':
      case 'enemyAlly':
      case 'enemyMinion':
      default:
        candidates = collectAllies(opponent);
        break;
    }

    const getAttackValue = (unit) => {
      if (!unit) return 0;
      if (typeof unit.totalAttack === 'function') {
        try {
          return unit.totalAttack();
        } catch (err) {
          // Ignore errors from custom totalAttack implementations and fall back to data.
        }
      }
      if (typeof unit?.data?.attack === 'number') return unit.data.attack;
      if (typeof unit?.attack === 'number') return unit.attack;
      return 0;
    };

    candidates = candidates
      .filter((entity) => isTargetable(entity, { requester: player }))
      .filter((c) => {
        if (!condition) return true;
        switch (condition.type) {
          case 'attackLessThan':
            return getAttackValue(c) <= (condition.amount ?? 0);
          default:
            return true;
        }
      });

    if (!candidates.length) {
      console.log('No minion found to destroy.');
      return;
    }

    let chosen;
    const promptTitle = this._describeDestroyPrompt(effect);
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      const promptOptions = { actingPlayer: player };
      if (promptTitle) promptOptions.title = promptTitle;
      chosen = await game.promptTarget(candidates, promptOptions);
      if (chosen === game.CANCEL) throw game.CANCEL;
      if (!chosen) return;
    }

    const owner = player.battlefield.cards.includes(chosen)
      ? player
      : opponent.battlefield.cards.includes(chosen)
        ? opponent
        : null;

    if (!owner) {
      console.log('No minion found to destroy.');
      return;
    }

    this._recordTarget(context, chosen);
    owner.battlefield.moveTo(owner.graveyard, chosen);
    console.log(`Destroyed ${chosen.name}.`);
  }

  async returnToHand(effect, context) {
    const { target, costIncrease = 0 } = effect;
    const { game, player } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    // Build candidate pool based on target; default to enemy allies
    let candidates = [];
    switch (target) {
      case 'enemyAlly':
      default:
        candidates = opponent.battlefield.cards.filter(c => c.type === 'ally');
        break;
      case 'ally':
        candidates = player.battlefield.cards.filter(c => c.type === 'ally');
        break;
      case 'anyAlly':
        candidates = [
          ...player.battlefield.cards.filter(c => c.type === 'ally'),
          ...opponent.battlefield.cards.filter(c => c.type === 'ally'),
        ];
        break;
    }

    // Respect targetability/taunt rules via selector
    candidates = selectTargets(candidates, {}, { requester: player })
      .filter((entity) => isTargetable(entity, { requester: player }));

    if (!candidates.length) {
      console.log('No valid ally found to return to hand.');
      return;
    }

    // Let the acting side pick a target (AI auto-picks via promptTarget)
    const preferFriendly = target === 'ally' || target === 'anyAlly';
    const promptOptions = {
      preferredSide: preferFriendly ? 'friendly' : 'enemy',
      actingPlayer: player,
    };
    const promptTitle = this._describeReturnPrompt(effect);
    if (promptTitle) promptOptions.title = promptTitle;
    const chosen = await game.promptTarget(candidates, promptOptions);
    if (chosen === game.CANCEL) throw game.CANCEL;
    if (!chosen) return;

    const owner = opponent.battlefield.cards.includes(chosen) ? opponent
                : player.battlefield.cards.includes(chosen) ? player
                : null;
    if (!owner) return;

    this._recordTarget(context, chosen);
    owner.battlefield.moveTo(owner.hand, chosen);
    chosen.cost = (chosen.cost || 0) + costIncrease;
    console.log(`Returned ${chosen.name} to hand. New cost: ${chosen.cost}`);
    game.bus.emit('cardReturned', { player, card: chosen });
  }

  async buffBeast(effect, context) {
    const { attack = 0, health = 0, keywords = [], duration } = effect;
    const { game, player } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    const beasts = [
      ...player.battlefield.cards,
      ...opponent.battlefield.cards,
    ]
      .filter(c => c.keywords?.includes('Beast') && c.type !== 'quest')
      .filter((entity) => isTargetable(entity, { requester: player }));

    if (!beasts.length) return;

    const promptOptions = {
      preferredSide: 'friendly',
      actingPlayer: player,
    };
    const promptTitle = this._describeBuffBeastPrompt(effect);
    if (promptTitle) promptOptions.title = promptTitle;
    const chosen = await game.promptTarget(beasts, promptOptions);
    if (chosen === game.CANCEL) throw game.CANCEL;
    if (!chosen) return;

    if (attack) {
      await this.applyBuff({ target: 'character', property: 'attack', amount: attack, duration }, context, chosen);
    }
    if (health) {
      await this.applyBuff({ target: 'character', property: 'health', amount: health, duration }, context, chosen);
    }

    for (const kw of keywords) {
      if (!chosen.keywords) chosen.keywords = [];
      if (!chosen.keywords.includes(kw)) {
        chosen.keywords.push(kw);
        if (duration === 'thisTurn') {
          const revertEffect = { revert: () => { chosen.keywords = chosen.keywords.filter(k => k !== kw); } };
          this.temporaryEffects.push(revertEffect);
        }
      }
    }
  }

  async buffTribe(effect, context) {
    const {
      tribe,
      attack = 0,
      health = 0,
      armor = 0,
      spellDamage = 0,
      duration,
      includeSource = false,
      excludeSource = false,
    } = effect;

    if (!tribe) return;

    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    const battlefieldMembers = [
      ...player.battlefield.cards,
      ...opponent.battlefield.cards,
    ].filter(c => c.type !== 'quest' && c.keywords?.includes(tribe));

    const targets = new Set(battlefieldMembers);

    if (includeSource && card?.keywords?.includes(tribe)) {
      targets.add(card);
    }

    if (excludeSource && card) {
      targets.delete(card);
    }

    if (!targets.size) return;

    const properties = [
      ['attack', attack],
      ['health', health],
      ['armor', armor],
      ['spellDamage', spellDamage],
    ];

    for (const target of targets) {
      for (const [property, value] of properties) {
        if (typeof value !== 'number' || value === 0) continue;
        await this.applyBuff(
          { target: 'character', property, amount: value, duration },
          context,
          target
        );
      }
    }
  }

  async gainStatsPerTribe(effect, context) {
    const {
      tribe,
      attackPer = 0,
      healthPer = 0,
      includeSource = false,
      excludeSource = false,
    } = effect;

    if (!tribe) return;

    const { game, player, card } = context;
    if (!card) return;

    const opponent = player === game.player ? game.opponent : game.player;

    const battlefieldMembers = [
      ...player.battlefield.cards,
      ...opponent.battlefield.cards,
    ].filter(c => c.type !== 'quest' && c.keywords?.includes(tribe));

    const targets = new Set(battlefieldMembers);
    const sourceIsTribe = !!card?.keywords?.includes(tribe);

    if (includeSource && sourceIsTribe) {
      targets.add(card);
    }

    if (excludeSource && card) {
      targets.delete(card);
    }

    const count = targets.size;

    const attackGain = attackPer * count;
    const healthGain = healthPer * count;

    if (typeof attackGain === 'number' && attackGain !== 0) {
      await this.applyBuff(
        { target: 'character', property: 'attack', amount: attackGain },
        context,
        card
      );
    }

    if (typeof healthGain === 'number' && healthGain !== 0) {
      await this.applyBuff(
        { target: 'character', property: 'health', amount: healthGain },
        context,
        card
      );
    }
  }

  transformCharacter(effect, context) {
    const { target, into, duration } = effect;
    const { game, player } = context;

    let pool = player.battlefield.cards
      .filter(c => c.type !== 'quest')
      .filter((entity) => isTargetable(entity, { requester: player }));
    if (target === 'randomAlly') {
      pool = pool.filter(c => c.type === 'ally' || c.summonedBy);
    }

    if (pool.length > 0) {
      const allyToTransform = game.rng.pick(pool);
      this._recordTarget(context, allyToTransform);
      const originalData = { ...allyToTransform.data };
      const originalKeywords = [...(allyToTransform.keywords || [])];
      const originalName = allyToTransform.name; // Store original name

      allyToTransform.name = into.name;
      allyToTransform.data.attack = into.attack;
      allyToTransform.data.health = into.health;
      allyToTransform.data.maxHealth = into.health;
      allyToTransform.keywords = into.keywords;

      if (duration === 'endOfTurn') {
        const revertEffect = {
          revert: () => {
            allyToTransform.name = originalName; // Revert name
            allyToTransform.data.attack = originalData.attack;
            allyToTransform.data.health = originalData.health;
            if (typeof originalData.maxHealth === 'number') {
              allyToTransform.data.maxHealth = originalData.maxHealth;
            } else {
              allyToTransform.data.maxHealth = originalData.health;
            }
            allyToTransform.keywords = originalKeywords;
          }
        };
        this.temporaryEffects.push(revertEffect);
      }
      console.log(`Transformed ${allyToTransform.name} into a ${into.name}.`);
    } else {
      console.log('No valid ally found to transform.');
    }
  }

  async playRandomConsumableFromLibrary(effect, context) {
    const { player, game } = context;
    const consumables = player.library.cards.filter(c => c.type === 'consumable');
    if (!consumables.length) return;
    const card = game.rng.pick(consumables);
    player.library.remove(card);
    player.hand.add(card);
    const originalCost = card.cost || 0;
    card.cost = 0;
    const cardRef = getCardInstanceId(card) ?? card;
    await game.playFromHand(player, cardRef);
    card.cost = originalCost;
  }

  registerDefaults() {
    // Remove the old regex-based registration
    // this.register(/Give your hero and allies \+(\d+) ATK this turn/, (game, context, match) => { ... });
  }

  cleanupTemporaryEffects() {
    for (const effect of this.temporaryEffects) {
      effect.revert();
    }
    this.temporaryEffects = [];
    console.log('Cleaned up temporary effects.');
  }

  async applyBuff(effect, context, forcedTarget = null) {
    const { target, property, amount, duration } = effect;
    const allowHeroTargets = effect.allowHero !== false;
    const { player, game } = context;
    const opponent = player === game.player ? game.opponent : game.player;
    const promptTitle = this._describeBuffEffect(effect);

    let actualTargets = [];

    switch (target) {
      case 'allies':
        actualTargets.push(player.hero);
        actualTargets.push(...player.battlefield.cards.filter(c => c.type !== 'quest'));
        break;
      case 'hero':
        actualTargets.push(player.hero);
        break;
      case 'character': {
        if (forcedTarget) {
          if (!allowHeroTargets && forcedTarget?.type === 'hero') {
            return;
          }
          actualTargets.push(forcedTarget);
        } else {
          // Allow enemy targets when this is a debuff (negative amount)
          const isDebuff = typeof amount === 'number' && amount < 0;
          const friendlyAllies = player.battlefield.cards.filter(c => c.type !== 'quest');
          let candidates = [
            ...(allowHeroTargets ? [player.hero] : []),
            ...friendlyAllies
          ].filter((entity) => isTargetable(entity, { requester: player }));
          if (isDebuff) {
            const enemy = selectTargets([
              ...(allowHeroTargets ? [opponent.hero] : []),
              ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
            ]);
            candidates = [...candidates, ...enemy];
          }
          const promptOptions = {
            preferredSide: isDebuff ? 'enemy' : 'friendly',
            actingPlayer: player,
          };
          if (promptTitle) promptOptions.title = promptTitle;
          const chosen = await game.promptTarget(candidates, promptOptions);
          if (chosen) actualTargets.push(chosen);
        }
        break;
      }
      default:
        console.warn(`Unknown buff target: ${target}`);
        return;
    }

    for (const t of actualTargets) {
      this._recordTarget(context, t);
      const scheduleRevert = (revertFn) => {
        if (!duration) return;
        if (duration === 'thisTurn') {
          this.temporaryEffects.push({ revert: revertFn });
        } else if (duration === 'untilYourNextTurn') {
          const handler = ({ player: turnPlayer }) => {
            if (turnPlayer !== player) return;
            try {
              revertFn();
            } finally {
              off();
            }
          };
          const off = this._trackCleanup(game.turns.bus.on('turn:start', handler));
        }
      };

      if (duration === 'thisTurn' || duration === 'untilYourNextTurn') {
        const revertEffect = () => {
          if (property === 'attack') {
            if (t.data && t.data.attack != null) t.data.attack -= amount;
            else if (t.attack != null) t.attack -= amount; // For hero
          } else if (property === 'health') {
            const current = (t?.data?.health ?? t?.health);
            const hadPositive = typeof current === 'number' && current > 0;
            if (t.data && t.data.health != null) {
              if (typeof t.data.maxHealth === 'number') {
                if (amount >= 0) {
                  // Temporary health buff expiring: lower max, clamp current, never drop below 1 if it was alive
                  t.data.maxHealth -= amount;
                  if (t.data.maxHealth < 0) t.data.maxHealth = 0;
                  t.data.health = Math.min(t.data.health, t.data.maxHealth);
                  if (hadPositive && t.data.health < 1 && t.data.maxHealth >= 1) t.data.health = 1;
                } else {
                  // Temporary health debuff expiring: restore
                  t.data.maxHealth -= amount; // amount is negative -> increases max
                  if (t.data.maxHealth < 0) t.data.maxHealth = 0;
                  t.data.health = Math.min(t.data.health - amount, t.data.maxHealth);
                }
              } else {
                // No tracked maxHealth; fall back to prior behavior with safety for positive buffs
                if (amount >= 0) {
                  if (hadPositive && (t.data.health - amount) < 1) t.data.health = 1;
                  else t.data.health -= amount;
                } else {
                  t.data.health -= amount;
                }
                if (t.data.health < 0) t.data.health = 0;
              }
            } else if (t.health != null) {
              if (typeof t.maxHealth === 'number') {
                if (amount >= 0) {
                  t.maxHealth -= amount;
                  if (t.maxHealth < 0) t.maxHealth = 0;
                  t.health = Math.min(t.health, t.maxHealth);
                  if (hadPositive && t.health < 1 && t.maxHealth >= 1) t.health = 1;
                } else {
                  t.maxHealth -= amount; // amount negative -> increases max
                  if (t.maxHealth < 0) t.maxHealth = 0;
                  t.health = Math.min(t.health - amount, t.maxHealth);
                }
              } else {
                if (amount >= 0) {
                  if (hadPositive && (t.health - amount) < 1) t.health = 1;
                  else t.health -= amount;
                } else {
                  t.health -= amount;
                }
                if (t.health < 0) t.health = 0;
              }
            }
          } else if (property === 'armor') {
            if (t.data && t.data.armor != null) {
              t.data.armor -= amount;
              if (t.data.armor < 0) t.data.armor = 0;
            } else if (t.armor != null) {
              t.armor -= amount; // For hero
              if (t.armor < 0) t.armor = 0;
            }
          } else if (property === 'spellDamage') {
            if (t.data && typeof t.data.spellDamage === 'number') {
              t.data.spellDamage -= amount;
              if (t.data.spellDamage < 0) t.data.spellDamage = 0;
            }
          }
        };
        scheduleRevert(revertEffect);
      }

      if (property === 'attack') {
        if (t.data && t.data.attack != null) t.data.attack += amount;
        else if (t.attack != null) t.attack += amount; // For hero
      } else if (property === 'health') {
        if (t.data && t.data.health != null) {
          t.data.health += amount;
          if (typeof amount === 'number' && amount !== 0) {
            const prior = (t.data.health ?? 0) - amount;
            const baseMax = (typeof t.data.maxHealth === 'number') ? t.data.maxHealth : prior;
            t.data.maxHealth = baseMax + amount;
            if (amount < 0) t.data.health = Math.max(0, Math.min(t.data.health, t.data.maxHealth));
          }
        } else if (t.health != null) {
          t.health += amount; // For hero/non-card
          if (typeof amount === 'number' && amount !== 0) {
            const prior = (t.health ?? 0) - amount;
            const baseMax = (typeof t.maxHealth === 'number') ? t.maxHealth : prior;
            t.maxHealth = baseMax + amount;
            if (amount < 0) t.health = Math.max(0, Math.min(t.health, t.maxHealth));
          }
        }
      } else if (property === 'armor') {
        if (t.data && t.data.armor != null) {
          t.data.armor += amount;
          if (t.data.armor < 0) t.data.armor = 0;
        } else if (t.armor != null) {
          t.armor += amount; // For hero
          if (t.armor < 0) t.armor = 0;
        }
        if (amount > 0) {
          let p = null;
          if (t === player.hero) p = player;
          else if (t === opponent.hero) p = opponent;
          if (p) {
            p.armorGainedThisTurn = (p.armorGainedThisTurn || 0) + amount;
            game.bus.emit('armorGained', { player: p, amount, source: context.card });
          }
        }
      } else if (property === 'spellDamage') {
        if (!t.data) t.data = {};
        t.data.spellDamage = (t.data.spellDamage || 0) + amount;
      }
      console.log(`Applied +${amount} ${property} to ${t.name}.`);
    }
  }

  async grantKeyword(effect, context, forcedTarget = null) {
    const { target, keyword, duration, allowHero = true } = effect;
    if (!keyword) return;

    const { player, game } = context;
    const opponent = player === game.player ? game.opponent : game.player;
    const isTemporary = duration === 'thisTurn' || duration === 'untilYourNextTurn';
    const promptTitle = this._describeGrantKeywordPrompt(effect);

    let actualTargets = [];

    switch (target) {
      case 'allies': {
        if (allowHero) actualTargets.push(player.hero);
        actualTargets.push(
          ...player.battlefield.cards
            .filter(c => c.type !== 'quest')
            .filter((entity) => isTargetable(entity, { requester: player }))
        );
        break;
      }
      case 'hero':
        actualTargets.push(player.hero);
        break;
      case 'character': {
        if (forcedTarget) {
          if (!allowHero && forcedTarget?.type === 'hero') return;
          actualTargets.push(forcedTarget);
        } else {
          const friendly = [
            ...(allowHero ? [player.hero] : []),
            ...player.battlefield.cards.filter(c => c.type !== 'quest')
          ].filter((entity) => isTargetable(entity, { requester: player }));

          const promptOptions = {
            preferredSide: 'friendly',
            actingPlayer: player,
          };
          if (promptTitle) promptOptions.title = promptTitle;
          const chosen = await game.promptTarget(friendly, promptOptions);
          if (chosen === game.CANCEL) throw game.CANCEL;
          if (chosen) actualTargets.push(chosen);
        }
        break;
      }
      case 'enemyCharacter': {
        const candidates = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest')
        ]).filter(isTargetable);
        const promptOptions = {
          preferredSide: 'enemy',
          actingPlayer: player,
        };
        if (promptTitle) promptOptions.title = promptTitle;
        const chosen = await game.promptTarget(candidates, promptOptions);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      default:
        console.warn(`Unknown keyword grant target: ${target}`);
        return;
    }

    const seen = new Set();
    actualTargets = actualTargets.filter((t) => {
      if (!t) return false;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    for (const t of actualTargets) {
      this._recordTarget(context, t);
      if (!Array.isArray(t.keywords)) t.keywords = [];
      const hasKeyword = t.keywords.includes(keyword);
      if (!hasKeyword) t.keywords.push(keyword);

      if (isTemporary) {
        if (!t.data) t.data = {};
        const tempCounts = t.data.tempKeywordCounts || (t.data.tempKeywordCounts = {});
        const prevCount = tempCounts[keyword] || 0;
        tempCounts[keyword] = prevCount + 1;

        const revertKeyword = () => {
          const counts = t.data?.tempKeywordCounts;
          if (!counts) return;
          const current = counts[keyword] || 0;
          const next = current - 1;
          if (next <= 0) {
            delete counts[keyword];
            const baseHas = Array.isArray(t.baseKeywords) && t.baseKeywords.includes(keyword);
            if (!baseHas && Array.isArray(t.keywords)) {
              t.keywords = t.keywords.filter((k) => k !== keyword);
            }
          } else {
            counts[keyword] = next;
          }
        };

        if (duration === 'thisTurn') {
          this.temporaryEffects.push({ revert: revertKeyword });
        } else if (duration === 'untilYourNextTurn') {
          let off = null;
          const handler = ({ player: turnPlayer }) => {
            if (turnPlayer !== player) return;
            try {
              revertKeyword();
            } finally {
              if (off) off();
            }
          };
          off = this._trackCleanup(game.turns.bus.on('turn:start', handler));
        }
      }

      console.log(`Granted ${keyword} to ${t.name}.`);
    }
  }

  buffOnArmorGain(effect, context) {
    const { attack = 0, health = 0 } = effect;
    const { game, player, card } = context;

    const apply = () => {
      card.data = card.data || {};
      if (attack) card.data.attack = (card.data.attack || 0) + attack;
      if (health) {
        card.data.health = (card.data.health || 0) + health;
        const prior = (card.data.health || 0) - health;
        const baseMax = (typeof card.data.maxHealth === 'number') ? card.data.maxHealth : prior;
        card.data.maxHealth = baseMax + health;
        if (health < 0) card.data.health = Math.max(0, Math.min(card.data.health, card.data.maxHealth));
      }
    };

    const handler = ({ player: armorPlayer }) => {
      if (armorPlayer !== player) return;
      apply();
    };

    const offArmor = this._trackCleanup(game.bus.on('armorGained', handler));

    const remove = () => {
      offArmor();
      offDeath();
      offReturn();
    };

    const offDeath = this._trackCleanup(game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    }));

    const offReturn = this._trackCleanup(game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    }));
  }

  heroAttackOnArmorGain(effect, context) {
    const rawAmount = Number(effect?.amount);
    const normalizedAmount = Number.isFinite(rawAmount) ? rawAmount : 1;
    if (!normalizedAmount) return;

    const { game, player, card } = context || {};
    if (!game || !player?.hero || !card) return;

    const hero = card;
    if (!hero) return;

    const state = hero._armorAttackOnArmorGainState ||= { initialized: false, amount: normalizedAmount };
    state.amount = normalizedAmount;
    if (state.initialized) {
      return;
    }
    state.initialized = true;

    const grantAttack = () => {
      if (player.hero !== hero) return;
      const amount = Number(state.amount);
      if (!Number.isFinite(amount) || amount === 0) return;
      if (!hero.data) hero.data = {};
      hero.data.attack = (hero.data.attack || 0) + amount;
      const revert = () => {
        if (!hero?.data) return;
        hero.data.attack = (hero.data.attack || 0) - amount;
        if (hero.data.attack < 0) hero.data.attack = 0;
      };
      this.temporaryEffects.push({ revert });
      console.log(`Granted temporary +${amount} ATK to ${hero.name} after gaining armor.`);
    };

    const handler = ({ player: armorPlayer }) => {
      if (armorPlayer !== player) return;
      if (player.hero !== hero) return;
      grantAttack();
    };

    state.off = this._trackCleanup(game.bus.on('armorGained', handler));
  }

  buffOnSurviveDamage(effect, context) {
    const { attack = 0, health = 0 } = effect;
    const { game, card } = context;

    const apply = () => {
      card.data = card.data || {};
      if (attack) card.data.attack = (card.data.attack || 0) + attack;
      if (health) {
        card.data.health = (card.data.health || 0) + health;
        const prior = (card.data.health || 0) - health;
        const baseMax = (typeof card.data.maxHealth === 'number') ? card.data.maxHealth : prior;
        card.data.maxHealth = baseMax + health;
        if (health < 0) card.data.health = Math.max(0, Math.min(card.data.health, card.data.maxHealth));
      }
    };

    const handler = ({ target }) => {
      if (target !== card) return;
      if (card.data?.health > 0) apply();
    };

    const offDamage = this._trackCleanup(game.bus.on('damageDealt', handler));

    const remove = () => {
      offDamage();
      offDeath();
      offReturn();
    };

    const offDeath = this._trackCleanup(game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    }));

    const offReturn = this._trackCleanup(game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    }));
  }

  equipItem(effect, context) {
    const { item } = effect;
    const { player, game } = context;
    const eq = new Equipment(item);
    player.equip(eq, { turn: game?.turns?.turn ?? null });
    if (eq.armor) {
      player.armorGainedThisTurn = (player.armorGainedThisTurn || 0) + eq.armor;
      game.bus.emit('armorGained', { player, amount: eq.armor, source: eq });
    }
    console.log(`Equipped ${eq.name}.`);
  }

  spellDamageNextSpell(effect, context) {
    const { amount = 1, eachTurn = false } = effect;
    const { player, card } = context;
    const sourceCardId = card?.type === 'equipment' ? getCardInstanceId(card) : null;
    player.hero.data.nextSpellDamageBonus = {
      amount,
      used: false,
      eachTurn,
      sourceCardId,
    };
  }

  applyOverload(effect, context) {
    const { amount } = effect;
    const { player, game } = context;
    game.resources.addOverloadNextTurn(player, amount);
    console.log(`Applied ${amount} overload to ${player.name}.`);
  }

  _shouldResolveAllChooseOneOptions(options, context) {
    if (!Array.isArray(options) || options.length < 2) return false;
    const { player, card } = context || {};
    const hero = player?.hero;
    if (!hero) return false;

    const heroData = hero.data || {};
    const state = heroData.chooseBothOnManaSpentState;
    if (!state) return false;

    const spent = Number(state.spentThisTurn);
    const threshold = Number(state.threshold);
    if (!Number.isFinite(spent) || !Number.isFinite(threshold)) return false;
    if (!(spent > threshold)) return false;

    const isHeroPower = card === hero;
    const sourceType = card?.type;
    const isEligibleSource = isHeroPower || sourceType === 'spell' || sourceType === 'ally';
    if (!isEligibleSource) return false;

    return true;
  }

  async handleChooseOne(effect, context) {
    const { game, player } = context;
    const options = effect.options || [];

    if (this._shouldResolveAllChooseOneOptions(options, context)) {
      for (const opt of options) {
        if (Array.isArray(opt?.effects) && opt.effects.length > 0) {
          await this.execute(opt.effects, context);
        }
      }
      return;
    }

    // If it's the AI's turn, auto-pick a sensible option without prompting the player.
    const isAITurn = !!game.turns.activePlayer && game.turns.activePlayer !== game.player;
    if (isAITurn) {
      // Simple heuristic: prefer healing if any friendly is injured; otherwise prefer damage; else first option.
      const isHealOption = (opt) => Array.isArray(opt?.effects) && opt.effects.some(e => e.type === 'heal');
      const isDamageOption = (opt) => Array.isArray(opt?.effects) && opt.effects.some(e => e.type === 'damage');

      // Check if any friendly character is injured
      const chars = [player.hero, ...player.battlefield.cards];
      const friendlyInjured = chars.some(c => {
        const cur = c?.data?.health ?? c?.health;
        const max = c?.data?.maxHealth ?? c?.maxHealth ?? cur;
        return typeof cur === 'number' && cur < max;
      });

      let chosen = null;
      if (friendlyInjured) {
        chosen = options.find(isHealOption) || null;
      }
      if (!chosen) {
        chosen = options.find(isDamageOption) || null;
      }
      if (!chosen) {
        chosen = options[0] || null;
      }
      if (chosen?.effects) {
        await this.execute(chosen.effects, context);
      }
      return;
    }

    // Player's turn: show prompt UI and execute the selected option.
    const optionTexts = options.map(o => o.text) || [];
    const idx = await game.promptOption(optionTexts);
    // If the user cancels, abort the card play entirely
    if (idx === game.CANCEL) throw game.CANCEL;
    const chosen = options[idx] || options[0];
    if (chosen?.effects) {
      await this.execute(chosen.effects, context);
    }
  }

  restoreResources(effect, context) {
    const { amount, requiresSpent } = effect;
    const { game, player } = context;
    if (requiresSpent) {
      const used = game.resources.available(player) - game.resources.pool(player);
      if (used < requiresSpent) return;
    }
    game.resources.restore(player, amount);
  }
}

export default EffectSystem;
