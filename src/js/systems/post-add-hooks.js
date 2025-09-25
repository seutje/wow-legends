const postAddHookHandlers = new Map();

export function registerPostAddHookHandler(type, handler) {
  if (typeof type !== 'string' || !type) return;
  if (typeof handler !== 'function') return;
  postAddHookHandlers.set(type, handler);
}

export function runHandPostAddHooks(hand, cardEntity) {
  if (!hand || typeof hand !== 'object' || !cardEntity) return;
  const descriptors = hand.postAddHookDescriptors;
  if (!Array.isArray(descriptors) || descriptors.length === 0) return;
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor !== 'object') continue;
    const handler = postAddHookHandlers.get(descriptor.type);
    if (typeof handler !== 'function') continue;
    try {
      handler(hand, cardEntity, descriptor);
    } catch {
      // Swallow handler errors to keep add pipeline resilient.
    }
  }
}

export function ensureHandHookState(hand) {
  if (!hand || typeof hand !== 'object') return;
  if (!Array.isArray(hand.postAddHookDescriptors)) {
    hand.postAddHookDescriptors = [];
  }
  if (!(hand.postAddHookKeys instanceof Set)) {
    hand.postAddHookKeys = new Set();
  }
}

export function addHandHookDescriptor(hand, descriptor) {
  if (!hand || typeof hand !== 'object' || !descriptor || typeof descriptor !== 'object') {
    return false;
  }
  ensureHandHookState(hand);
  const key = typeof descriptor.id === 'string' ? descriptor.id : (typeof descriptor.key === 'string' ? descriptor.key : null);
  if (key && hand.postAddHookKeys.has(key)) {
    return false;
  }
  hand.postAddHookDescriptors.push(descriptor);
  if (key) {
    hand.postAddHookKeys.add(key);
  }
  return true;
}
